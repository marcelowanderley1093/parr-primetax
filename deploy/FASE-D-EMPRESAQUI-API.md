# Fase D: API EmpresAqui (staging e produção)

Sem migração. Liga o botão "Atualizar pela EmpresAqui" e Configurações > Integrações. O token vai **só** na variável
de ambiente `EMPRESAQUI_API_TOKEN` de cada ambiente (`/etc/parr/staging.env` e `/etc/parr/prod.env`), gravado sem
aparecer na tela e sem ir para o histórico. Nunca no banco, no Git ou em mensagem.

Os dois ambientes usam o mesmo token, então o saldo da EmpresAqui é compartilhado. O teto mensal de cada ambiente
é contado separadamente: deixe o staging com um teto baixo (ex.: 20) em Configurações > Integrações.

🌐 SERVIDOR = `ssh parr-vps` (`root@parr-primetax`). Cada bloco termina com `PASSOU` ou `PARAR`.

## 1. 🌐 Gravar o token nos dois ambientes

O `read -s` não mostra o que é colado e não grava no histórico.
```
read -rs -p "Cole o token da EmpresAqui e tecle Enter: " TK; echo
for e in staging prod; do sed -i '/^EMPRESAQUI_API_TOKEN=/d' /etc/parr/$e.env; printf 'EMPRESAQUI_API_TOKEN=%s\n' "$TK" >> /etc/parr/$e.env; done; unset TK
for e in staging prod; do V=$(awk -F= '/^EMPRESAQUI_API_TOKEN=/{print ($2==""?"VAZIA":"PREENCHIDA")}' /etc/parr/$e.env); P=$(stat -c '%a %U:%G' /etc/parr/$e.env); echo "$e: token=$V perm=$P"; done
S=$(awk -F= '/^EMPRESAQUI_API_TOKEN=/{print ($2==""?"VAZIA":"PREENCHIDA")}' /etc/parr/staging.env); R=$(awk -F= '/^EMPRESAQUI_API_TOKEN=/{print ($2==""?"VAZIA":"PREENCHIDA")}' /etc/parr/prod.env); PS=$(stat -c '%a %U:%G' /etc/parr/staging.env); PP=$(stat -c '%a %U:%G' /etc/parr/prod.env); if [ "$S" = "PREENCHIDA" ] && [ "$R" = "PREENCHIDA" ] && [ "$PS" = "640 root:parr" ] && [ "$PP" = "640 root:parr" ]; then echo PASSOU; else echo PARAR; fi
```

## 2. 🌐 Deploy do staging (o restart carrega o token)

```
bash /srv/parr/staging/scripts/deploy-staging.sh 2>&1 | tee /root/deploy-staging.log | tail -3
G=$(grep -c '^PASSOU: gate' /root/deploy-staging.log); echo "gates=$G/10"; if [ "$G" = "10" ]; then echo PASSOU; else echo PARAR; fi
```

## 3. Tela do staging

- Configurações → Integrações: "Token configurado no servidor"; ajustar o **teto do staging para 20**.
- Abrir um lead com dívidas → card "Dados da empresa" → **Atualizar pela EmpresAqui**: dados atualizados, dívidas
  com receita e situação, gráfico trimestral. Clicar de novo: "Já consultado…" (cache, sem gastar consulta).
- Parceiro de teste: o botão funciona nos leads dele; "Forçar nova consulta" só aparece para admin.

## 4. 🌐 Deploy da produção

```
bash /srv/parr/prod/scripts/deploy-prod.sh 2>&1 | tee /root/deploy-prod.log | tail -4
G=$(grep -c '^PASSOU: gate' /root/deploy-prod.log); H=$(curl -s -o /dev/null -w '%{http_code}' https://parr.primetax.com.br/); echo "gates=$G/10 https=$H"; if [ "$G" = "10" ] && [ "$H" = "200" ]; then echo PASSOU; else echo PARAR; fi
```
Depois: Configurações → Integrações na produção — conferir o token configurado e o teto (padrão 500).
