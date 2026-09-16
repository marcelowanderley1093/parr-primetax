# DESPACHO-PARR-01 — Gate 1: desacoplamento da Manus (FASE 0, somente leitura)

Leia CLAUDE.md inteiro antes de começar. Esta fase NÃO altera arquivos, NÃO instala pacotes novos
e NÃO faz commit. Entrega um relatório e PARA.

## Objetivo do gate
O app roda fora da Manus com: login só por e-mail/senha (local_users), sessão JWT local,
notificação de novo lead por e-mail SMTP, assets servidos do próprio projeto, sem plugins nem
domínio da Manus, e comportamento funcional idêntico ao atual.

## Fase 0 — o que medir e reportar

0.1 Baseline: rode `git rev-parse --short HEAD`, `git status --porcelain`, `pnpm install --frozen-lockfile`,
    `pnpm check`, `pnpm test`, `pnpm build`. Cole a saída relevante verbatim. Esperado: HEAD do Gate 0,
    tsc 0, 34 passed / 2 failed (google-calendar.test.ts por falta de env), build ok.
    Imprima PASSOU se bater; PARAR com a diferença se não bater.

0.2 Autenticação: mapeie o caminho completo de login hoje.
    - Onde o front decide ir para o OAuth da Manus vs a página LocalLogin (rotas em App.tsx, useAuth,
      getLoginUrl em client/src/const.ts, DashboardLayout).
    - O que `sdk.authenticateRequest` faz quando o usuário não está em `users` (chamada ao servidor
      OAuth) e o que muda se removermos esse ramo.
    - Todos os usos de `ENV.ownerOpenId`/OWNER_OPEN_ID e de `role === 'admin'`.
    - Como `local_users` e `users` se relacionam (openId `local-<id>`) e se existe caminho para um admin
      de local_users virar admin em users (localAuth.login faz upsert com role do localUser?).
    - `changePassword` é publicProcedure recebendo e-mail + senha atual: reporte se há rate limit.

0.3 Notificação: leia `server/_core/notification.ts` e o bloco de routers.ts que chama notifyOwner
    (≈linha 89). Reporte o conteúdo enviado hoje e se falha de notificação quebra a criação do lead.

0.4 Superfície Manus: para cada item 3 a 6 do CLAUDE.md, liste arquivo:linha e, para os módulos
    _core, o resultado de grep de import (quem importa cada um). Inclua `systemRouter.ts` e
    `server/_core/types/manusTypes.ts`.

0.5 Variáveis de ambiente: lista completa do que o código lê (process.env e import.meta.env), marcando
    quais somem após o gate e quais ficam.

## Proposta de desenho (entregar junto, sem aplicar)
- Login: LocalLogin como única porta; remover rotas/ramos OAuth; admin via local_users.role.
- Bootstrap do primeiro admin: script idempotente `pnpm tsx scripts/criar-admin.ts` que lê e-mail,
  nome e senha de variáveis de ambiente (nunca argumento de linha de comando) e cria/atualiza em
  local_users com role admin e mustChangePassword=1.
- Notificação: `nodemailer` com SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, NOTIFY_EMAIL_TO;
  falha de envio só loga (sem dados pessoais do lead no log) e nunca derruba a criação do lead.
- Domínio: `PUBLIC_BASE_URL` único substituindo os fallbacks manus.space.
- Diff esperado por arquivo, testes novos/ajustados, e o que acontece com os 2 testes do Calendar.

## Ponto de parada
Fim da Fase 0 + proposta. Nada é aplicado até o Marcelo aprovar.
