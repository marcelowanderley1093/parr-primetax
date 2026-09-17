# PARR Primetax — contexto para o Claude Code

Landing page de captação de leads sobre o PARR + painel interno (Kanban de leads, notas, histórico,
importação Excel, Google Calendar, Pipedrive). Criado na Manus; em migração para VPS dedicada.

- Produção atual (legado): https://primetaxleads-ce79cane.manus.space/
- Destino: https://parr.primetax.com.br (VPS dedicada, a provisionar; DNS na Hostinger)
- Repositório: github.com/marcelowanderley1093/parr-primetax (privado)

## Stack
React 19 + Vite 7 + Tailwind 4 (client/) · Express 4 + tRPC 11 (server/) · MySQL + Drizzle (drizzle/)
· pnpm 10.4.1 · vitest. Build: `pnpm build` → `dist/index.js` + estáticos. Start: `pnpm start`.

## Baseline medido na main após o lote de fechamento (16/09/2026)
- tsc 0, 68 passed / 0 failed, build ok, `pnpm install --frozen-lockfile` sem WARN.
- `pnpm test`: 10 arquivos. Nenhum teste depende de `.env`.
- Baseline anterior (a9eff43, Gate 0): 34 passed / 2 failed (google-calendar.test.ts exigia
  GOOGLE_CALENDAR_CLIENT_ID/SECRET; reescrito como teste puro no Gate 1).

## Variáveis de ambiente (ver `.env.example`)
Obrigatórias: `DATABASE_URL`, `JWT_SECRET` (mínimo 32 caracteres), `PUBLIC_BASE_URL` (origem pública, sem
barra final; monta a redirect URI do Google Calendar). Em `NODE_ENV=production` o boot encerra com exit 1
se `DATABASE_URL` ou `JWT_SECRET` faltarem/forem inválidos (`server/_core/bootChecks.ts`); fora de produção
só avisa. E-mail: `SMTP_HOST/PORT/USER/PASS/FROM`, `NOTIFY_EMAIL_TO` (lista separada por vírgula).
Opcionais: `GOOGLE_CALENDAR_CLIENT_ID/SECRET`, `PIPEDRIVE_API_TOKEN/DOMAIN`, `HOST` (default 127.0.0.1),
`PORT` (default 3000; porta ocupada encerra o processo, não troca de porta — `server/_core/listenConfig.ts`).
Bootstrap do admin: `ADMIN_EMAIL` + `ADMIN_NOME` só na sessão do shell que roda
`pnpm tsx scripts/criar-admin.ts` (gera senha temporária aleatória e imprime uma vez; idempotente).

## Autenticação (pós Gate 1)
Única porta: `/login` (e-mail/senha em `local_users`, bcrypt). Login faz upsert em `users`
(`openId = local-<id>`, `role` copiado de `local_users`) e emite JWT HS256 (`JWT_SECRET`, `appId`
fixo `SESSION_APP_ID`, cookie `app_session_id`, sameSite lax, 1 ano). `authenticateRequest` derruba a
sessão se `local_users.active = 0`. Rate limit em memória: 5 tentativas / 15 min por IP+e-mail em
`localAuth.login` e `changePassword` (`app.set("trust proxy", 1)`). E-mail comparado com LOWER(TRIM()).

## Tabelas
users (sessão; openId) · local_users (login e-mail/senha, bcrypt) · leads · lead_notes ·
lead_status_history · lead_imports · site_settings (inclui googleCalendarRefreshToken/Email e URL do vídeo)

## Acoplamentos com a Manus (Gate 1 — removidos no código; itens 1–6 feitos, 7 pendente)
1. ~~Login OAuth da Manus~~ → removido (`oauth.ts`, `manusTypes.ts`, `getLoginUrl`, `ManusDialog`,
   `OWNER_OPEN_ID`). Admin vem de `local_users.role`; o admin precisa existir em `local_users` ANTES do
   corte (rodar `scripts/criar-admin.ts` contra o banco de produção no Gate 2/3).
2. ~~`notifyOwner` via Forge~~ → e-mail SMTP com nodemailer; falha só loga (sem dados do lead).
   `system.testarEmail` (admin) envia e-mail de teste para validar o SMTP no staging.
3. ~~Assets no CloudFront~~ → `client/public/img/` (logo full/small, foto).
4. ~~Fallback `manus.space`~~ → `PUBLIC_BASE_URL`. No Gate 3, cadastrar
   `https://parr.primetax.com.br/api/google-calendar/callback` (e a URL de staging) no Google Cloud Console.
5. ~~Plugins do Vite, debug collector, `__manus__/`, script umami (VITE_ANALYTICS_*) em index.html~~ →
   removidos. Analytics fica sem substituto por decisão.
6. ~~Módulos _core órfãos (llm, map, imageGeneration, voiceTranscription, dataApi, storage), Map.tsx,
   AIChatBox.tsx, ComponentShowcase.tsx~~ → apagados; deps axios, @aws-sdk/*, streamdown, @types/google.maps,
   vite-plugin-manus-runtime, jsx-loc removidas.
7. Banco no TiDB da Manus → exportar e importar no MySQL da VPS (Gate 2).

## Gate 2 — patch pré-staging (feito, branch gate2-pre-staging)
1. Servidor escuta em `HOST` (default 127.0.0.1) — antes escutava em todas as interfaces.
2. Porta ocupada (EADDRINUSE) encerra o processo — antes procurava outra porta silenciosamente.
3. Callback do Google Calendar não loga mais o JSON com access/refresh token (só status + booleano).
4. Boot em produção falha sem `DATABASE_URL` ou `JWT_SECRET` (≥ 32 chars); nomes no log, nunca valores.

## Backlog (observado nos Gates 1 e 2, fora de escopo — decidir depois)
- **Prioritário antes do cutover**: `settings.getAdmin` devolve todas as `site_settings` em claro, inclusive
  `googleCalendarRefreshToken`, a qualquer usuário logado (`protectedProcedure`). Filtrar chaves sensíveis
  ou restringir a admin.
- `setupVite` é importado estaticamente em `server/_core/vite.ts` → `dist/index.js` importa `vite`,
  `@vitejs/plugin-react` e `@tailwindcss/vite` (devDependencies). Trocar por `import()` dinâmico só em
  development para permitir `pnpm install --prod` na VPS. Até lá, instalar com devDependencies.
- Callback `/api/google-calendar/callback` é público e sem parâmetro `state`/CSRF.
- Token do Pipedrive vai na query string (`?api_token=`) em `leads.create` → aparece em logs de proxy.
  Mover para header `x-api-token`.
- `settings.update` é `protectedProcedure`: qualquer usuário logado altera settings, inclusive apaga o
  refresh token do Calendar. Candidato a `adminProcedure`.
- `localUsers.resetPassword` (admin) zera `mustChangePassword`; o usuário não é forçado a trocar a senha
  definida pelo admin. Candidato a manter `mustChangePassword=1` nesse caso.
- Não existe procedure para alterar `role` de um `local_user` depois de criado (só create/delete).
- Sessão JWT de 1 ano sem revogação server-side além do `active=0`; logout só apaga o cookie.
- `pnpm dev` usa `NODE_ENV=development tsx …` (sintaxe POSIX): no PowerShell falha; usar Git Bash.

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
- Gate 1 — CONCLUÍDO. Desacoplamento da Manus no código (despacho DESPACHO-PARR-01). Merge d32bcce
  na main; lote de fechamento (patch wouter, bloco pnpm, devDeps pnpm/add) na branch gate1-fechamento.
- Gate 2 — provisionar VPS, exportar/importar banco com contagem por tabela, staging com Pipedrive
  e Calendar isolados.
- Gate 3 — cutover: DNS parr.primetax.com.br, nova redirect URI no Google Cloud Console, smoke no
  iPhone, aposentar o manus.space.
