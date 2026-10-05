# PARR Primetax — contexto para o Claude Code

Landing page de captação de leads sobre o PARR (`/`) + painel interno de leads (`/dashboard`: Kanban,
notas, histórico, importação Excel, Google Calendar, Pipedrive). Uma única SPA; usuários internos
(`local_users`, perfis `comercial`/`admin`) entram por convite de e-mail em `/ativar-conta` e logam em `/login`.

Stack: React 19 + Vite 7 + Tailwind 4 (`client/`) · Express 4 + tRPC 11 (`server/`) · MySQL 8 + Drizzle
(`drizzle/`) · pnpm 10.4.1 · vitest · nodemailer (SMTP). Build → `dist/index.js` + `dist/public/`.
Repositório: github.com/marcelowanderley1093/parr-primetax (privado).

## Ambientes
- **Local (clone oficial)**: `C:\Users\marce\parr-primetax`, Windows, Git Bash. Sem MySQL local: nada que
  toque banco roda aqui.
- **Staging**: https://staging.parr.primetax.com.br — VPS, `/srv/parr/staging`, usuário `parr`, serviço
  systemd `parr-staging`, app em `127.0.0.1:3101` atrás do nginx com Basic Auth. Env em `/etc/parr/*.env`
  (nunca lido nem impresso). Banco `parr_staging` com cópia de produção (credenciais e tokens zerados).
- **`main` é a única fonte de deploy.** Nenhuma outra branch vai para a VPS.
- **Produção**: https://parr.primetax.com.br — mesma VPS, `/srv/parr/prod`, serviço `parr-prod`,
  `127.0.0.1:3102`, nginx **sem** Basic Auth (landing pública), banco `parr_prod`, env em
  `/etc/parr/prod.env` (segredos novos, nunca os do staging). Montagem e operação: `deploy/PRODUCAO.md`.
  **Virada feita em 05/10/2026** (export final da Manus + base de editais; roteiro em `deploy/VIRADA-PRODUCAO.md`).
  Links públicos (anúncios, bio, WhatsApp, QR) trocados para parr.primetax.com.br pelo Marcelo.
- **Backup**: `scripts/backup-mysql.sh` via `parr-backup@{staging,prod}.timer` (03:10 UTC, 14 dias,
  `/var/backups/parr/`, credenciais só em `/etc/parr/backup-<env>.cnf`). Restore e teste: `deploy/RESTORE.md`.
  Cópia off-VPS: backlog, **obrigatória antes de aposentar a Manus**.

## Regras absolutas
1. **Fase 0 read-only**: antes de qualquer alteração, levantar o estado, propor o diff e **parar para
   aprovação do Marcelo**. Nenhum arquivo escrito, nenhum pacote instalado até o "aprovado".
2. **Uma branch por tarefa a partir de `main`** (`fix/…`, `feat/…`, `chore/…`). Commits pequenos e nomeados.
3. **Gates imprimem literalmente `PASSOU` ou `PARAR`**, um comando por linha, sem `&&` encadeado; ao
   `PARAR`, interromper e reportar, nunca contornar.
4. **Merge em `main` e `git push` so depois do "pode mandar" do Marcelo**, com os gates (`PASSOU`) e a lista de
   commits mostrados antes; o Claude executa (autorizado em 02/10/2026). SSH, deploy, banco e VPS continuam
   exclusivamente do Marcelo.
5. **Segredos nunca são lidos, impressos ou commitados** (`.env`, `/etc/parr/*.env`, dumps, exports
   com dados pessoais). Só nomes de variáveis. Logs do app não carregam valores de token/hash/senha.
6. **Prova colada verbatim**: saída real dos comandos, nunca reconstruída. `git status` limpo ao encerrar.
7. O banco é a fonte da verdade — não relatórios, logs ou specs.

## Linha divisória
- **Pode ir direto** (com as regras acima): telas, textos, layout, componentes, campos e colunas do
  Kanban que **não** exijam migração, testes, scripts utilitários sem efeito externo.
- **Exige planejamento e aprovação explícita antes de escrever**: autenticação, sessão/cookie/JWT,
  papéis e permissões, qualquer migração ou mudança de `drizzle/schema.ts`, e-mail (SMTP, templates),
  integrações (Google Calendar, Pipedrive), variáveis de ambiente, nginx/systemd/VPS, import/export de dados.

## Comandos
- Typecheck: `pnpm check` (= `tsc --noEmit`) · Testes: `pnpm test` (= `vitest run`; inclui
  `server/**/*.test.ts` e `client/src/**/*.test.ts`) · Build: `pnpm build`.
- Baseline atual: tsc 0 · **323 passed / 0 failed** (32 arquivos; inclui `scripts/**/*.test.ts`) · build ok.
  Nenhum teste depende de `.env`.
- Migrações: editar `drizzle/schema.ts` → `pnpm exec drizzle-kit generate --name <descricao>` (exige
  `DATABASE_URL` definida no shell, qualquer valor; não conecta) → conferir o `.sql` gerado. **Nunca editar
  à mão `drizzle/meta/_journal.json` nem os snapshots; nunca copiar SQL à mão.** Aplicar na VPS = **somente
  `pnpm exec drizzle-kit migrate`** (env do ambiente carregado), só o Marcelo, com planejamento e backup antes.
  **Nunca `pnpm db:push` nem `drizzle-kit generate` na VPS**: `generate` escreve em `drizzle/` no clone e
  quebra o gate 2 (working tree limpa) de todo deploy seguinte. Exceção histórica, não procedimento:
  no Gate 2.5 as tags 0006–0008 foram renomeadas no journal para manter paridade com os nomes da Manus.
- Scripts: `scripts/criar-admin.ts` (bootstrap do admin; `ADMIN_EMAIL`/`ADMIN_NOME` no shell),
  `scripts/sonda-export.ts` (estrutura do export, sem valores), `scripts/import-manus.ts` (import em
  transação; `--mode full|leads`, `--dry-run`/`--apply`; lógica pura em `scripts/lib/importManus.ts`; no modo
  leads a referência de contagem é o próprio export), `scripts/converter-editais.ts` (planilha de editais →
  CSV, roda na máquina local), `scripts/import-editais.ts` (carga idempotente da base de editais em lotes),
  `scripts/migrar-contatos.ts` (JSON `telefoneSocios` → `lead_contatos` + CPF do intimado),
  `scripts/atribuir-andamento.ts` (leads em andamento → quem os moveu, por grupo), `scripts/sonda-empresaqui.ts`
  (estrutura da API EmpresAqui), `scripts/deploy-staging.sh`, `scripts/deploy-prod.sh`, `scripts/backup-mysql.sh`.
  Todos com `--dry-run`/`--apply` quando gravam; nunca imprimem valores de linha. Units e nginx em `deploy/`.

## Deploy
Marcelo roda na VPS, como root: `bash /srv/parr/staging/scripts/deploy-staging.sh` (staging) ou
`bash /srv/parr/prod/scripts/deploy-prod.sh` (produção). Os dois fazem fetch → checam se o diff toca
`drizzle/` (se sim, `PARAR`: migração é manual e planejada) → pull ff-only → install frozen → build →
restart → smoke (HTTP 200 e `<html lang="pt-BR" translate="no">`), e imprimem a linha de rollback.
Em produção o build vai para `dist-next/` e só é trocado por `dist/` depois de conferido (`dist-prev/` =
rollback rápido); `dist-next/` e `dist-prev/` estão no `.gitignore`. **Migração nunca é automática.**
Instalar sempre com devDependencies (`dist/index.js` importa `vite` estaticamente — backlog).

## Armadilhas conhecidas
- `client/index.html` precisa manter `<html lang="pt-BR" translate="no">` e
  `<meta name="google" content="notranslate">`: o tradutor do Chrome muta o DOM sob o React
  (NotFoundError insertBefore/removeChild). Há teste (`client/src/index-html.test.ts`).
- MySQL da VPS em UTC (`default-time-zone = '+00:00'`); o drizzle grava e lê `TIMESTAMP` como UTC
  (`mapToDriverValue` → string UTC; leitura `+ "+0000"`). Não fazer aritmética de fuso no código.
- `lead_notes.userId` e `lead_status_history.userId` apontam para **`users.id`** (tabela de sessão,
  `openId = local-<id>`), não para `local_users.id`.
- **Não há foreign keys**: integridade referencial só no TypeScript e nos scripts de import.
- `PUBLIC_BASE_URL` (sem barra final; o boot rejeita) monta o redirect URI do Google Calendar
  (`/api/google-calendar/callback`) **e** o link de ativação (`/ativar-conta?token=`): mudar a URL exige
  cadastrar a nova redirect URI no Google Cloud Console.
- Boot em `NODE_ENV=production` falha sem `DATABASE_URL`, `JWT_SECRET` (≥ 32 chars) ou `PUBLIC_BASE_URL`
  (`server/_core/bootChecks.ts`); nomes no log, nunca valores. Servidor escuta em `HOST` (default
  127.0.0.1); porta ocupada encerra o processo.
- Ativação por convite: `local_users` nasce `active=0`, `passwordHash=NULL`; "ativação pendente" =
  hash nulo (não `active=0`). Login/changePassword devolvem o mesmo erro para e-mail inexistente,
  conta inativa, hash nulo e senha errada (sem enumeração) — não "melhorar" as mensagens.
- Scripts `.sh` com fim de linha LF (`.gitattributes`); `core.autocrlf=true` no Windows.
- `pnpm dev` usa sintaxe POSIX (`NODE_ENV=…`): rodar no Git Bash.

## Backlog (fora de escopo até decisão)
**Antes do cutover**
- `mustChangePassword` **não é verificado no login**: com a flag em 1 o usuário entra direto no dashboard;
  a senha temporária vive indefinidamente.
- `settings.getAdmin` devolve `googleCalendarRefreshToken` em claro a qualquer usuário logado.

**Demais**
- `settings.update`, `leads.listImports` e `googleCalendar.disconnect` são `protectedProcedure`: abertos a
  qualquer logado (candidatos a `adminProcedure`).
- Os 5 usuários importados da Manus são todos `admin` (a Manus não tinha o papel `comercial`) — revisar papéis.
- `activateLocalUser` grava `active=1` incondicionalmente; `resetPassword` do admin anula em silêncio o
  token de convite pendente (e zera `mustChangePassword`).
- Staging faz build no mesmo diretório: se `pnpm build` falhar no meio, `dist/public` fica parcial com o
  serviço antigo no ar (produção já usa `dist-next/`). Alinhar o staging ao `deploy-prod.sh`.
- Cópia off-VPS dos backups e alerta de falha: implementados (`scripts/backup-offsite.sh`, Backblaze B2 criptografado,
  `parr-alerta@`); roteiro e teste de restauração em `deploy/BACKUP-OFFSITE.md`.
- `setupVite` importado estaticamente → `dist/index.js` depende de devDependencies (`vite`,
  `@vitejs/plugin-react`, `@tailwindcss/vite`).
- Callback do Calendar sem `state`/CSRF; token do Pipedrive na query string (`?api_token=`).
- Sem procedure para trocar `role`; sessão de 1 ano sem revogação além de `active=0`; hash do token de
  ativação no banco (hoje em claro).
- Code-split do `xlsx` (429 kB); `PORT` inválida encerra com código 0; "Ignored build scripts" (esbuild,
  @tailwindcss/oxide) no pnpm; string "Caráter" na tela do Calendar (tradução errada de Warning).

## Modelo de dados (desde 05/10/2026)
- **Lead = par pessoa + empresa** de edital PGFN (PARR); procedimentos em `lead_procedimentos` (nº único),
  editais em `editais`. ~340 mil leads, 542 mil procedimentos (editais 2025–2026). Kanban paginado no servidor.
- **Grupo** (`leads.grupoId`): leads que compartilham pessoa (nome + CPF parcial) ou empresa (CNPJ); distribuição,
  devolução e transferência andam sempre pelo grupo inteiro.
- **Carteira**: `leads.responsavelId` → `local_users.id`. Parceiro (perfil comercial) só acessa leads dele em todas
  as rotas (`server/acesso.ts`); admin vê tudo. Excluir lead: só admin; parceiro arquiva com motivo.
  Trilha em `lead_eventos`; filtro salvo por parceiro em `carteiras`.
- **Empresa** (`empresas`, 1 por CNPJ, EmpresAqui): `dados.csv` / `dados.api` em JSON; EmpresAqui nunca toca
  nome/telefone/CPF/contatos do lead. Contatos editáveis em `lead_contatos`; CPF completo em `leads.cpf`.
- **Prazo de impugnação**: publicação + 30 dias corridos, prorrogado ao 1º dia útil só em fim de semana e feriado
  nacional (conservador; `shared/editais.ts`).
- Erros internos nunca vão à tela com a mensagem original (`server/_core/trpc.ts`, `formatarErro`).
- **API EmpresAqui** (Fase D): token só em `EMPRESAQUI_API_TOKEN` (env de cada ambiente; a tela mostra só "configurado").
  Botão no card da empresa (admin e parceiro; parceiro só na carteira); cache (padrão 30 dias) e teto mensal (padrão 500)
  em `site_settings`; cada consulta registrada em `integracao_consultas`. Limite da API: 1 req/s (fila em
  `server/empresaqui/clienteApi.ts`). A API corrompe acentos (UTF-8 lido como Latin-1): `corrigirTexto`.

## Roteiro
- Gates 0–2.5: concluídos (desacoplamento da Manus, patch pré-staging, paridade de schema 0006–0008,
  import do banco).
- Gate 3: concluído com a virada de 05/10/2026. Pendente: cópia off-VPS dos backups (antes de aposentar
  a Manus), reinício do Ubuntu com atualizações de segurança, limpeza de 20 leads duplicados herdados da Manus.
- Próximas fases: C (conferência do CPF pelos dígitos do edital, intimado na lista de sócios da EmpresAqui,
  enriquecimento por prioridade); D (API EmpresAqui + menu Integrações).
- Histórico do Gate 3: staging no ar; bloqueio de tradução; deploy scripts; endurecimento
  (mustChangePassword, papel efetivo, procedures de admin); import só-leads; backup; produção montada em
  parr.primetax.com.br com links públicos ainda na Manus. Pendente: virada — export final da Manus → import
  só-leads, convidar equipe, conectar Agenda (redirect URI de produção no Google Cloud Console), smoke no
  iPhone, trocar links, observar, aposentar o manus.space.
