# Produção do PARR na VPS — montagem e operação

Tudo aqui é **na VPS** (`ssh parr-vps` primeiro), como root salvo indicação. Nenhum comando exibe,
digita ou grava segredo no histórico: senhas e chaves são geradas em variáveis do shell, gravadas
com `printf` em `/etc/parr/` e apagadas com `unset`. Cada etapa termina com um gate que **imprime**
`PASSOU` ou `PARAR` — não conferir a olho; ao `PARAR`, interromper e reportar.

Constantes: diretório `/srv/parr/prod` · usuário `parr` · serviço `parr-prod` · porta `127.0.0.1:3102` ·
banco `parr_prod` · domínio `parr.primetax.com.br` · branch `main`.

Ordem: §0 → §1 → §2–3 → §4 → §5 → §6 → §7 → §9.0 (levar o export) → §9 (ensaio no staging) → §8 (produção) → §10.

## 0. Atualizações do sistema (antes de tudo, dentro de `screen`)

```
screen -S updates
export DEBIAN_FRONTEND=noninteractive
apt update
apt list --upgradable
apt -o Dpkg::Options::="--force-confold" upgrade -y
[ -f /var/run/reboot-required ] && echo "REBOOT NECESSARIO" || echo "sem reboot"
```
(`--force-confold` = se o dpkg perguntar sobre arquivo de configuração, mantém a versão instalada.
Se a sessão cair, `screen -r updates`.) Se pedir reboot: `reboot`, reconectar e checar o que já estava no ar:
```
A=$(systemctl is-active mysql nginx parr-staging | tr '\n' ' '); H=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/); TZ_=$(mysql -N -e "SELECT CONCAT(@@global.time_zone,' ',@@session.time_zone,' ',NOW()=UTC_TIMESTAMP());"); echo "servicos: $A http_staging=$H tz: $TZ_"; if [ "$A" = "active active active " ] && [ "$H" = "200" ] && [ "$TZ_" = "+00:00 +00:00 1" ]; then echo PASSOU; else echo PARAR; fi
```

## 1. Diretório e clone via SSH (deploy key, como no staging)

O repo é privado: clonar por **SSH** com a deploy key já usada pelo staging (https pediria credencial).
Confirmar o formato do remoto do staging:
```
R=$(sudo -u parr bash -lc "cd /srv/parr/staging && git remote get-url origin"); echo "staging origin: $R"; if [ "$R" = "git@github.com:marcelowanderley1093/parr-primetax.git" ]; then echo PASSOU; else echo "PARAR: formato inesperado — use exatamente este remoto no clone abaixo"; fi
```
Clone e install:
```
mkdir -p /srv/parr/prod; chown parr:parr /srv/parr/prod
sudo -u parr bash -lc "git clone --branch main git@github.com:marcelowanderley1093/parr-primetax.git /srv/parr/prod"
sudo -u parr bash -lc "cd /srv/parr/prod && pnpm install --frozen-lockfile"
B=$(sudo -u parr bash -lc "cd /srv/parr/prod && git rev-parse --abbrev-ref HEAD"); S=$(sudo -u parr bash -lc "cd /srv/parr/prod && git status --porcelain"); M=$(sudo -u parr bash -lc "cd /srv/parr/prod && test -d node_modules/.pnpm && echo ok"); echo "branch=$B status='$S' node_modules=$M"; if [ "$B" = "main" ] && [ -z "$S" ] && [ "$M" = "ok" ]; then echo PASSOU; else echo PARAR; fi
```
(Instalar **com** devDependencies: `dist/index.js` importa `vite` — backlog.)

## 2–3. Banco `parr_prod`, usuário e `/etc/parr/prod.env` — uma sequência, sem segredo visível

Tudo no **mesmo shell**. Nada é digitado nem impresso; `MYSQL_HISTFILE=/dev/null` e `HISTFILE` vazio
evitam registro no histórico. Senha em **hex** (base64 tem `/`, `+`, `=` que quebram a `DATABASE_URL`).
```
export MYSQL_HISTFILE=/dev/null; unset HISTFILE
DBPASS=$(openssl rand -hex 24); JWT=$(openssl rand -hex 32)
mysql -e "CREATE DATABASE parr_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
mysql -e "CREATE USER 'parr_prod'@'127.0.0.1' IDENTIFIED BY '${DBPASS}';"
mysql -e "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES ON parr_prod.* TO 'parr_prod'@'127.0.0.1'; FLUSH PRIVILEGES;"
install -o root -g parr -m 640 /dev/null /etc/parr/prod.env
printf 'NODE_ENV=production\nHOST=127.0.0.1\nPORT=3102\nDATABASE_URL=mysql://parr_prod:%s@127.0.0.1:3306/parr_prod\nJWT_SECRET=%s\nPUBLIC_BASE_URL=https://parr.primetax.com.br\n' "$DBPASS" "$JWT" > /etc/parr/prod.env
grep -E '^SMTP_(HOST|PORT|USER|PASS|FROM)=' /etc/parr/staging.env >> /etc/parr/prod.env
printf 'NOTIFY_EMAIL_TO=\nGOOGLE_CALENDAR_CLIENT_ID=\nGOOGLE_CALENDAR_CLIENT_SECRET=\nPIPEDRIVE_API_TOKEN=\nPIPEDRIVE_DOMAIN=\n' >> /etc/parr/prod.env
unset DBPASS JWT
```
Conferência (sem valores) e gate:
```
awk -F= '{print $1": "($2==""?"VAZIA":"PREENCHIDA")}' /etc/parr/prod.env
P=$(stat -c '%a %U:%G' /etc/parr/prod.env); F=$(awk -F= '$2!=""{print $1}' /etc/parr/prod.env | grep -c -E '^(DATABASE_URL|JWT_SECRET|PUBLIC_BASE_URL|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_FROM)$'); C=$(grep -c -E '^(NODE_ENV|HOST|PORT|DATABASE_URL|JWT_SECRET|PUBLIC_BASE_URL|SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|SMTP_FROM|NOTIFY_EMAIL_TO|GOOGLE_CALENDAR_CLIENT_ID|GOOGLE_CALENDAR_CLIENT_SECRET|PIPEDRIVE_API_TOKEN|PIPEDRIVE_DOMAIN)=' /etc/parr/prod.env); D=$(mysql -N -e "SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='parr_prod'"); U=$(mysql -N -e "SELECT COUNT(*) FROM mysql.user WHERE user='parr_prod' AND host='127.0.0.1'"); echo "perm=$P preenchidas_obrigatorias=$F/8 chaves=$C/16 db=$D user=$U"; if [ "$P" = "640 root:parr" ] && [ "$F" -eq 8 ] && [ "$C" -eq 16 ] && [ "$D" = "utf8mb4" ] && [ "$U" = "1" ]; then echo PASSOU; else echo PARAR; fi
```
Nenhuma chave do staging pode faltar na produção (compara **só os nomes**, nunca os valores):
```
diff <(grep -oE '^[A-Z_]+=' /etc/parr/staging.env | sort -u) <(grep -oE '^[A-Z_]+=' /etc/parr/prod.env | sort -u) > /tmp/envdiff.txt; F=$(grep -c '^<' /tmp/envdiff.txt); echo "chaves faltando na producao: $F"; grep '^<' /tmp/envdiff.txt | tr -d '<= '; grep '^>' /tmp/envdiff.txt | sed 's/^> /so na producao: /' | tr -d '='; rm -f /tmp/envdiff.txt; if [ "$F" = "0" ]; then echo PASSOU; else echo PARAR; fi
```
`NOTIFY_EMAIL_TO`, Calendar e Pipedrive ficam **VAZIAS** por ora (Calendar entra na virada, com a redirect
URI de produção no Google Cloud Console). `PUBLIC_BASE_URL` sem barra final (o boot rejeita).

## 4. Migração — banco vazio recebe o schema

**Em produção, migração é SOMENTE `pnpm exec drizzle-kit migrate`.** Nunca `pnpm db:push` (encadeia
`generate`), nunca `drizzle-kit generate` na VPS: `generate` escreve arquivos em `drizzle/` no clone e
quebra o gate 2 (working tree limpa) de todo deploy seguinte.
```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm exec drizzle-kit migrate"
N=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.__drizzle_migrations"); T=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='parr_prod'"); S=$(sudo -u parr bash -lc "cd /srv/parr/prod && git status --porcelain"); echo "migrations=$N tabelas=$T status='$S'"; if [ "$N" = "9" ] && [ "$T" = "8" ] && [ -z "$S" ]; then echo PASSOU; else echo PARAR; fi
```
(8 tabelas = 7 do schema + `__drizzle_migrations`. O `. /etc/parr/prod.env` roda no shell do `parr`, por isso
o arquivo é `640 root:parr`.) Migrações futuras: mesmo comando, só após `PARAR` do gate 4 do deploy, com
planejamento e backup antes.

## 5. Serviço systemd

```
cp /srv/parr/prod/deploy/parr-prod.service /etc/systemd/system/parr-prod.service
systemctl daemon-reload
systemctl enable parr-prod
systemctl is-enabled parr-prod
```
Não iniciar ainda: `dist/` só existe após o primeiro deploy (§7).

## 6. nginx (HTTP) + DNS + TLS

```
cp /srv/parr/prod/deploy/nginx-parr-prod.conf /etc/nginx/sites-available/parr-prod.conf
ln -sf /etc/nginx/sites-available/parr-prod.conf /etc/nginx/sites-enabled/parr-prod.conf
nginx -t && systemctl reload nginx
```
DNS (Hostinger): registro **A** `parr` → IP público da VPS (TTL 300). Gate de propagação (`dig` pode não
existir; `getent` usa o resolver do sistema):
```
IP=$(curl -s -4 https://api.ipify.org); R=$(getent ahosts parr.primetax.com.br | awk '{print $1}' | sort -u | tr '\n' ' '); echo "vps=$IP dns='$R'"; if [ -n "$IP" ] && [ "$R" = "$IP " ]; then echo PASSOU; else echo "PARAR: aguardar propagacao"; fi
```
TLS, só após o `PASSOU` acima (`--redirect` faz 80 → 443):
```
certbot --nginx -d parr.primetax.com.br --redirect
nginx -t; systemctl reload nginx
H=$(curl -s -o /dev/null -w '%{http_code}' -I https://parr.primetax.com.br/ ); echo "https_head=$H (502 e normal antes do primeiro deploy)"; if nginx -t >/dev/null 2>&1 && [ -f /etc/letsencrypt/live/parr.primetax.com.br/fullchain.pem ]; then echo PASSOU; else echo PARAR; fi
```
Sem `auth_basic` e sem `X-Robots-Tag` (landing pública). A `location` do callback do Calendar é mantida.

## 7. Primeiro deploy

```
bash /srv/parr/prod/scripts/deploy-prod.sh 2>&1 | tee /root/deploy-prod.log
G=$(grep -c '^PASSOU: gate' /root/deploy-prod.log); H=$(curl -s -o /dev/null -w '%{http_code}' https://parr.primetax.com.br/); T=$(curl -s https://parr.primetax.com.br/ | grep -o -m1 '<html[^>]*>'); echo "gates=$G/10 https=$H tag=$T"; if [ "$G" = "10" ] && [ "$H" = "200" ] && [ "$T" = '<html lang="pt-BR" translate="no">' ]; then echo PASSOU; else echo PARAR; fi
```
Falha no build **não** derruba nada (build em `dist-next/`); o log termina com as duas linhas de rollback.
Formato conferido no script: `deploy-prod.sh` imprime **10** linhas `PASSOU: gate N: …` (função
`passou() { echo "PASSOU: $*"; }`, gates 1–10) num deploy com sucesso.

## 9.0. Levar o export para a VPS (no PowerShell do Windows)

O export tem dados pessoais e hashes: salvar **fora** de pastas sincronizadas (Drive/OneDrive) e apagar ao
fim do §8. No **PowerShell**, na máquina local:
```
# salvar o export final da Manus como C:\Users\marce\parr-export.json (nunca em OneDrive/Drive)
Get-Item C:\Users\marce\parr-export.json | Select-Object FullName, Length, LastWriteTime
scp C:\Users\marce\parr-export.json parr-vps:/root/parr-export.json
```
Gate, **na VPS**:
```
ls -la /root/parr-export.json; S=$(stat -c '%s' /root/parr-export.json 2>/dev/null); J=$(head -c 1 /root/parr-export.json); echo "bytes=$S primeiro_char=$J"; if [ "${S:-0}" -gt 100000 ] && [ "$J" = "{" ]; then echo PASSOU; else echo PARAR; fi
```

## 9. Ensaio do import só-leads no staging (antes do §8)

Export copiado para fora dos clones, legível só pelo `parr`
(este arquivo é **reutilizado no §8**; só é apagado ao fim do §8):
```
install -o parr -g parr -m 600 /root/parr-export.json /srv/parr/parr-export.json
```
Esvaziar **só** as 5 tabelas do modo, com banco explícito e contagem antes/depois:
```
export MYSQL_HISTFILE=/dev/null
C='SELECT COUNT(*) FROM lead_notes UNION ALL SELECT COUNT(*) FROM lead_status_history UNION ALL SELECT COUNT(*) FROM leads UNION ALL SELECT COUNT(*) FROM lead_imports UNION ALL SELECT COUNT(*) FROM site_settings'
echo "antes (notes,history,leads,imports,settings):"; mysql parr_staging -N -e "$C" | tr '\n' ' '; echo
mysql parr_staging -e "DELETE FROM lead_notes; DELETE FROM lead_status_history; DELETE FROM leads; DELETE FROM lead_imports; DELETE FROM site_settings;"
Z=$(mysql parr_staging -N -e "$C" | tr '\n' ' '); echo "depois: $Z"; if [ "$Z" = "0 0 0 0 0 " ]; then echo PASSOU; else echo PARAR; fi
```
`local_users`/`users` ficam (admin #120005 e comercial de teste). Dry-run, apply e gate:
```
sudo -u parr bash -lc "cd /srv/parr/staging && set -a && . /etc/parr/staging.env && set +a && pnpm tsx scripts/import-manus.ts --file /srv/parr/parr-export.json --mode leads --dry-run" 2>&1 | tee /root/import-staging-dry.log
tail -1 /root/import-staging-dry.log
sudo -u parr bash -lc "cd /srv/parr/staging && set -a && . /etc/parr/staging.env && set +a && pnpm tsx scripts/import-manus.ts --file /srv/parr/parr-export.json --mode leads --apply" 2>&1 | tee /root/import-staging-apply.log
Z=$(mysql parr_staging -N -e "$C" | tr '\n' ' '); L=$(tail -1 /root/import-staging-apply.log); K=$(grep -c '^  COMMIT$' /root/import-staging-apply.log); O=$(grep -c ' -> ok$' /root/import-staging-apply.log); echo "contagens: $Z ultima_linha=$L commit=$K linhas_ok=$O/4"; if [ "$Z" = "0 896 888 1 1 " ] && [ "$L" = "PASSOU" ] && [ "$K" = "1" ] && [ "$O" = "4" ]; then echo PASSOU; else echo PARAR; fi
```
Conferir no painel do staging: 888 leads no Kanban; histórico de um lead com transição mostrando o nome do
autor (sem `userId`); Configurações com o vídeo. **Não apagar o export aqui.**

## 8. Produção: admin, import só-leads, backup

**Admin.** A saída abaixo **contém a senha temporária** (impressa uma única vez): ler no terminal, usar
no primeiro login (troca forçada) e **não colar em chat, documento ou mensagem**. Terminal com histórico
desativado:
```
unset HISTFILE
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && ADMIN_EMAIL='marcelo@primetax.com.br' ADMIN_NOME='Marcelo Wanderley' pnpm tsx scripts/criar-admin.ts"
A=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.local_users WHERE role='admin' AND active=1 AND mustChangePassword=1"); echo "admins_pendentes=$A"; if [ "$A" = "1" ]; then echo PASSOU; else echo PARAR; fi
```
**Import** (o mesmo `/srv/parr/parr-export.json` do §9):
```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm tsx scripts/import-manus.ts --file /srv/parr/parr-export.json --mode leads --dry-run" 2>&1 | tee /root/import-prod-dry.log
L=$(tail -1 /root/import-prod-dry.log); R=$(grep -c '^  ROLLBACK (dry-run)$' /root/import-prod-dry.log); Z=$(grep -c 'time_zone: global=+00:00 session=+00:00' /root/import-prod-dry.log); O=$(grep -c ' -> ok$' /root/import-prod-dry.log); echo "ultima_linha=$L rollback=$R tz=$Z linhas_ok=$O/4"; if [ "$L" = "PASSOU" ] && [ "$R" = "1" ] && [ "$Z" = "1" ] && [ "$O" = "4" ]; then echo PASSOU; else echo PARAR; fi
```
Só após o `PASSOU`:
```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm tsx scripts/import-manus.ts --file /srv/parr/parr-export.json --mode leads --apply" 2>&1 | tee /root/import-prod-apply.log
C='SELECT COUNT(*) FROM lead_notes UNION ALL SELECT COUNT(*) FROM lead_status_history UNION ALL SELECT COUNT(*) FROM leads UNION ALL SELECT COUNT(*) FROM lead_imports UNION ALL SELECT COUNT(*) FROM site_settings'
Z=$(mysql parr_prod -N -e "$C" | tr '\n' ' '); L=$(tail -1 /root/import-prod-apply.log); K=$(grep -c '^  COMMIT$' /root/import-prod-apply.log); O=$(grep -c ' -> ok$' /root/import-prod-apply.log); echo "contagens: $Z ultima_linha=$L commit=$K linhas_ok=$O/4"; if [ "$Z" = "0 896 888 1 1 " ] && [ "$L" = "PASSOU" ] && [ "$K" = "1" ] && [ "$O" = "4" ]; then echo PASSOU; else echo PARAR; fi
```
Apagar as cópias do export (dados pessoais) — só agora, depois do §9 e do §8. **Na VPS**:
```
rm -f /srv/parr/parr-export.json /root/parr-export.json
ls /srv/parr/parr-export.json /root/parr-export.json 2>/dev/null | wc -l | grep -qx 0 && echo PASSOU || echo PARAR
```
E a cópia local, no **PowerShell** do Windows:
```
Remove-Item C:\Users\marce\parr-export.json
if (Test-Path C:\Users\marce\parr-export.json) { "PARAR" } else { "PASSOU" }
```
Formato conferido no script: `import-manus.ts` termina com a linha exata `PASSOU` (ou
`PARAR: contagem divergente em …`), imprime `  COMMIT` no apply, `  ROLLBACK (dry-run)` no dry-run, a linha
`modo: leads · time_zone: global=… session=…` e uma linha por tabela terminada em `-> ok` (4 no modo leads).

**Backup**: seguir `deploy/RESTORE.md` (usuário `parr_backup`, `backup-prod.cnf`, timer, **teste de restore** —
cada passo lá tem o próprio gate).

## 10. Smoke de produção (links públicos ainda na Manus)

1. `https://parr.primetax.com.br/` abre a landing; formulário cria um lead de teste (aparece no Kanban);
   e-mail de aviso só chega se `NOTIFY_EMAIL_TO` estiver preenchida.
2. `/login` com o admin: troca de senha forçada → dashboard; abas Importar e Configurações visíveis.
3. Convidar um **comercial de teste**: o e-mail chega com link `https://parr.primetax.com.br/ativar-conta?token=…`;
   ativa; vê só Clientes/Calendário.
4. No Chrome, sem oferta de tradução (`document.documentElement.lang === "pt-BR"`). iPhone: landing e login.
5. **Limpeza pós-smoke**: excluir o lead de teste pelo painel (detalhe do lead → Excluir) e desativar o
   comercial de teste (Usuários → toggle). Gate:
```
T=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.leads"); U=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.local_users WHERE role='comercial' AND active=1"); echo "leads=$T comerciais_ativos=$U"; if [ "$T" = "888" ] && [ "$U" = "0" ]; then echo PASSOU; else echo PARAR; fi
```

## Operação

- Deploy: `bash /srv/parr/prod/scripts/deploy-prod.sh 2>&1 | tee /root/deploy-prod.log`.
- Rollback rápido: as duas linhas impressas no fim do log (`dist-prev` = build anterior).
- Logs: `journalctl -u parr-prod -f`; nginx em `/var/log/nginx/parr-prod.*.log`.
- Env: nunca `cat`; sempre o `awk` PREENCHIDA/VAZIA.
