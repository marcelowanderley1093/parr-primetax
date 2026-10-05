# Virada da produção (05/10/2026): export final da Manus + PARR completo

Leva a produção (`parr_prod`, `/srv/parr/prod`) do estado de setembro (migrações até 0008, 888 leads, versão
`066235d`) ao PARR completo: migrações 0009–0012, export final da Manus, contatos editáveis, base de editais,
EmpresAqui, carteiras. No fim, os links públicos saem da Manus.

Regras: **um bloco por vez**; cada bloco termina com `PASSOU` ou `PARAR`; ao `PARAR`, interromper e colar a saída
para o Claude. Nada é apagado sem backup feito no passo 2.
🖥️ LOCAL = PowerShell no Windows (`PS C:\...`). 🌐 SERVIDOR = `ssh parr-vps` (`root@parr-primetax`).

Durante a janela o site público continua na Manus: leads que entrarem lá **depois do export** (passo 1) precisam
ser conferidos no fim (passo 15).

## 1. 🖥️ LOCAL: export final da Manus

Salvar o export final como `C:\Users\marce\parr-export.json` (fora de OneDrive/Drive). Anotar o horário do export.
```
Get-Item C:\Users\marce\parr-export.json | Select-Object FullName, Length, LastWriteTime
scp C:\Users\marce\parr-export.json parr-vps:/root/parr-export.json
```

## 2. 🌐 SERVIDOR: arquivos, memória e backup da produção

```
install -o parr -g parr -m 600 /root/parr-export.json /srv/parr/parr-export.json; rm -f /root/parr-export.json
S=$(stat -c '%s' /srv/parr/parr-export.json); J=$(head -c 1 /srv/parr/parr-export.json); E=$(stat -c '%s' /srv/parr/editais-consolidado.csv 2>/dev/null); A=$(free -m | awk '/^Mem:/{print $7}'); echo "export_bytes=$S primeiro_char=$J editais_csv_bytes=$E memoria_livre_MB=$A"; if [ "${S:-0}" -gt 100000 ] && [ "$J" = "{" ] && [ "${E:-0}" -gt 80000000 ] && [ "${A:-0}" -ge 2000 ]; then echo PASSOU; else echo PARAR; fi
systemctl start parr-backup@prod.service
ID=$(systemctl show -p InvocationID --value parr-backup@prod.service); G=$(journalctl _SYSTEMD_INVOCATION_ID="$ID" --no-pager | grep -c 'PASSOU: gate'); R=$(systemctl show -p Result --value parr-backup@prod.service); F=$(ls -1t /var/backups/parr/parr_prod/parr_prod-*.sql.gz | head -1); M=$(find "$F" -mmin -10 | wc -l); echo "backup gates=$G/8 result=$R recente=$M dump=$(basename "$F")"; if [ "$G" = "8" ] && [ "$R" = "success" ] && [ "$M" = "1" ]; then echo PASSOU; else echo PARAR; fi
```

## 3. 🌐 SERVIDOR: código novo no clone da produção (o site continua com a versão antiga até o passo 10)

```
sudo -u parr bash -lc "cd /srv/parr/prod && git fetch --prune origin && git pull --ff-only && pnpm install --frozen-lockfile"
S=$(sudo -u parr bash -lc "cd /srv/parr/prod && git status --porcelain"); H=$(sudo -u parr bash -lc "cd /srv/parr/prod && git rev-parse HEAD"); O=$(sudo -u parr bash -lc "cd /srv/parr/prod && git rev-parse origin/main"); echo "status='$S' head_igual_origin=$([ "$H" = "$O" ] && echo sim || echo nao)"; if [ -z "$S" ] && [ "$H" = "$O" ]; then echo PASSOU; else echo PARAR; fi
```

## 4. 🌐 SERVIDOR: migrações 0009 a 0012

Só acrescentam tabelas, colunas e índices. A versão antiga no ar continua funcionando (ignora as colunas novas).
```
N0=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.__drizzle_migrations"); echo "migracoes antes: $N0"
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm exec drizzle-kit migrate"
N1=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.__drizzle_migrations"); T=$(mysql -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='parr_prod' AND TABLE_NAME IN ('empresas','lead_contatos','integracao_consultas','editais','lead_procedimentos','carteiras','lead_eventos')"); L=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.leads"); echo "migracoes=$N0->$N1 tabelas_novas=$T/7 leads=$L"; if [ "$N1" = "13" ] && [ "$T" = "7" ]; then echo PASSOU; else echo PARAR; fi
```

## 5. 🌐 SERVIDOR: esvaziar as 5 tabelas de leads (o export final entra no lugar)

`site_settings` volta com o `videoUrl` do export. Se a Agenda Google já estiver conectada na produção, será preciso
reconectar no fim (passo 14).
```
export MYSQL_HISTFILE=/dev/null
C='SELECT COUNT(*) FROM lead_notes UNION ALL SELECT COUNT(*) FROM lead_status_history UNION ALL SELECT COUNT(*) FROM leads UNION ALL SELECT COUNT(*) FROM lead_imports UNION ALL SELECT COUNT(*) FROM site_settings'
echo "antes (notes,history,leads,imports,settings):"; mysql parr_prod -N -e "$C" | tr '\n' ' '; echo
mysql parr_prod -e "DELETE FROM lead_notes; DELETE FROM lead_status_history; DELETE FROM leads; DELETE FROM lead_imports; DELETE FROM site_settings;"
Z=$(mysql parr_prod -N -e "$C" | tr '\n' ' '); echo "depois: $Z"; if [ "$Z" = "0 0 0 0 0 " ]; then echo PASSOU; else echo PARAR; fi
```

## 6. 🌐 SERVIDOR: import da Manus — simulação (nada é gravado)

A conferência compara o banco com o próprio export (4 tabelas, cada uma terminando em `-> ok`).
```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm tsx scripts/import-manus.ts --file /srv/parr/parr-export.json --mode leads --dry-run" 2>&1 | tee /root/virada-import-dry.log
L=$(tail -1 /root/virada-import-dry.log); R=$(grep -c '^  ROLLBACK (dry-run)$' /root/virada-import-dry.log); Z=$(grep -c 'time_zone: global=+00:00 session=+00:00' /root/virada-import-dry.log); O=$(grep -c ' -> ok$' /root/virada-import-dry.log); echo "ultima_linha=$L rollback=$R tz=$Z linhas_ok=$O/4"; if [ "$L" = "PASSOU" ] && [ "$R" = "1" ] && [ "$Z" = "1" ] && [ "$O" = "4" ]; then echo PASSOU; else echo PARAR; fi
```
Colar para o Claude a seção `=== RELATORIO ===` (só contagens).

## 7. 🌐 SERVIDOR: import da Manus — gravação

```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm tsx scripts/import-manus.ts --file /srv/parr/parr-export.json --mode leads --apply" 2>&1 | tee /root/virada-import-apply.log
L=$(tail -1 /root/virada-import-apply.log); K=$(grep -c '^  COMMIT$' /root/virada-import-apply.log); O=$(grep -c ' -> ok$' /root/virada-import-apply.log); N=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.leads"); echo "ultima_linha=$L commit=$K linhas_ok=$O/4 leads=$N"; if [ "$L" = "PASSOU" ] && [ "$K" = "1" ] && [ "$O" = "4" ]; then echo PASSOU; else echo PARAR; fi
```

## 8. 🌐 SERVIDOR: contatos editáveis e CPF do intimado — simulação, depois gravação

Simulação (colar o RELATORIO para o Claude):
```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm tsx scripts/migrar-contatos.ts --dry-run" 2>&1 | tee /root/virada-contatos-dry.log
L=$(tail -1 /root/virada-contatos-dry.log); Z=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.lead_contatos"); echo "ultima_linha=$L lead_contatos=$Z"; if [ "$L" = "PASSOU" ] && [ "$Z" = "0" ]; then echo PASSOU; else echo PARAR; fi
```
Gravação (só depois da conferência):
```
U0=$(mysql -N -e "SELECT SUM(UNIX_TIMESTAMP(updatedAt)) FROM parr_prod.leads")
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm tsx scripts/migrar-contatos.ts --apply" 2>&1 | tee /root/virada-contatos-apply.log
L=$(tail -1 /root/virada-contatos-apply.log); K=$(grep -c '^  COMMIT$' /root/virada-contatos-apply.log); U1=$(mysql -N -e "SELECT SUM(UNIX_TIMESTAMP(updatedAt)) FROM parr_prod.leads"); echo "ultima_linha=$L commit=$K updatedAt_igual=$([ "$U0" = "$U1" ] && echo sim || echo nao)"; if [ "$L" = "PASSOU" ] && [ "$K" = "1" ] && [ "$U0" = "$U1" ]; then echo PASSOU; else echo PARAR; fi
```

## 9. 🌐 SERVIDOR: base de editais — simulação, depois gravação

Simulação (colar o plano para o Claude):
```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && NODE_OPTIONS=--max-old-space-size=3072 pnpm tsx scripts/import-editais.ts --file /srv/parr/editais-consolidado.csv --dry-run" 2>&1 | tee /root/virada-editais-dry.log
L=$(tail -1 /root/virada-editais-dry.log); P=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.lead_procedimentos"); echo "ultima_linha=$L procedimentos_no_banco=$P"; if [ "$L" = "PASSOU" ] && [ "$P" = "0" ]; then echo PASSOU; else echo PARAR; fi
```
Gravação (alguns minutos; se cair, repetir o mesmo bloco: completa sem duplicar):
```
M=$(mysql -N -e "SELECT COALESCE(MAX(id),0) FROM parr_prod.leads"); U0=$(mysql -N -e "SELECT SUM(UNIX_TIMESTAMP(updatedAt)) FROM parr_prod.leads WHERE id <= $M")
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && NODE_OPTIONS=--max-old-space-size=3072 pnpm tsx scripts/import-editais.ts --file /srv/parr/editais-consolidado.csv --apply" 2>&1 | tee /root/virada-editais-apply.log
L=$(tail -1 /root/virada-editais-apply.log); D=$(grep -c 'DIVERGE' /root/virada-editais-apply.log); U1=$(mysql -N -e "SELECT SUM(UNIX_TIMESTAMP(updatedAt)) FROM parr_prod.leads WHERE id <= $M"); echo "ultima_linha=$L divergencias=$D updatedAt_existentes_igual=$([ "$U0" = "$U1" ] && echo sim || echo nao)"; if [ "$L" = "PASSOU" ] && [ "$D" = "0" ] && [ "$U0" = "$U1" ]; then echo PASSOU; else echo PARAR; fi
```

## 10. 🌐 SERVIDOR: deploy da produção (versão nova no ar)

O gate 4 do script passa porque o código já foi atualizado no passo 3 e as migrações aplicadas no passo 4.
```
bash /srv/parr/prod/scripts/deploy-prod.sh 2>&1 | tee /root/deploy-prod.log | tail -4
G=$(grep -c '^PASSOU: gate' /root/deploy-prod.log); H=$(curl -s -o /dev/null -w '%{http_code}' https://parr.primetax.com.br/); echo "gates=$G/10 https=$H"; if [ "$G" = "10" ] && [ "$H" = "200" ]; then echo PASSOU; else echo PARAR; fi
```

## 11. Tela (produção): EmpresAqui

https://parr.primetax.com.br → login admin → **Importar** → seção **Atualizar empresas (EmpresAqui)** → arquivo
`data/input/minhalista-empresaqui-...csv` → prévia → **Importar**.

## 12. 🌐 SERVIDOR: leads em andamento → quem os moveu (simulação)

```
sudo -u parr bash -lc "cd /srv/parr/prod && set -a && . /etc/parr/prod.env && set +a && pnpm tsx scripts/atribuir-andamento.ts --dry-run" 2>&1 | tail -15
```
Colar para o Claude. Pendentes "autor desconhecido" se resolvem à mão (card Carteira → Transferir).

## 13. Tela (produção): parceiros e distribuição

**Usuários** → convidar cada parceiro (perfil comercial). Depois **Distribuição** → filtro → prévia → atribuir.

## 14. Virada

- Agenda: **Configurações** → conectar o Google Calendar (a redirect URI de produção
  `https://parr.primetax.com.br/api/google-calendar/callback` precisa estar cadastrada no Google Cloud Console).
- Trocar os links públicos (anúncios, bio, WhatsApp, QR) para `https://parr.primetax.com.br`.
- Smoke: landing abre, formulário cria lead de teste (excluir depois), login admin, login de um parceiro.

## 15. Fechamento

- Na Manus: conferir se entrou algum lead **depois do horário do export** (passo 1) e cadastrar à mão no PARR.
- Apagar as cópias do export e do CSV de editais (dados pessoais). 🌐 SERVIDOR:
```
rm -f /srv/parr/parr-export.json /root/parr-export.json /srv/parr/editais-consolidado.csv
ls /srv/parr/parr-export.json /root/parr-export.json /srv/parr/editais-consolidado.csv 2>/dev/null | wc -l | grep -qx 0 && echo PASSOU || echo PARAR
```
🖥️ LOCAL:
```
Remove-Item C:\Users\marce\parr-export.json
if (Test-Path C:\Users\marce\parr-export.json) { "PARAR" } else { "PASSOU" }
```
