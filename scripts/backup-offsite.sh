#!/usr/bin/env bash
# Copia off-VPS do backup diario do MySQL do PARR para o Backblaze B2, CRIPTOGRAFADA na VPS (rclone crypt).
# Rodar como root, via systemd (parr-backup-offsite@.timer, 1 h depois do backup local):
#   systemctl start parr-backup-offsite@prod.service      (instancia = staging | prod)
# ou manualmente:
#   bash /srv/parr/prod/scripts/backup-offsite.sh prod
#
# - Configuracao SO em /etc/parr/rclone.conf (root:root 600): remotos "b2" (chave do bucket) e "parr-cripto"
#   (crypt sobre b2:<bucket>/parr). Este script nunca le, imprime ou exporta chaves e senhas.
# - O provedor recebe arquivos ilegiveis (nomes e conteudo criptografados). SEM A SENHA DE CRIPTOGRAFIA (guardada
#   pelo Marcelo no gerenciador de senhas) os backups da nuvem nao podem ser abertos por ninguem.
# - Retencao na nuvem: diario por 30 dias; no dia 1 de cada mes uma copia "mensal" guardada por ~12 meses.
# Decisao 05/10/2026 (Marcelo): destino Backblaze B2; alerta de falha por e-mail (OnFailure -> parr-alerta@).

ENV_NAME="${1:-}"
CONF=/etc/parr/rclone.conf
REMOTO=parr-cripto
BASE_DIR=/var/backups/parr
MAX_IDADE_MIN=1560   # dump local precisa ter menos de 26 h
DIAS_DIARIO=30
DIAS_MENSAL=370

set -u
set -o pipefail

passou() { echo "PASSOU: $*"; }
parar()  { echo "PARAR: $*"; exit 1; }

main() {
  case "$ENV_NAME" in
    staging) DB=parr_staging ;;
    prod)    DB=parr_prod ;;
    *) parar "uso: backup-offsite.sh <staging|prod>" ;;
  esac
  local rc=(rclone --config "$CONF" --log-level ERROR)
  echo "=== backup off-VPS ${DB} — $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="

  # 1. root
  if [ "$(id -u)" -ne 0 ]; then parar "gate 1: execute como root"; fi
  passou "gate 1: root"

  # 2. rclone instalado
  if ! command -v rclone >/dev/null; then parar "gate 2: rclone nao instalado"; fi
  passou "gate 2: rclone $(rclone version 2>/dev/null | head -1 | awk '{print $2}')"

  # 3. configuracao presente e protegida (nunca e impressa)
  if [ ! -f "$CONF" ]; then parar "gate 3: ${CONF} nao existe"; fi
  if [ "$(stat -c '%a %U:%G' "$CONF")" != "600 root:root" ]; then parar "gate 3: ${CONF} deve ser root:root 600"; fi
  if ! "${rc[@]}" listremotes | grep -qx "${REMOTO}:"; then parar "gate 3: remoto ${REMOTO} ausente em ${CONF}"; fi
  passou "gate 3: ${CONF} root:root 600 com o remoto ${REMOTO}"

  # 4. dump local do dia (feito pelo parr-backup@)
  local f
  f="$(find "${BASE_DIR}/${DB}" -maxdepth 1 -type f -name "${DB}-*.sql.gz" -mmin "-${MAX_IDADE_MIN}" 2>/dev/null | sort | tail -1)"
  if [ -z "$f" ]; then parar "gate 4: nenhum dump de ${DB} com menos de 26 h em ${BASE_DIR}/${DB}"; fi
  passou "gate 4: dump local $(basename "$f") ($(stat -c '%s' "$f") bytes)"

  # 5. copia diaria (criptografada) e conferencia de que o arquivo chegou
  local nome
  nome="$(basename "$f")"
  if ! "${rc[@]}" copy "$f" "${REMOTO}:${DB}/diario/"; then parar "gate 5: envio para a nuvem falhou"; fi
  if ! "${rc[@]}" lsf "${REMOTO}:${DB}/diario/" | grep -qx "$nome"; then parar "gate 5: ${nome} nao aparece na nuvem depois do envio"; fi
  passou "gate 5: ${nome} na nuvem (diario)"

  # 6. no dia 1 (UTC), copia mensal
  if [ "$(date -u +%d)" = "01" ]; then
    if ! "${rc[@]}" copy "$f" "${REMOTO}:${DB}/mensal/"; then parar "gate 6: copia mensal falhou"; fi
    passou "gate 6: copia mensal enviada"
  else
    passou "gate 6: copia mensal so no dia 1"
  fi

  # 7. retencao na nuvem
  "${rc[@]}" delete "${REMOTO}:${DB}/diario/" --min-age "${DIAS_DIARIO}d" || parar "gate 7: retencao diaria falhou"
  "${rc[@]}" delete "${REMOTO}:${DB}/mensal/" --min-age "${DIAS_MENSAL}d" 2>/dev/null || true
  local nd nm
  nd="$("${rc[@]}" lsf "${REMOTO}:${DB}/diario/" | wc -l)"
  nm="$("${rc[@]}" lsf "${REMOTO}:${DB}/mensal/" 2>/dev/null | wc -l)"
  passou "gate 7: retencao — na nuvem ${nd} diario(s) e ${nm} mensal(is)"

  echo "=== backup off-VPS concluido ==="
}

main "$@"; exit $?
