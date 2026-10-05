# Backup off-VPS (Backblaze B2, criptografado) + alerta de falha por e-mail

Decisão 05/10/2026 (Marcelo): cópia diária do backup da produção para o **Backblaze B2**, criptografada na VPS com
`rclone crypt`; alerta por e-mail quando o backup ou a cópia falharem.

- O B2 recebe arquivos **ilegíveis** (nome e conteúdo criptografados).
- **Sem a senha de criptografia e o sal, ninguém abre os backups da nuvem, nem nós.** Os dois ficam no gerenciador de
  senhas do Marcelo **antes** de qualquer outro passo.
- Retenção na nuvem: diário por 30 dias; uma cópia mensal (dia 1) por ~12 meses.
- Nenhum comando mostra chave ou senha: as linhas com `read -s` não exibem o que é colado e não vão para o histórico.
  **Cada linha `read` vai sozinha**: cole a linha, cole a resposta, Enter; só então a próxima.

🌐 SERVIDOR = `ssh parr-vps` (`root@parr-primetax`). Cada bloco termina com `PASSOU` ou `PARAR`.

## 1. Gerenciador de senhas (antes de tudo)

Criar e guardar duas senhas longas e aleatórias (32+ caracteres, só letras e números):
- **PARR backup — senha de criptografia**
- **PARR backup — sal de criptografia**

## 2. Backblaze B2 (navegador)

1. Criar a conta em backblaze.com (B2 Cloud Storage).
2. **Buckets → Create a Bucket**: nome único (ex.: `primetax-parr-backup-<4 letras aleatórias>`), **Private**.
3. No bucket, **Lifecycle Settings → "Keep only the last version of the file"** (o que o rclone apaga some de verdade).
4. **Application Keys → Add a New Application Key**: acesso **só a esse bucket**, **Read and Write**.
   Guardar no gerenciador de senhas o **keyID** e a **applicationKey** (esta aparece uma única vez).

## 3. 🌐 Instalar o rclone e criar a configuração

```
apt-get install -y rclone
install -o root -g root -m 600 /dev/null /etc/parr/rclone.conf
```
Uma linha por vez (cada uma pede um valor; nada aparece ao colar):
```
read -rs -p "keyID do B2: " K1; echo
```
```
read -rs -p "applicationKey do B2: " K2; echo
```
```
read -r -p "Nome do bucket: " BK
```
```
read -rs -p "Senha de criptografia: " P1; echo
```
```
read -rs -p "Sal de criptografia: " P2; echo
```
Gravar (a saída do rclone é descartada: ela repetiria os valores ofuscados):
```
rclone --config /etc/parr/rclone.conf config create b2 b2 account "$K1" key "$K2" hard_delete true >/dev/null && rclone --config /etc/parr/rclone.conf config create parr-cripto crypt remote "b2:$BK/parr" password "$P1" password2 "$P2" --obscure >/dev/null; unset K1 K2 P1 P2
R=$(rclone --config /etc/parr/rclone.conf listremotes | tr '\n' ' '); P=$(stat -c '%a %U:%G' /etc/parr/rclone.conf); echo "remotos=$R perm=$P"; if [ "$R" = "b2: parr-cripto: " ] && [ "$P" = "600 root:root" ]; then echo PASSOU; else echo PARAR; fi
```
Teste de ida e volta (grava, lê, confere que no B2 o nome ficou ilegível, apaga):
```
C='rclone --config /etc/parr/rclone.conf --log-level ERROR'; echo "teste-parr" | $C rcat parr-cripto:teste/ok.txt; L=$($C cat parr-cripto:teste/ok.txt); Z=$($C lsf -R "b2:$BK/parr" | grep -c 'ok.txt'); $C purge parr-cripto:teste; echo "leitura=$L nome_legivel_no_b2=$Z"; if [ "$L" = "teste-parr" ] && [ "$Z" = "0" ]; then echo PASSOU; else echo PARAR; fi
```

## 4. 🌐 E-mail do alerta (ALERTA_EMAIL no env da produção)

```
read -r -p "E-mail que recebe os alertas: " AE
sed -i '/^ALERTA_EMAIL=/d' /etc/parr/prod.env; printf 'ALERTA_EMAIL=%s\n' "$AE" >> /etc/parr/prod.env; unset AE
V=$(awk -F= '/^ALERTA_EMAIL=/{print ($2==""?"VAZIA":"PREENCHIDA")}' /etc/parr/prod.env); P=$(stat -c '%a %U:%G' /etc/parr/prod.env); echo "ALERTA_EMAIL=$V perm=$P"; if [ "$V" = "PREENCHIDA" ] && [ "$P" = "640 root:parr" ]; then echo PASSOU; else echo PARAR; fi
```

## 5. 🌐 Código e unidades do systemd

O código novo entra no clone da produção pelo deploy normal (sem migração):
```
bash /srv/parr/prod/scripts/deploy-prod.sh 2>&1 | tee /root/deploy-prod.log | tail -2
G=$(grep -c '^PASSOU: gate' /root/deploy-prod.log); echo "gates=$G/10"; if [ "$G" = "10" ]; then echo PASSOU; else echo PARAR; fi
```
Instalar as unidades (o backup local ganha o alerta de falha; a cópia off-VPS ganha timer próprio às 04:10 UTC):
```
cp /srv/parr/prod/deploy/parr-backup@.service /srv/parr/prod/deploy/parr-backup-offsite@.service /srv/parr/prod/deploy/parr-backup-offsite@.timer /srv/parr/prod/deploy/parr-alerta@.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now parr-backup-offsite@prod.timer
T=$(systemctl is-enabled parr-backup-offsite@prod.timer); O=$(systemctl show -p OnFailure --value parr-backup@prod.service); echo "timer=$T onfailure_backup=$O"; if [ "$T" = "enabled" ] && [ "$O" = "parr-alerta@parr-backup-prod.service" ]; then echo PASSOU; else echo PARAR; fi
```

## 6. 🌐 Testar o alerta (deve chegar um e-mail "[PARR] Falha: teste")

```
systemctl start parr-alerta@teste.service
R=$(systemctl show -p Result --value parr-alerta@teste.service); echo "result=$R"; if [ "$R" = "success" ]; then echo PASSOU; else echo PARAR; fi
```
Conferir a caixa de entrada (e o spam).

## 7. 🌐 Primeira cópia off-VPS (agora, sem esperar o timer)

```
systemctl start parr-backup-offsite@prod.service
ID=$(systemctl show -p InvocationID --value parr-backup-offsite@prod.service); journalctl _SYSTEMD_INVOCATION_ID="$ID" --no-pager | grep -E 'PASSOU|PARAR'
G=$(journalctl _SYSTEMD_INVOCATION_ID="$ID" --no-pager | grep -c 'PASSOU: gate'); R=$(systemctl show -p Result --value parr-backup-offsite@prod.service); echo "gates=$G/7 result=$R"; if [ "$G" = "7" ] && [ "$R" = "success" ]; then echo PASSOU; else echo PARAR; fi
```

## 8. 🌐 Teste de restauração a partir da nuvem (obrigatório na primeira vez; depois, mensal)

Baixa o dump mais recente da nuvem (descriptografa sozinho), confere a blindagem `USE/CREATE DATABASE`, restaura num
banco descartável, compara as contagens com a produção e apaga tudo.
```
export MYSQL_HISTFILE=/dev/null; C='rclone --config /etc/parr/rclone.conf --log-level ERROR'; mkdir -p -m 700 /root/restore-offsite
N=$($C lsf parr-cripto:parr_prod/diario/ | sort | tail -1); $C copy "parr-cripto:parr_prod/diario/$N" /root/restore-offsite/; F=/root/restore-offsite/$N
S=$(zcat "$F" | grep -cE '^(USE |CREATE DATABASE)' || true); G=$(gzip -t "$F" 2>&1 | wc -l); echo "arquivo=$N use_create=$S gzip_erros=$G"; if [ -n "$N" ] && [ "$S" = "0" ] && [ "$G" = "0" ]; then echo PASSOU; else echo "PARAR: NAO restaurar"; fi
```
Só depois do `PASSOU`:
```
mysql -e "DROP DATABASE IF EXISTS parr_restore_test; CREATE DATABASE parr_restore_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
zcat "$F" | mysql parr_restore_test
D=0; for t in leads lead_procedimentos editais empresas lead_contatos local_users; do a=$(mysql -N -e "SELECT COUNT(*) FROM parr_prod.$t"); b=$(mysql -N -e "SELECT COUNT(*) FROM parr_restore_test.$t"); printf '%-20s prod=%s nuvem=%s\n' "$t" "$a" "$b"; [ "$a" = "$b" ] || D=$((D+1)); done; mysql -e "DROP DATABASE parr_restore_test;"; rm -rf /root/restore-offsite; if [ "$D" -eq 0 ]; then echo PASSOU; else echo "PARAR: $D tabela(s) diferentes (normal so se houve movimento desde a meia-noite UTC)"; fi
```
