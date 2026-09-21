# Produção do PARR na VPS — montagem e operação

Tudo aqui é **na VPS** (`ssh parr-vps` primeiro), como root salvo indicação. Nenhum comando
contém senha: segredos são digitados direto no editor/terminal e vivem só em `/etc/parr/`.
Cada etapa termina com um gate: **PASSOU** segue, **PARAR** interrompe e reporta.

Constantes: diretório `/srv/parr/prod` · usuário `parr` · serviço `parr-prod` · porta `127.0.0.1:3102` ·
banco `parr_prod` · domínio `parr.primetax.com.br` · branch `main`.

## 0. Atualizações do sistema (antes de tudo)

```
apt update; apt list --upgradable
apt upgrade -y
[ -f /var/run/reboot-required ] && echo "REBOOT NECESSARIO" || echo "sem reboot"
```
Se pedir reboot: `reboot`, reconectar e **checar o que já estava no ar**:
```
systemctl is-active mysql nginx parr-staging
curl -s -o /dev/null -w 'staging http=%{http_code}\n' http://127.0.0.1:3101/
mysql -N -e "SELECT @@global.time_zone, @@session.time_zone, NOW() = UTC_TIMESTAMP();"
```
Gate: três `active`, `http=200`, time_zone `+00:00 +00:00 1` → PASSOU.

## 1. Diretório e clone (como `parr`)

```
mkdir -p /srv/parr/prod; chown parr:parr /srv/parr/prod
sudo -u parr bash -lc "git clone --branch main https://github.com/marcelowanderley1093/parr-primetax.git /srv/parr/prod"
sudo -u parr bash -lc "cd /srv/parr/prod && git rev-parse --abbrev-ref HEAD && git rev-parse --short HEAD && git status --porcelain"
sudo -u parr bash -lc "cd /srv/parr/prod && pnpm install --frozen-lockfile"
```
Gate: branch `main`, status vazio, install sem `ERR` → PASSOU. (Instalar **com** devDependencies:
`dist/index.js` importa `vite` — backlog.)

## 2. Banco `parr_prod` e usuário próprio

```
export MYSQL_HISTFILE=/dev/null
mysql -e "CREATE DATABASE parr_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
mysql -e "CREATE USER 'parr_prod'@'127.0.0.1' IDENTIFIED BY '<SENHA_NOVA_DIGITADA_AQUI>';"
mysql -e "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES ON parr_prod.* TO 'parr_prod'@'127.0.0.1';"
mysql -e "FLUSH PRIVILEGES;"
mysql -N -e "SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='parr_prod';"
```
Gate: `parr_prod utf8mb4` → PASSOU. Senha nova, diferente da do staging (a do staging foi exposta em 18/09 e
deve ser rotacionada à parte).

## 3. `/etc/parr/prod.env` (segredos novos)

```
install -o root -g parr -m 640 /dev/null /etc/parr/prod.env
openssl rand -base64 48 | tr -d '\n' | wc -c     # >= 32 chars para JWT_SECRET (gere e cole no editor)
nano /etc/parr/prod.env
```
Chaves (valores só no arquivo):
```
NODE_ENV=production
HOST=127.0.0.1
PORT=3102
DATABASE_URL=mysql://parr_prod:<SENHA>@127.0.0.1:3306/parr_prod
JWT_SECRET=<novo, >= 32 chars>
PUBLIC_BASE_URL=https://parr.primetax.com.br
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
NOTIFY_EMAIL_TO=
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
PIPEDRIVE_API_TOKEN=
PIPEDRIVE_DOMAIN=
```
Conferir **sem** expor valores:
```
awk -F= '{print $1": "($2==""?"VAZIA":"PREENCHIDA")}' /etc/parr/prod.env
stat -c '%a %U:%G %n' /etc/parr/prod.env
```
Gate: `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_BASE_URL` PREENCHIDAS (o boot em produção recusa sem elas);
arquivo `640 root:parr` → PASSOU. `PUBLIC_BASE_URL` sem barra final (o boot rejeita).
Calendar pode ficar VAZIA até repor as credenciais (aba fica "Configuração necessária").

## 4. Migração — banco vazio recebe o schema

**Em produção, migração é SOMENTE `pnpm exec drizzle-kit migrate`.** Nunca `pnpm db:push` (ele
encadeia `generate`), nunca `drizzle-kit generate` na VPS: `generate` escreve arquivos em
`drizzle/` no clone e quebra o gate 2 (working tree limpa) de todo deploy seguinte.

```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm exec drizzle-kit migrate"
mysql -N -e "SELECT COUNT(*) FROM parr_prod.__drizzle_migrations; SHOW TABLES FROM parr_prod;"
sudo -u parr bash -lc "cd /srv/parr/prod && git status --porcelain"
```
Gate: `__drizzle_migrations` = **9**, 7 tabelas + `__drizzle_migrations`, status vazio → PASSOU.
(O `set -a && . /etc/parr/prod.env` acontece dentro do shell do `parr`, que precisa poder ler o arquivo — por isso `640 root:parr`.)

Migrações futuras: mesmo comando, só após `PARAR` do gate 4 do deploy e com planejamento (backup antes).

## 5. Serviço systemd

```
cp /srv/parr/prod/deploy/parr-prod.service /etc/systemd/system/parr-prod.service
systemctl daemon-reload
systemctl enable parr-prod
```
Não iniciar ainda: `dist/` só existe após o primeiro deploy (etapa 7).

## 6. nginx (HTTP) + DNS + TLS

```
cp /srv/parr/prod/deploy/nginx-parr-prod.conf /etc/nginx/sites-available/parr-prod.conf
ln -sf /etc/nginx/sites-available/parr-prod.conf /etc/nginx/sites-enabled/parr-prod.conf
nginx -t
systemctl reload nginx
```
DNS (Hostinger): registro **A** `parr` → IP da VPS (TTL curto, 300 s). Verificar propagação:
```
dig +short parr.primetax.com.br
```
TLS (só quando o `dig` devolver o IP da VPS):
```
certbot --nginx -d parr.primetax.com.br --redirect
nginx -t; systemctl reload nginx
```
Gate: `nginx -t` ok; `dig` = IP da VPS; certbot ok → PASSOU. O `--redirect` faz 80 → 443. Sem `auth_basic`
e sem `X-Robots-Tag` (landing pública). O bloco do callback do Calendar é mantido.

## 7. Primeiro deploy

```
bash /srv/parr/prod/scripts/deploy-prod.sh 2>&1 | tee /root/deploy-prod.log
curl -s -o /dev/null -w 'https=%{http_code}\n' https://parr.primetax.com.br/
curl -s https://parr.primetax.com.br/ | grep -o '<html[^>]*>'
```
Gate: 10 `PASSOU` no log; `https=200`; `<html lang="pt-BR" translate="no">` → PASSOU.
Falha no build **não** derruba nada (build em `dist-next/`); o log termina com as duas linhas de rollback.

## 8. Admin, import só-leads, backup

Admin (senha temporária impressa uma vez; troca forçada no primeiro login):
```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && ADMIN_EMAIL='marcelo@primetax.com.br' ADMIN_NOME='Marcelo Wanderley' pnpm tsx scripts/criar-admin.ts"
```
Import (export **final** da Manus, copiado para a VPS **fora do clone** e legível só pelo `parr`):
```
install -o parr -g parr -m 600 /root/parr-export.json /srv/parr/parr-export.json
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm tsx scripts/import-manus.ts --file /srv/parr/parr-export.json --mode leads --dry-run"
```
Gate: `ROLLBACK (dry-run)`, `time_zone: global=+00:00 session=+00:00`, 4 linhas `-> ok`, `PASSOU` → então:
```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm tsx scripts/import-manus.ts --file /srv/parr/parr-export.json --mode leads --apply"
mysql -N -e "SELECT 'leads',COUNT(*) FROM parr_prod.leads UNION ALL SELECT 'history',COUNT(*) FROM parr_prod.lead_status_history UNION ALL SELECT 'imports',COUNT(*) FROM parr_prod.lead_imports UNION ALL SELECT 'settings',COUNT(*) FROM parr_prod.site_settings UNION ALL SELECT 'notes',COUNT(*) FROM parr_prod.lead_notes;"
rm -f /srv/parr/parr-export.json /root/parr-export.json
```
Gate: `COMMIT`, `PASSOU`, contagens 888 / 896 / 1 / 1 / 0 → PASSOU. O export contém dados pessoais: apagar as duas cópias ao fim.

Backup: seguir `deploy/RESTORE.md` (usuário `parr_backup`, `backup-prod.cnf`, timer, **teste de restore**).
Gate: restore em `parr_restore_test` com as 8 contagens iguais → PASSOU.

## 9. Ensaio do import só-leads no staging (antes do item 8 em produção)

Esvaziar **só** as 5 tabelas do modo, com o banco explícito e contagem antes/depois:
```
export MYSQL_HISTFILE=/dev/null
C='SELECT "lead_notes",COUNT(*) FROM lead_notes UNION ALL SELECT "lead_status_history",COUNT(*) FROM lead_status_history UNION ALL SELECT "leads",COUNT(*) FROM leads UNION ALL SELECT "lead_imports",COUNT(*) FROM lead_imports UNION ALL SELECT "site_settings",COUNT(*) FROM site_settings;'
mysql parr_staging -N -e "$C"
mysql parr_staging -e "DELETE FROM lead_notes; DELETE FROM lead_status_history; DELETE FROM leads; DELETE FROM lead_imports; DELETE FROM site_settings;"
mysql parr_staging -N -e "$C"
```
Gate: as 5 contagens em **0** depois do DELETE → PASSOU (senão PARAR). `local_users`/`users` ficam (admin #120005 e comercial de teste).
Export em `/srv/parr/parr-export.json` (`install -o parr -g parr -m 600`, como na etapa 8; apagar ao fim).
```
sudo -u parr bash -lc "cd /srv/parr/staging && set -a && . /etc/parr/staging.env && set +a && pnpm tsx scripts/import-manus.ts --file /srv/parr/parr-export.json --mode leads --dry-run"
sudo -u parr bash -lc "cd /srv/parr/staging && set -a && . /etc/parr/staging.env && set +a && pnpm tsx scripts/import-manus.ts --file /srv/parr/parr-export.json --mode leads --apply"
mysql parr_staging -N -e "$C"
```
Gate: `PASSOU` nos dois; contagens 0 / 896 / 888 / 1 / 1 → PASSOU. Conferir no painel: 888 leads no Kanban,
histórico de um lead com transição mostrando o nome do autor (sem `userId`), Configurações com o vídeo.

## 10. Smoke de produção (links públicos ainda na Manus)

- `https://parr.primetax.com.br/` abre a landing; formulário cria lead (aparece no Kanban) e o e-mail de
  `NOTIFY_EMAIL_TO` chega (se preenchido).
- `/login` com o admin: troca de senha forçada → dashboard; Configurações e Importar visíveis.
- Convidar um comercial de teste: e-mail chega com link `https://parr.primetax.com.br/ativar-conta?token=…`;
  ativa; vê só Clientes/Calendário.
- `chrome://` sem oferta de tradução; `document.documentElement.lang === "pt-BR"`.
- iPhone: landing e login.

## Operação

- Deploy: `bash /srv/parr/prod/scripts/deploy-prod.sh 2>&1 | tee /root/deploy-prod.log`.
- Rollback rápido: as duas linhas impressas no fim do log (`dist-prev` = build anterior).
- Logs: `journalctl -u parr-prod -f`; nginx em `/var/log/nginx/parr-prod.*.log`.
- Env: nunca `cat`; sempre o `awk` PREENCHIDA/VAZIA.
