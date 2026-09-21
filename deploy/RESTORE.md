# Backup e restore do MySQL do PARR

Todos os comandos abaixo são **na VPS** (`ssh parr-vps` primeiro), como root. Nenhum contém senha:
as credenciais ficam só nos arquivos de opções em `/etc/parr/`, criados à mão.

## 1. Usuário MySQL de backup (uma vez por servidor)

Privilégios mínimos para `mysqldump --single-transaction --routines --triggers --events`:

```
mysql -e "CREATE USER IF NOT EXISTS 'parr_backup'@'127.0.0.1' IDENTIFIED BY '<SENHA_NOVA_SO_AQUI>';"
mysql -e "GRANT SELECT, LOCK TABLES, SHOW VIEW, TRIGGER, EVENT ON parr_staging.* TO 'parr_backup'@'127.0.0.1';"
mysql -e "GRANT SELECT, LOCK TABLES, SHOW VIEW, TRIGGER, EVENT ON parr_prod.* TO 'parr_backup'@'127.0.0.1';"
mysql -e "FLUSH PRIVILEGES;"
```
Digite a senha direto no terminal do `mysql` (não a cole em chat, arquivo de histórico ou `.env`).
Para não deixar a senha no `~/.mysql_history`: `export MYSQL_HISTFILE=/dev/null` antes.

## 2. Arquivos de opções (um por ambiente)

```
install -o root -g root -m 600 /dev/null /etc/parr/backup-prod.cnf
cat > /etc/parr/backup-prod.cnf <<'EOF'
[client]
host=127.0.0.1
user=parr_backup
password=<SENHA_DO_parr_backup>
EOF
chmod 600 /etc/parr/backup-prod.cnf
```
(idem `backup-staging.cnf`). Conferir sem expor a senha:
```
awk -F= '{print $1": "($2==""?"VAZIA":"PREENCHIDA")}' /etc/parr/backup-prod.cnf
stat -c '%a %U:%G %n' /etc/parr/backup-prod.cnf
```

## 3. Instalar o timer

```
cp /srv/parr/prod/deploy/parr-backup@.service /srv/parr/prod/deploy/parr-backup@.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now parr-backup@prod.timer
systemctl enable --now parr-backup@staging.timer
systemctl list-timers 'parr-backup@*'
```
Primeiro backup manual (imprime os gates):
```
systemctl start parr-backup@prod.service
journalctl -u parr-backup@prod.service --no-pager -n 30
ls -la /var/backups/parr/parr_prod/
```
Gate: todos os `PASSOU`, arquivo `.sql.gz` com 600 root:root, diretório 700 root:root → PASSOU.

## 4. Teste de restore (obrigatório antes de produção receber lead)

Restaura o dump mais recente em um banco **descartável** e compara contagens. Nunca restaure sobre o banco vivo.

```
export MYSQL_HISTFILE=/dev/null
DUMP=$(ls -1t /var/backups/parr/parr_prod/parr_prod-*.sql.gz | head -1); echo "$DUMP"
mysql -e "DROP DATABASE IF EXISTS parr_restore_test; CREATE DATABASE parr_restore_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
zcat "$DUMP" | mysql parr_restore_test
```
Contagens lado a lado (origem × restaurado):
```
for t in lead_imports leads lead_status_history lead_notes local_users users site_settings __drizzle_migrations; do
  printf '%-22s prod=%s restore=%s\n' "$t" "$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.$t")" "$(mysql -N -e "SELECT COUNT(*) FROM parr_restore_test.$t")"
done
```
Gate: as 8 contagens iguais → **PASSOU**; qualquer diferença → **PARAR** (não confiar no backup até entender).
Limpeza:
```
mysql -e "DROP DATABASE parr_restore_test;"
```

## 5. Restore real (só em desastre, com planejamento)

1. `systemctl stop parr-prod` (o app não pode escrever durante o restore).
2. Restaurar em `parr_restore_test` como no item 4 e conferir as contagens.
3. Só então: `mysql -e "DROP DATABASE parr_prod; CREATE DATABASE parr_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"` e `zcat "$DUMP" | mysql parr_prod`.
4. `systemctl start parr-prod`, `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3102/`.

## 6. Backlog (obrigatório antes de aposentar a Manus)

- Cópia **off-VPS** dos dumps (rclone para bucket/Drive ou `scp` diário para outra máquina): um único disco não é backup.
- Alerta se o timer falhar (`OnFailure=` com e-mail via SMTP já configurado).
