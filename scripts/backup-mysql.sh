#!/usr/bin/env bash
# Backup diario do MySQL do PARR (mysqldump + gzip + rotacao). Rodar como root, via systemd:
#   systemctl start parr-backup@prod.service      (instancia = staging | prod)
# ou manualmente:
#   bash /srv/parr/prod/scripts/backup-mysql.sh prod
#
# Credenciais SOMENTE no arquivo de opcoes /etc/parr/backup-<env>.cnf (root:root 600):
#   [client]
#   host=127.0.0.1
#   user=parr_backup
#   password=...
# Este script nunca le, imprime ou exporta a senha; so passa --defaults-extra-file ao mysqldump.
#
# Saida: /var/backups/parr/<DB>/<DB>-AAAAMMDD-HHMMSS.sql.gz (dir 700 root:root, arquivos 600).
# Retencao: KEEP_DAYS dias. Copia off-VPS: backlog (obrigatoria antes de aposentar a Manus).

ENV_NAME="${1:-}"
KEEP_DAYS=14
BASE_DIR=/var/backups/parr

set -u
set -o pipefail

passou() { echo "PASSOU: $*"; }
parar()  { echo "PARAR: $*"; exit 1; }

main() {
  case "$ENV_NAME" in
    staging) DB=parr_staging ;;
    prod)    DB=parr_prod ;;
    *) parar "uso: backup-mysql.sh <staging|prod>" ;;
  esac
  local cnf="/etc/parr/backup-${ENV_NAME}.cnf"
  local dest="${BASE_DIR}/${DB}"
  local stamp out
  stamp="$(date -u '+%Y%m%d-%H%M%S')"
  out="${dest}/${DB}-${stamp}.sql.gz"

  echo "=== backup ${DB} — ${stamp}Z ==="

  # 1. root
  if [ "$(id -u)" -ne 0 ]; then parar "gate 1: execute como root"; fi
  passou "gate 1: root"

  # 2. arquivo de opcoes presente e protegido (nunca e lido por este script)
  if [ ! -f "$cnf" ]; then parar "gate 2: ${cnf} nao existe"; fi
  local cnf_mode cnf_owner
  cnf_mode="$(stat -c '%a' "$cnf")"
  cnf_owner="$(stat -c '%U:%G' "$cnf")"
  if [ "$cnf_mode" != "600" ] || [ "$cnf_owner" != "root:root" ]; then
    parar "gate 2: ${cnf} deve ser root:root 600 (atual ${cnf_owner} ${cnf_mode})"
  fi
  passou "gate 2: ${cnf} root:root 600"

  # 3. diretorio de destino 700 root:root
  mkdir -p "$dest" || parar "gate 3: mkdir ${dest} falhou"
  chown root:root "$BASE_DIR" "$dest" || parar "gate 3: chown falhou"
  chmod 700 "$BASE_DIR" "$dest" || parar "gate 3: chmod falhou"
  local d
  for d in "$BASE_DIR" "$dest"; do
    if [ "$(stat -c '%a %U:%G' "$d")" != "700 root:root" ]; then parar "gate 3: ${d} nao esta 700 root:root"; fi
  done
  passou "gate 3: ${dest} 700 root:root"

  # 4. dump (umask 077 -> arquivo nasce 600)
  # ATENCAO: nome do banco POSICIONAL, nunca --databases/-B/--all-databases. Com aquelas flags o
  # dump traria CREATE DATABASE/USE e um restore de teste gravaria por cima do banco vivo.
  umask 077
  if ! mysqldump --defaults-extra-file="$cnf" \
      --single-transaction --quick --routines --triggers --events \
      --no-tablespaces --set-gtid-purged=OFF \
      "$DB" | gzip -9 > "$out"; then
    rm -f "$out"
    parar "gate 4: mysqldump/gzip falhou"
  fi
  passou "gate 4: dump gravado em ${out}"

  # 5. integridade: tamanho > 0, gzip integro, dump termina com a marca do mysqldump
  local size
  size="$(stat -c '%s' "$out")"
  if [ "$size" -le 0 ]; then parar "gate 5: arquivo vazio"; fi
  if ! gzip -t "$out"; then parar "gate 5: gzip corrompido"; fi
  if ! zcat "$out" | tail -n 5 | grep -q "Dump completed"; then parar "gate 5: dump sem 'Dump completed' (incompleto)"; fi
  passou "gate 5: ${size} bytes, gzip integro, dump completo"

  # 6. o dump NAO pode conter USE/CREATE DATABASE: o restore sempre vai para o banco escolhido no comando
  local dbstmts
  dbstmts="$(zcat "$out" | grep -cE '^(USE |CREATE DATABASE)' || true)"
  if [ "$dbstmts" != "0" ]; then
    rm -f "$out"
    parar "gate 6: dump com ${dbstmts} linha(s) USE/CREATE DATABASE (mysqldump com --databases?); arquivo removido"
  fi
  passou "gate 6: dump sem USE/CREATE DATABASE"

  # 7. permissoes do arquivo
  chmod 600 "$out" || parar "gate 7: chmod 600 falhou"
  if [ "$(stat -c '%a %U:%G' "$out")" != "600 root:root" ]; then parar "gate 7: ${out} nao esta 600 root:root"; fi
  passou "gate 7: ${out} 600 root:root"

  # 8. rotacao
  local removed
  removed="$(find "$dest" -maxdepth 1 -type f -name "${DB}-*.sql.gz" -mtime "+${KEEP_DAYS}" -print -delete | wc -l)"
  local remaining
  remaining="$(find "$dest" -maxdepth 1 -type f -name "${DB}-*.sql.gz" | wc -l)"
  passou "gate 8: rotacao ${KEEP_DAYS} dias — removidos ${removed}, restantes ${remaining}"

  echo "=== backup concluido: ${out} ==="
}

main "$@"; exit $?
