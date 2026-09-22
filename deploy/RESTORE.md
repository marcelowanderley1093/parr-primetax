# Backup e restore do MySQL do PARR

Todos os comandos abaixo são **na VPS** (`ssh parr-vps` primeiro), como root. Nenhum comando exibe ou
digita senha: a senha do usuário de backup é gerada em variável, gravada com `printf` no arquivo de opções
e apagada com `unset`. Cada passo termina com um gate que **imprime** `PASSOU` ou `PARAR`.

**Regra de ouro do restore**: o `mysqldump` é chamado com o **nome do banco posicional** (nunca
`--databases`/`-B`/`--all-databases`), então o dump **não** contém `USE`/`CREATE DATABASE` e só grava no
banco indicado no comando de restore. O `backup-mysql.sh` confere isso no gate 6 e apaga o arquivo se
falhar; os §4 e §5 repetem a conferência **antes** de qualquer `zcat | mysql`. Sem essa garantia, um
"restore de teste" gravaria por cima do banco vivo.

## 1–2. Usuário MySQL de backup + arquivos de opções (uma sequência, sem segredo visível)

Privilégios mínimos para `mysqldump --single-transaction --routines --triggers --events`. Um usuário para
os dois bancos; um `.cnf` por ambiente (mesma senha, arquivos separados). O `ALTER USER` faz uma segunda
execução sincronizar a senha do usuário com a dos `.cnf` recém-escritos.
```
export MYSQL_HISTFILE=/dev/null; unset HISTFILE
BKPASS=$(openssl rand -hex 24)
mysql -e "CREATE USER IF NOT EXISTS 'parr_backup'@'127.0.0.1' IDENTIFIED BY '${BKPASS}';"
mysql -e "ALTER USER 'parr_backup'@'127.0.0.1' IDENTIFIED BY '${BKPASS}';"
mysql -e "GRANT SELECT, LOCK TABLES, SHOW VIEW, TRIGGER, EVENT ON parr_staging.* TO 'parr_backup'@'127.0.0.1'; GRANT SELECT, LOCK TABLES, SHOW VIEW, TRIGGER, EVENT ON parr_prod.* TO 'parr_backup'@'127.0.0.1'; FLUSH PRIVILEGES;"
for e in staging prod; do install -o root -g root -m 600 /dev/null /etc/parr/backup-$e.cnf; printf '[client]\nhost=127.0.0.1\nuser=parr_backup\npassword=%s\n' "$BKPASS" > /etc/parr/backup-$e.cnf; done
unset BKPASS
P1=$(stat -c '%a %U:%G' /etc/parr/backup-prod.cnf); P2=$(stat -c '%a %U:%G' /etc/parr/backup-staging.cnf); U=$(mysql -N -e "SELECT COUNT(*) FROM mysql.user WHERE user='parr_backup' AND host='127.0.0.1'"); T=$(mysql --defaults-extra-file=/etc/parr/backup-prod.cnf -N -e "SELECT 1" 2>/dev/null); echo "cnf_prod=$P1 cnf_staging=$P2 user=$U login_teste=$T"; if [ "$P1" = "600 root:root" ] && [ "$P2" = "600 root:root" ] && [ "$U" = "1" ] && [ "$T" = "1" ]; then echo PASSOU; else echo PARAR; fi
```
Conferir sem expor a senha, quando precisar: `awk -F= '{print $1": "($2==""?"VAZIA":"PREENCHIDA")}' /etc/parr/backup-prod.cnf`.

## 3. Instalar o timer

```
cp /srv/parr/prod/deploy/parr-backup@.service /srv/parr/prod/deploy/parr-backup@.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now parr-backup@prod.timer
systemctl enable --now parr-backup@staging.timer
systemctl list-timers 'parr-backup@*' --no-pager
```
Primeiro backup manual. O gate lê **apenas a execução mais recente** (pelo `InvocationID`), para não contar
`PASSOU` de execuções anteriores numa reexecução:
```
systemctl start parr-backup@prod.service
ID=$(systemctl show -p InvocationID --value parr-backup@prod.service); journalctl _SYSTEMD_INVOCATION_ID="$ID" --no-pager
G=$(journalctl _SYSTEMD_INVOCATION_ID="$ID" --no-pager | grep -c 'PASSOU: gate'); R=$(systemctl show -p Result --value parr-backup@prod.service); F=$(ls -1t /var/backups/parr/parr_prod/parr_prod-*.sql.gz 2>/dev/null | head -1); P=$(stat -c '%a %U:%G' "$F" 2>/dev/null); D=$(stat -c '%a %U:%G' /var/backups/parr /var/backups/parr/parr_prod | sort -u | tr '\n' ' '); echo "gates=$G/8 result=$R dump=$F perm=$P dirs='$D'"; if [ "$G" = "8" ] && [ "$R" = "success" ] && [ -n "$F" ] && [ "$P" = "600 root:root" ] && [ "$D" = "700 root:root " ]; then echo PASSOU; else echo PARAR; fi
```

## 4. Teste de restore (obrigatório antes de produção receber lead)

Restaura o dump mais recente em um banco **descartável** e compara as contagens. Nunca restaure sobre o
banco vivo. O primeiro gate é a blindagem `USE`/`CREATE DATABASE`: sem ele, `zcat | mysql` poderia escrever
em outro banco que não o `parr_restore_test`.
```
export MYSQL_HISTFILE=/dev/null
DUMP=$(ls -1t /var/backups/parr/parr_prod/parr_prod-*.sql.gz | head -1); echo "dump: $DUMP"
S=$(zcat "$DUMP" | grep -cE '^(USE |CREATE DATABASE)' || true); G=$(gzip -t "$DUMP" 2>&1 | wc -l); echo "use_create=$S gzip_erros=$G"; if [ "$S" = "0" ] && [ "$G" = "0" ]; then echo PASSOU; else echo "PARAR: dump com USE/CREATE DATABASE ou gzip corrompido — NAO restaurar"; fi
```
Só após o `PASSOU` acima:
```
mysql -e "DROP DATABASE IF EXISTS parr_restore_test; CREATE DATABASE parr_restore_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
zcat "$DUMP" | mysql parr_restore_test
DIFF=0; for t in lead_imports leads lead_status_history lead_notes local_users users site_settings __drizzle_migrations; do a=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.$t"); b=$(mysql -N -e "SELECT COUNT(*) FROM parr_restore_test.$t"); printf '%-22s prod=%s restore=%s\n' "$t" "$a" "$b"; [ "$a" = "$b" ] || DIFF=$((DIFF+1)); done; if [ "$DIFF" -eq 0 ]; then echo PASSOU; else echo "PARAR: $DIFF tabela(s) divergente(s) — conferir antes de confiar no backup"; fi
mysql -e "DROP DATABASE parr_restore_test;"
```
**Nota**: enquanto a produção ainda não recebe leads, as 8 contagens têm de bater exatamente. Depois que o
formulário estiver no ar, divergência em `leads`, `lead_status_history`, `lead_notes` é **legítima** — são
linhas gravadas após o horário do dump (`parr_prod` ≥ `parr_restore_test`). Nesse caso o gate acusa `PARAR`:
conferir se a diferença é só para mais e compatível com o movimento desde o dump; `local_users`, `users`,
`site_settings` e `__drizzle_migrations` devem continuar iguais.

## 5. Restore real (só em desastre, com planejamento)

1. `systemctl stop parr-prod` — o app não pode escrever durante o restore.
2. **Escolher o dump explicitamente** (o mais recente pode já conter o estrago):
```
ls -1t /var/backups/parr/parr_prod/parr_prod-*.sql.gz | head -14
DUMP=/var/backups/parr/parr_prod/parr_prod-AAAAMMDD-HHMMSS.sql.gz    # fixar o arquivo escolhido
E=$([ -f "$DUMP" ] && echo ok); S=$(zcat "$DUMP" 2>/dev/null | grep -cE '^(USE |CREATE DATABASE)' || true); G=$(gzip -t "$DUMP" 2>&1 | wc -l); echo "dump=$DUMP existe=$E use_create=$S gzip_erros=$G"; if [ "$E" = "ok" ] && [ "$S" = "0" ] && [ "$G" = "0" ]; then echo PASSOU; else echo "PARAR: dump inexistente, corrompido ou com USE/CREATE DATABASE"; fi
```
3. Restaurar em `parr_restore_test` como no §4 e conferir o `PASSOU` das contagens.
4. **Dump de segurança do estado atual** antes de destruir qualquer coisa:
```
PRE=/var/backups/parr/pre-restore-$(date -u '+%Y%m%d-%H%M%S').sql.gz
umask 077; mysqldump --defaults-extra-file=/etc/parr/backup-prod.cnf --single-transaction --quick --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF parr_prod | gzip -9 > "$PRE"
chmod 600 "$PRE"
Z=$(stat -c '%s' "$PRE" 2>/dev/null); P=$(stat -c '%a %U:%G' "$PRE" 2>/dev/null); T=$(gzip -t "$PRE" 2>&1 | wc -l); C=$(zcat "$PRE" | tail -5 | grep -c 'Dump completed'); echo "pre_restore=$PRE bytes=$Z perm=$P gzip_erros=$T completo=$C"; if [ "${Z:-0}" -gt 0 ] && [ "$P" = "600 root:root" ] && [ "$T" = "0" ] && [ "$C" = "1" ]; then echo PASSOU; else echo "PARAR: sem dump de seguranca — NAO prosseguir"; fi
```
5. Só com os três `PASSOU` acima:
```
mysql -e "DROP DATABASE parr_prod; CREATE DATABASE parr_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
zcat "$DUMP" | mysql parr_prod
systemctl start parr-prod
H=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3102/); S=$(systemctl is-active parr-prod); N=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.leads"); echo "http=$H service=$S leads=$N"; if [ "$H" = "200" ] && [ "$S" = "active" ]; then echo PASSOU; else echo PARAR; fi
```
Se algo der errado, o estado anterior está em `$PRE` (mesmo procedimento, trocando `$DUMP` por `$PRE`).

## 6. Backlog (obrigatório antes de aposentar a Manus)

- Cópia **off-VPS** dos dumps (rclone para bucket/Drive ou `scp` diário para outra máquina): um único disco
  não é backup.
- Alerta se o timer falhar (`OnFailure=` com e-mail via SMTP já configurado).
