#!/usr/bin/env bash
# Deploy do PARR (PRODUCAO) na VPS. Rodar como root:
#   bash /srv/parr/prod/scripts/deploy-prod.sh 2>&1 | tee /root/deploy-prod.log
#
# Diferenca para o staging: o build vai para dist-next/ e so depois de completo e conferido
# e trocado por dist/ (mv). Falha no build deixa dist/ intacto e o servico no ar.
# - Todo o corpo esta em main(): o proprio script e atualizado pelo git pull durante a execucao.
#   A ultima linha chama main e sai na mesma linha.
# - Nunca le, imprime ou faz source de /etc/parr/*.env.
# - Nunca roda migracao: diff que toque drizzle/ encerra com PARAR (ver deploy/PRODUCAO.md).

APP_DIR=/srv/parr/prod
APP_USER=parr
SERVICE=parr-prod
PORT=3102
BRANCH=main

MIGRATIONS_DIR=drizzle
EXPECTED_HTML_TAG='<html lang="pt-BR" translate="no">'
HEALTH_URL="http://127.0.0.1:${PORT}/"
DIST="${APP_DIR}/dist"
DIST_NEXT="${APP_DIR}/dist-next"
DIST_PREV="${APP_DIR}/dist-prev"

set -u
set -o pipefail

passou() { echo "PASSOU: $*"; }
parar()  { echo "PARAR: $*"; exit 1; }

# Executa um comando como APP_USER dentro de APP_DIR (login shell: PATH do pnpm/node).
as_app() {
  sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && $*"
}

main() {
  echo "=== deploy ${SERVICE} (${BRANCH}) em ${APP_DIR} — $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="

  # 1. root
  if [ "$(id -u)" -ne 0 ]; then parar "gate 1: execute como root"; fi
  passou "gate 1: root"

  # 2. working tree limpa e branch correta (dist-next/ e dist-prev/ estao no .gitignore)
  local status branch
  status="$(as_app 'git status --porcelain')" || parar "gate 2: git status falhou"
  if [ -n "$status" ]; then
    echo "$status"
    parar "gate 2: working tree nao esta limpa em ${APP_DIR}"
  fi
  branch="$(as_app 'git rev-parse --abbrev-ref HEAD')" || parar "gate 2: git rev-parse falhou"
  if [ "$branch" != "$BRANCH" ]; then parar "gate 2: branch atual e '${branch}', esperado '${BRANCH}'"; fi
  passou "gate 2: working tree limpa, branch ${BRANCH}"

  # 3. fetch; PREV e origin/BRANCH
  as_app 'git fetch --prune origin' || parar "gate 3: git fetch falhou"
  local prev remote
  prev="$(as_app 'git rev-parse HEAD')" || parar "gate 3: rev-parse HEAD falhou"
  remote="$(as_app "git rev-parse origin/${BRANCH}")" || parar "gate 3: rev-parse origin/${BRANCH} falhou"
  echo "HEAD atual (PREV): ${prev}"
  echo "origin/${BRANCH}: ${remote}"
  if [ "$prev" = "$remote" ]; then
    echo "sem commit novo — seguindo como redeploy do mesmo commit"
  fi
  passou "gate 3: fetch"

  # 4. migracao nova no intervalo? NUNCA migrar automaticamente.
  local migration_files
  migration_files="$(as_app "git diff --name-only '${prev}..${remote}' -- '${MIGRATIONS_DIR}/'")" \
    || parar "gate 4: git diff falhou"
  if [ -n "$migration_files" ]; then
    echo "$migration_files"
    parar "gate 4: migração nova — rodar manualmente com planejamento (deploy/PRODUCAO.md, secao Migracao)"
  fi
  passou "gate 4: sem alteracao em ${MIGRATIONS_DIR}/"

  # 5. pull ff-only
  as_app 'git pull --ff-only' || parar "gate 5: git pull --ff-only falhou"
  passou "gate 5: git pull --ff-only"

  # 6. install
  as_app 'pnpm install --frozen-lockfile' || parar "gate 6: pnpm install --frozen-lockfile falhou"
  passou "gate 6: pnpm install --frozen-lockfile"

  # 7. build em dist-next/ (limpo no inicio), sem tocar dist/
  as_app "rm -rf '${DIST_NEXT}'" || parar "gate 7: rm -rf dist-next falhou"
  if [ -e "$DIST_NEXT" ]; then parar "gate 7: dist-next ainda existe apos rm -rf"; fi
  as_app "pnpm exec vite build --outDir '${DIST_NEXT}/public' --emptyOutDir" \
    || parar "gate 7: vite build falhou (dist/ intacto, servico no ar)"
  as_app "pnpm exec esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir='${DIST_NEXT}'" \
    || parar "gate 7: esbuild falhou (dist/ intacto, servico no ar)"
  if [ ! -s "${DIST_NEXT}/index.js" ]; then parar "gate 7: ${DIST_NEXT}/index.js ausente ou vazio"; fi
  if [ ! -s "${DIST_NEXT}/public/index.html" ]; then parar "gate 7: ${DIST_NEXT}/public/index.html ausente ou vazio"; fi
  if ! grep -q -F "$EXPECTED_HTML_TAG" "${DIST_NEXT}/public/index.html"; then
    parar "gate 7: ${DIST_NEXT}/public/index.html sem ${EXPECTED_HTML_TAG}"
  fi
  passou "gate 7: build completo em dist-next/ (index.js + public/index.html conferidos)"

  # 8. troca dist-next -> dist (dist anterior vira dist-prev para rollback rapido) + restart
  as_app "rm -rf '${DIST_PREV}'" || parar "gate 8: rm -rf dist-prev falhou"
  if [ -d "$DIST" ]; then
    as_app "mv '${DIST}' '${DIST_PREV}'" || parar "gate 8: mv dist -> dist-prev falhou"
  fi
  as_app "mv '${DIST_NEXT}' '${DIST}'" || parar "gate 8: mv dist-next -> dist falhou (dist-prev preservado)"
  systemctl restart "$SERVICE" || parar "gate 8: systemctl restart ${SERVICE} falhou"
  sleep 3
  local state
  state="$(systemctl is-active "$SERVICE" || true)"
  if [ "$state" != "active" ]; then
    systemctl --no-pager --lines=20 status "$SERVICE" || true
    parar "gate 8: ${SERVICE} esta '${state}', esperado 'active' (rollback: ver fim deste log)"
  fi
  passou "gate 8: dist trocado, ${SERVICE} active"

  # 9. HTTP 200 local (ate 10 tentativas)
  local code="" attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
    if [ "$code" = "200" ]; then break; fi
    sleep 2
  done
  if [ "$code" != "200" ]; then parar "gate 9: GET ${HEALTH_URL} retornou '${code}', esperado 200"; fi
  passou "gate 9: GET ${HEALTH_URL} -> 200"

  # 10. <html> servido
  local html_tag
  html_tag="$(curl -s --max-time 5 "$HEALTH_URL" | grep -o -m1 '<html[^>]*>' || true)"
  if [ "$html_tag" != "$EXPECTED_HTML_TAG" ]; then
    parar "gate 10: tag servida '${html_tag}', esperado '${EXPECTED_HTML_TAG}'"
  fi
  passou "gate 10: ${EXPECTED_HTML_TAG}"

  # Resumo
  local new
  new="$(as_app 'git rev-parse HEAD')"
  echo "=== deploy concluido ==="
  echo "PREV: ${prev}"
  echo "HEAD: ${new}"
  echo "rollback rapido (build anterior, nao executado):"
  echo "  sudo -u ${APP_USER} bash -lc \"cd '${APP_DIR}' && rm -rf dist-next && mv dist dist-next && mv dist-prev dist\" && systemctl restart ${SERVICE}"
  echo "rollback completo (codigo + build, nao executado):"
  echo "  sudo -u ${APP_USER} bash -lc \"cd '${APP_DIR}' && git reset --hard ${prev} && pnpm install --frozen-lockfile && pnpm build\" && systemctl restart ${SERVICE}"
}

main "$@"; exit $?
