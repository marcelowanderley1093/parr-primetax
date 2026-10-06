# Histórico dos critérios de distribuição: migração 0013 (staging, depois produção)

Decisão 06/10/2026 (Marcelo): registrar por parceiro cada filtro salvo, atribuição e redistribuição (quem, quando,
critérios e números); só admin vê, na aba Distribuição. A migração **0013 só cria a tabela `carteira_historico`**
(e um índice); nenhuma tabela existente muda e nenhum dado é copiado. O filtro salvo antes do histórico aparece como
primeira linha ("antes do histórico"), lido de `carteiras`.

🌐 SERVIDOR = `ssh parr-vps` (`root@parr-primetax`). Cada bloco termina com `PASSOU` ou `PARAR`; ao `PARAR`,
interromper e colar a saída para o Claude. Um bloco por vez.

## Staging

### S1. Backup do staging
```
systemctl start parr-backup@staging.service
ID=$(systemctl show -p InvocationID --value parr-backup@staging.service); G=$(journalctl _SYSTEMD_INVOCATION_ID="$ID" --no-pager | grep -c 'PASSOU: gate'); R=$(systemctl show -p Result --value parr-backup@staging.service); F=$(ls -1t /var/backups/parr/parr_staging/parr_staging-*.sql.gz | head -1); M=$(find "$F" -mmin -10 | wc -l); echo "gates=$G/8 result=$R recente=$M"; if [ "$G" = "8" ] && [ "$R" = "success" ] && [ "$M" = "1" ]; then echo PASSOU; else echo PARAR; fi
```

### S2. Código e migração 0013
```
sudo -u parr bash -lc "cd /srv/parr/staging && git fetch --prune origin && git pull --ff-only && pnpm install --frozen-lockfile"
N0=$(mysql -N -e "SELECT COUNT(*) FROM parr_staging.__drizzle_migrations"); echo "migracoes antes: $N0"
sudo -u parr bash -lc "cd /srv/parr/staging && set -a && . /etc/parr/staging.env && set +a && pnpm exec drizzle-kit migrate"
N1=$(mysql -N -e "SELECT COUNT(*) FROM parr_staging.__drizzle_migrations"); T=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='parr_staging' AND TABLE_NAME='carteira_historico'"); I=$(mysql -N -e "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='parr_staging' AND TABLE_NAME='carteira_historico' AND INDEX_NAME='carteira_historico_responsavel_idx'"); S=$(sudo -u parr bash -lc "cd /srv/parr/staging && git status --porcelain"); echo "migracoes=$N0->$N1 tabela=$T indice=$I status='$S'"; if [ "$N1" = "$((N0+1))" ] && [ "$T" = "1" ] && [ "$I" = "1" ] && [ -z "$S" ]; then echo PASSOU; else echo PARAR; fi
```

### S3. Deploy do staging
```
bash /srv/parr/staging/scripts/deploy-staging.sh 2>&1 | tee /root/deploy-staging.log | tail -2
G=$(grep -c '^PASSOU: gate' /root/deploy-staging.log); echo "gates=$G/10"; if [ "$G" = "10" ]; then echo PASSOU; else echo PARAR; fi
```

### S4. Validação na tela (staging.parr.primetax.com.br, aba Distribuição)
1. Selecionar um parceiro com filtro salvo: o quadro **Histórico de critérios** mostra a linha "antes do histórico".
2. Mudar um critério e **Salvar filtro do parceiro**: aparecem a linha anterior (com a data real) e a nova.
3. **Calcular redistribuição → Redistribuir**: aparece a linha "Redistribuição" com os números.
4. **Usar este filtro** numa linha antiga: o formulário recebe os critérios (só valem depois de salvar).
5. Entrar como parceiro: a aba Distribuição não aparece.

## Produção (só depois do staging validado)

### P1. Backup da produção
```
systemctl start parr-backup@prod.service
ID=$(systemctl show -p InvocationID --value parr-backup@prod.service); G=$(journalctl _SYSTEMD_INVOCATION_ID="$ID" --no-pager | grep -c 'PASSOU: gate'); R=$(systemctl show -p Result --value parr-backup@prod.service); F=$(ls -1t /var/backups/parr/parr_prod/parr_prod-*.sql.gz | head -1); M=$(find "$F" -mmin -10 | wc -l); echo "gates=$G/8 result=$R recente=$M"; if [ "$G" = "8" ] && [ "$R" = "success" ] && [ "$M" = "1" ]; then echo PASSOU; else echo PARAR; fi
```

### P2. Código e migração 0013
```
sudo -u parr bash -lc "cd /srv/parr/prod && git fetch --prune origin && git pull --ff-only && pnpm install --frozen-lockfile"
N0=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.__drizzle_migrations"); echo "migracoes antes: $N0"
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm exec drizzle-kit migrate"
N1=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.__drizzle_migrations"); T=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='parr_prod' AND TABLE_NAME='carteira_historico'"); I=$(mysql -N -e "SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='parr_prod' AND TABLE_NAME='carteira_historico' AND INDEX_NAME='carteira_historico_responsavel_idx'"); S=$(sudo -u parr bash -lc "cd /srv/parr/prod && git status --porcelain"); echo "migracoes=$N0->$N1 tabela=$T indice=$I status='$S'"; if [ "$N1" = "$((N0+1))" ] && [ "$T" = "1" ] && [ "$I" = "1" ] && [ -z "$S" ]; then echo PASSOU; else echo PARAR; fi
```

### P3. Deploy da produção
```
bash /srv/parr/prod/scripts/deploy-prod.sh 2>&1 | tee /root/deploy-prod.log | tail -2
G=$(grep -c '^PASSOU: gate' /root/deploy-prod.log); echo "gates=$G/10"; if [ "$G" = "10" ]; then echo PASSOU; else echo PARAR; fi
```
Conferir na tela o quadro **Histórico de critérios** de um parceiro.
