# PARR Primetax — contexto para o Claude Code

Landing page de captação de leads sobre o PARR + painel interno (Kanban de leads, notas, histórico,
importação Excel, Google Calendar, Pipedrive). Criado na Manus; em migração para VPS dedicada.

- Produção atual (legado): https://primetaxleads-ce79cane.manus.space/
- Destino: https://parr.primetax.com.br (VPS dedicada, a provisionar; DNS na Hostinger)
- Repositório: github.com/marcelowanderley1093/parr-primetax (privado)

## Stack
React 19 + Vite 7 + Tailwind 4 (client/) · Express 4 + tRPC 11 (server/) · MySQL + Drizzle (drizzle/)
· pnpm 10.4.1 · vitest. Build: `pnpm build` → `dist/index.js` + estáticos. Start: `pnpm start`.

## Baseline medido no commit a9eff43 (16/09/2026)
- `pnpm install --frozen-lockfile` ok · `pnpm check` (tsc) exit 0 · `pnpm build` ok
- `pnpm test`: 34 passed / 2 failed — as 2 falhas são `server/google-calendar.test.ts`, que exige
  GOOGLE_CALENDAR_CLIENT_ID/SECRET no ambiente (falha esperada sem .env, não é regressão)

## Tabelas
users (sessão; openId) · local_users (login e-mail/senha, bcrypt) · leads · lead_notes ·
lead_status_history · lead_imports · site_settings (inclui googleCalendarRefreshToken/Email e URL do vídeo)

## Acoplamentos com a Manus a remover (Gate 1)
1. Login OAuth da Manus: `server/_core/oauth.ts`, `sdk.getUserInfoWithJwt`, `client/src/const.ts`
   (VITE_OAUTH_PORTAL_URL/VITE_APP_ID), `useAuth`, `ManusDialog`. O role admin do dono vem de
   `OWNER_OPEN_ID` (db.ts:50) — sem OAuth, o admin precisa existir em `local_users` ANTES do corte.
   A sessão JWT (`sdk.createSessionToken`/`verifySession`, JWT_SECRET) é local e deve ser mantida.
2. `notifyOwner` (server/_core/notification.ts) usa a API Forge da Manus → substituir por e-mail SMTP.
3. Assets no CloudFront da Manus (d2xsxph8kpxj0f.cloudfront.net): logos em Home.tsx, DashboardLayout.tsx,
   LocalLogin.tsx e foto em Home.tsx:378 → baixar para client/public.
4. Domínio `manus.space` como fallback em index.ts:51 e routers.ts:546 (redirect do Google Calendar).
5. Plugins do Vite (`vite-plugin-manus-runtime`, debug collector, jsx-loc), `client/public/__manus__/`.
6. Módulos _core sem uso real: llm, map, imageGeneration, voiceTranscription, dataApi, storage
   (confirmar por grep de import antes de apagar).
7. Banco no TiDB da Manus → exportar e importar no MySQL da VPS (Gate 2).

## Regras de trabalho (absolutas)
- Fase 0 read-only antes de qualquer alteração: ver antes de aplicar.
- O banco é a fonte da verdade — não relatórios, logs ou specs.
- SSH e deploy são do Marcelo, nunca do Claude Code. A VPS só puxa do GitHub; push sai daqui.
- Comandos entregues completos, sem placeholders.
- Staging obrigatório; nenhum patch de smoke fica aplicado na VPS.
- Segredos só em variáveis de ambiente (.env fora do git), nunca em chat nem em log.
- Todo gate imprime PASSOU ou PARAR; nunca depender de exit code encadeado por `&&`.
- Amostra apresentada como prova é colada verbatim da execução, não reconstruída.
- Uma sessão de Claude Code por clone por vez. `git status` limpo antes de encerrar.

## Roteiro
- Gate 0 — repositório saneado no GitHub + este arquivo. (feito)
- Gate 1 — desacoplamento da Manus no código (despacho DESPACHO-PARR-01), testado localmente.
- Gate 2 — provisionar VPS, exportar/importar banco com contagem por tabela, staging com Pipedrive
  e Calendar isolados.
- Gate 3 — cutover: DNS parr.primetax.com.br, nova redirect URI no Google Cloud Console, smoke no
  iPhone, aposentar o manus.space.
