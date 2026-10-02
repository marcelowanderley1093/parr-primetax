# Fase A (base de editais PGFN) no staging

Escopo: migrações 0010 e 0011, deploy do Kanban paginado e carga da base de editais (cerca de 340 mil leads e
542 mil procedimentos) no **staging**. Produção não é tocada: ela só recebe a Fase A junto com a Fase B
(carteiras e acesso por dono), porque com a Fase A sozinha qualquer usuário logado vê a base inteira.

Cada bloco termina com `PASSOU` ou `PARAR`. Ao `PARAR`, interromper e colar a saída para o Claude.
🖥️ LOCAL = PowerShell no Windows (`PS C:\...`). 🌐 SERVIDOR = `ssh parr-vps` (`root@parr-primetax`).

## 1. 🖥️ LOCAL: merge e push

```
cd C:\Users\marce\parr-primetax
git switch main
git merge --no-ff feat/editais-base -m "Merge branch 'feat/editais-base'"
git push origin main
$s = git status --porcelain; $b = git rev-parse --abbrev-ref HEAD; $l = git rev-parse HEAD; $r = git rev-parse origin/main; if (-not $s -and $b -eq "main" -and $l -eq $r) { "PASSOU" } else { "PARAR" }
```

## 2. 🖥️ LOCAL: enviar o CSV da base para a VPS

O CSV foi gerado por `scripts/converter-editais.ts` a partir da planilha. Ele contém dados pessoais publicados nos
editais (nome e CPF parcial) e fica fora do Git e de pastas sincronizadas.
```
Get-Item C:\Users\marce\parr-primetax\data\input\editais-consolidado.csv | Select-Object Length
scp C:\Users\marce\parr-primetax\data\input\editais-consolidado.csv parr-vps:/root/editais-consolidado.csv
```

## 3. 🌐 SERVIDOR: arquivo, memória e backup

```
install -o parr -g parr -m 600 /root/editais-consolidado.csv /srv/parr/editais-consolidado.csv; rm -f /root/editais-consolidado.csv
S=$(stat -c '%s' /srv/parr/editais-consolidado.csv); H=$(head -1 /srv/parr/editais-consolidado.csv | cut -c1-30); A=$(free -m | awk '/^Mem:/{print $7}'); echo "bytes=$S cabecalho=$H memoria_disponivel_MB=$A"; if [ "${S:-0}" -gt 80000000 ] && [ "$H" = "ano;numeroEdital;dataPublicaca" ] && [ "${A:-0}" -ge 2000 ]; then echo PASSOU; else echo PARAR; fi
systemctl start parr-backup@staging.service
ID=$(systemctl show -p InvocationID --value parr-backup@staging.service); G=$(journalctl _SYSTEMD_INVOCATION_ID="$ID" --no-pager | grep -c 'PASSOU: gate'); R=$(systemctl show -p Result --value parr-backup@staging.service); F=$(ls -1t /var/backups/parr/parr_staging/parr_staging-*.sql.gz | head -1); M=$(find "$F" -mmin -10 | wc -l); echo "gates=$G/8 result=$R recente=$M"; if [ "$G" = "8" ] && [ "$R" = "success" ] && [ "$M" = "1" ]; then echo PASSOU; else echo PARAR; fi
```
A carga usa cerca de 1,5 GB de memória. Se a memória disponível for menor que 2000 MB, `PARAR`: não rodar a carga.

## 4. 🌐 SERVIDOR: código e migrações 0010 + 0011

```
sudo -u parr bash -lc "cd /srv/parr/staging && git fetch --prune origin && git pull --ff-only && pnpm install --frozen-lockfile"
N0=$(mysql -N -e "SELECT COUNT(*) FROM parr_staging.__drizzle_migrations"); echo "migracoes antes: $N0"
sudo -u parr bash -lc "cd /srv/parr/staging && set -a && . /etc/parr/staging.env && set +a && pnpm exec drizzle-kit migrate"
N1=$(mysql -N -e "SELECT COUNT(*) FROM parr_staging.__drizzle_migrations"); T=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='parr_staging' AND TABLE_NAME IN ('editais','lead_procedimentos')"); C=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='parr_staging' AND TABLE_NAME='leads' AND COLUMN_NAME IN ('cpfParcial','grupoId','primeiraPublicacao','ultimaPublicacao','responsavelId','atribuidoEm','arquivadoEm','arquivadoMotivo','arquivadoPorId')"); I=$(mysql -N -e "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='parr_staging' AND TABLE_NAME='leads' AND INDEX_NAME='leads_status_ultimaPublicacao_idx'"); L=$(mysql -N -e "SELECT COUNT(*) FROM parr_staging.leads"); S=$(sudo -u parr bash -lc "cd /srv/parr/staging && git status --porcelain"); echo "migracoes=$N0->$N1 tabelas=$T/2 colunas=$C/9 indice_kanban=$I leads=$L status='$S'"; if [ "$N1" = "$((N0+2))" ] && [ "$T" = "2" ] && [ "$C" = "9" ] && [ "$I" = "1" ] && [ -z "$S" ]; then echo PASSOU; else echo PARAR; fi
```

## 5. 🌐 SERVIDOR: deploy normal do staging

```
bash /srv/parr/staging/scripts/deploy-staging.sh 2>&1 | tee /root/deploy-staging.log
G=$(grep -c '^PASSOU: gate' /root/deploy-staging.log); echo "gates=$G/10"; if [ "$G" = "10" ]; then echo PASSOU; else echo PARAR; fi
```

## 6. 🌐 SERVIDOR: simulação da carga (nada é gravado)

```
sudo -u parr bash -lc "cd /srv/parr/staging && set -a && . /etc/parr/staging.env && set +a && NODE_OPTIONS=--max-old-space-size=3072 pnpm tsx scripts/import-editais.ts --file /srv/parr/editais-consolidado.csv --dry-run" 2>&1 | tee /root/import-editais-dry.log
L=$(tail -1 /root/import-editais-dry.log); P=$(mysql -N -e "SELECT COUNT(*) FROM parr_staging.lead_procedimentos"); echo "ultima_linha=$L procedimentos_no_banco=$P"; if [ "$L" = "PASSOU" ] && [ "$P" = "0" ]; then echo PASSOU; else echo PARAR; fi
```
**Colar a saída inteira para o Claude** (só contagens). A gravação (passo 7) só depois da conferência.

## 7. 🌐 SERVIDOR: carga (grava)

Leva alguns minutos. Se cair no meio, rodar o mesmo comando de novo: ele completa sem duplicar.
```
M=$(mysql -N -e "SELECT COALESCE(MAX(id),0) FROM parr_staging.leads"); U0=$(mysql -N -e "SELECT SUM(UNIX_TIMESTAMP(updatedAt)) FROM parr_staging.leads WHERE id <= $M"); echo "leads existentes ate id $M"
sudo -u parr bash -lc "cd /srv/parr/staging && set -a && . /etc/parr/staging.env && set +a && NODE_OPTIONS=--max-old-space-size=3072 pnpm tsx scripts/import-editais.ts --file /srv/parr/editais-consolidado.csv --apply" 2>&1 | tee /root/import-editais-apply.log
L=$(tail -1 /root/import-editais-apply.log); D=$(grep -c 'DIVERGE' /root/import-editais-apply.log); U1=$(mysql -N -e "SELECT SUM(UNIX_TIMESTAMP(updatedAt)) FROM parr_staging.leads WHERE id <= $M"); echo "ultima_linha=$L divergencias=$D updatedAt_existentes_igual=$([ "$U0" = "$U1" ] && echo sim || echo nao)"; if [ "$L" = "PASSOU" ] && [ "$D" = "0" ] && [ "$U0" = "$U1" ]; then echo PASSOU; else echo PARAR; fi
```

## 8. Conferência na tela

https://staging.parr.primetax.com.br → Clientes:
- contadores das colunas na casa das centenas de milhares; "Carregar mais" no fim de cada coluna;
- busca por nome, por CNPJ e por nº do procedimento;
- card com "Edital de dd/mm/aaaa" e o selo do prazo;
- LeadDetail com o card "Editais" (procedimentos e prazo estimado).

O CSV fica em `/srv/parr/editais-consolidado.csv` até a carga em produção (Fase B) e é apagado depois dela.
