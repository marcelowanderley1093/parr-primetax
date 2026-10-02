# Migração 0009 (EmpresAqui) no staging + simulação da cópia de contatos

Escopo: aplicar a migração `0009_empresaqui_empresas_contatos` no **staging** e rodar **só a simulação**
(`--dry-run`) da cópia `leads.telefoneSocios` → `lead_contatos`. Produção não é tocada.

A 0009 é só aditiva (3 `CREATE TABLE`, 2 colunas novas em `leads`, 4 índices) e o código ainda não usa
nada dela. Mesmo assim: backup antes, um comando por vez, e cada gate imprime `PASSOU` ou `PARAR`.
Ao `PARAR`, interromper e colar a saída para o Claude.

Por que não basta o `deploy-staging.sh`: o gate 4 dele **para de propósito** quando o diff toca `drizzle/`
(migração nunca é automática). Por isso os passos 2–4 fazem à mão o pull + migrate, e o passo 5 roda o
deploy normal (que então passa no gate 4, porque o HEAD já está em `origin/main`).

## 1. Merge na main (PowerShell do Windows, na máquina local)

```
cd C:\Users\marce\parr-primetax
git switch main
git pull --ff-only
git merge --no-ff feat/empresaqui-enriquecimento -m "Merge branch 'feat/empresaqui-enriquecimento'"
git push origin main
```
Gate:
```
$s = git status --porcelain; $b = git rev-parse --abbrev-ref HEAD; $l = git rev-parse HEAD; $r = git rev-parse origin/main; if (-not $s -and $b -eq "main" -and $l -eq $r) { "PASSOU" } else { "PARAR" }
```

## 2. Backup do staging (na VPS: `ssh parr-vps`, como root)

```
systemctl start parr-backup@staging.service
ID=$(systemctl show -p InvocationID --value parr-backup@staging.service); G=$(journalctl _SYSTEMD_INVOCATION_ID="$ID" --no-pager | grep -c 'PASSOU: gate'); R=$(systemctl show -p Result --value parr-backup@staging.service); F=$(ls -1t /var/backups/parr/parr_staging/parr_staging-*.sql.gz 2>/dev/null | head -1); M=$(find "$F" -mmin -10 2>/dev/null | wc -l); echo "gates=$G/8 result=$R dump=$F recente=$M"; if [ "$G" = "8" ] && [ "$R" = "success" ] && [ "$M" = "1" ]; then echo PASSOU; else echo PARAR; fi
```

## 3. Atualizar o código do staging (sem build ainda)

```
sudo -u parr bash -lc "cd /srv/parr/staging && git fetch --prune origin && git pull --ff-only && pnpm install --frozen-lockfile"
S=$(sudo -u parr bash -lc "cd /srv/parr/staging && git status --porcelain"); H=$(sudo -u parr bash -lc "cd /srv/parr/staging && git rev-parse HEAD"); O=$(sudo -u parr bash -lc "cd /srv/parr/staging && git rev-parse origin/main"); F=$(sudo -u parr bash -lc "cd /srv/parr/staging && test -f drizzle/0009_empresaqui_empresas_contatos.sql && echo ok"); echo "status='$S' head=origin/main:$([ "$H" = "$O" ] && echo sim || echo nao) sql0009=$F"; if [ -z "$S" ] && [ "$H" = "$O" ] && [ "$F" = "ok" ]; then echo PASSOU; else echo PARAR; fi
```

## 4. Aplicar a migração 0009

Contagem antes (guarda o número para o gate):
```
N0=$(mysql -N -e "SELECT COUNT(*) FROM parr_staging.__drizzle_migrations"); echo "migracoes antes: $N0"
```
Migração (**somente** `drizzle-kit migrate`; nunca `generate` nem `db:push` na VPS):
```
sudo -u parr bash -lc "cd /srv/parr/staging && set -a && . /etc/parr/staging.env && set +a && pnpm exec drizzle-kit migrate"
```
Gate (mesmo shell, usa `$N0`):
```
N1=$(mysql -N -e "SELECT COUNT(*) FROM parr_staging.__drizzle_migrations"); T=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='parr_staging' AND TABLE_NAME IN ('empresas','lead_contatos','integracao_consultas')"); C=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='parr_staging' AND TABLE_NAME='leads' AND COLUMN_NAME IN ('empresaId','cpf')"); L=$(mysql -N -e "SELECT COUNT(*) FROM parr_staging.leads"); S=$(sudo -u parr bash -lc "cd /srv/parr/staging && git status --porcelain"); echo "migracoes=$N0->$N1 tabelas_novas=$T/3 colunas_novas=$C/2 leads=$L status='$S'"; if [ "$N1" = "$((N0+1))" ] && [ "$T" = "3" ] && [ "$C" = "2" ] && [ -z "$S" ]; then echo PASSOU; else echo PARAR; fi
```

## 5. Deploy normal do staging (build + restart + smoke)

```
bash /srv/parr/staging/scripts/deploy-staging.sh 2>&1 | tee /root/deploy-staging.log
G=$(grep -c '^PASSOU: gate' /root/deploy-staging.log); echo "gates=$G/10"; if [ "$G" = "10" ]; then echo PASSOU; else echo PARAR; fi
```

## 6. Simulação da cópia de contatos (nada é gravado)

```
sudo -u parr bash -lc "cd /srv/parr/staging && set -a && . /etc/parr/staging.env && set +a && pnpm tsx scripts/migrar-contatos.ts --dry-run" 2>&1 | tee /root/migrar-contatos-staging-dry.log
L=$(tail -1 /root/migrar-contatos-staging-dry.log); R=$(grep -c '^  ROLLBACK (dry-run)$' /root/migrar-contatos-staging-dry.log); Z=$(mysql -N -e "SELECT COUNT(*) FROM parr_staging.lead_contatos"); echo "ultima_linha=$L rollback=$R lead_contatos=$Z"; if [ "$L" = "PASSOU" ] && [ "$R" = "1" ] && [ "$Z" = "0" ]; then echo PASSOU; else echo PARAR; fi
```
O relatório só tem contagens (nenhum nome, CPF ou telefone): **colar a saída inteira para o Claude**.
**Não rodar `--apply`** até decidirmos o caso "sócio só com CPF, sem telefone".

Formato conferido no script: `migrar-contatos.ts` termina com a linha exata `PASSOU` (ou `PARAR: …`) e
imprime `  ROLLBACK (dry-run)` no dry-run.
