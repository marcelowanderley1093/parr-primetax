# Backup e restore do MySQL do PARR

Todos os comandos abaixo são **na VPS** (`ssh parr-vps` primeiro), como root. Nenhum comando exibe ou
digita senha: a senha do usuário de backup é gerada em variável, gravada com `printf` no arquivo de opções
e apagada com `unset`. Cada passo termina com um gate que **imprime** `PASSOU` ou `PARAR`.

## 1–2. Usuário MySQL de backup + arquivos de opções (uma sequência, sem segredo visível)

Privilégios mínimos para `mysqldump --single-transaction --routines --triggers --events`. Um usuário para
os dois bancos; um `.cnf` por ambiente (mesma senha, arquivos separados).
```
export MYSQL_HISTFILE=/dev/null; unset HISTFILE
BKPASS=$(openssl rand -hex 24)
mysql -e "CREATE USER IF NOT EXISTS 'parr_backup'@'127.0.0.1' IDENTIFIED BY '${BKPASS}';"
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
Primeiro backup manual (o script imprime os gates) e gate:
```
systemctl start parr-backup@prod.service
journalctl -u parr-backup@prod.service --no-pager -n 40
G=$(journalctl -u parr-backup@prod.service --no-pager -n 40 | grep -c 'PASSOU: gate'); F=$(ls -1t /var/backups/parr/parr_prod/parr_prod-*.sql.gz 2>/dev/null | head -1); P=$(stat -c '%a %U:%G' "$F" 2>/dev/null); D=$(stat -c '%a %U:%G' /var/backups/parr /var/backups/parr/parr_prod | sort -u | tr '\n' ' '); echo "gates=$G/7 dump=$F perm=$P dirs='$D'"; if [ "$G" = "7" ] && [ -n "$F" ] && [ "$P" = "600 root:root" ] && [ "$D" = "700 root:root " ]; then echo PASSOU; else echo PARAR; fi
```

## 4. Teste de restore (obrigatório antes de produção receber lead)

Restaura o dump mais recente em um banco **descartável** e compara as contagens. Nunca restaure sobre o
banco vivo.
```
export MYSQL_HISTFILE=/dev/null
DUMP=$(ls -1t /var/backups/parr/parr_prod/parr_prod-*.sql.gz | head -1); echo "$DUMP"
mysql -e "DROP DATABASE IF EXISTS parr_restore_test; CREATE DATABASE parr_restore_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
zcat "$DUMP" | mysql parr_restore_test
DIFF=0; for t in lead_imports leads lead_status_history lead_notes local_users users site_settings __drizzle_migrations; do a=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.$t"); b=$(mysql -N -e "SELECT COUNT(*) FROM parr_restore_test.$t"); printf '%-22s prod=%s restore=%s\n' "$t" "$a" "$b"; [ "$a" = "$b" ] || DIFF=$((DIFF+1)); done; if [ "$DIFF" -eq 0 ]; then echo PASSOU; else echo "PARAR: $DIFF tabela(s) divergente(s) — nao confiar no backup ate entender"; fi
mysql -e "DROP DATABASE parr_restore_test;"
```

## 5. Restore real (só em desastre, com planejamento)

1. `systemctl stop parr-prod` (o app não pode escrever durante o restore).
2. Restaurar em `parr_restore_test` como no §4 e conferir o `PASSOU`.
3. Só então:
```
DUMP=$(ls -1t /var/backups/parr/parr_prod/parr_prod-*.sql.gz | head -1)
mysql -e "DROP DATABASE parr_prod; CREATE DATABASE parr_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
zcat "$DUMP" | mysql parr_prod
systemctl start parr-prod
H=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3102/); S=$(systemctl is-active parr-prod); echo "http=$H service=$S"; if [ "$H" = "200" ] && [ "$S" = "active" ]; then echo PASSOU; else echo PARAR; fi
```

## 6. Backlog (obrigatório antes de aposentar a Manus)

- Cópia **off-VPS** dos dumps (rclone para bucket/Drive ou `scp` diário para outra máquina): um único disco
  não é backup.
- Alerta se o timer falhar (`OnFailure=` com e-mail via SMTP já configurado).
