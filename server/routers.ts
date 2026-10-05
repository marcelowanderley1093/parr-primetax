import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import { checkRateLimit, rateLimitKey, resetRateLimit } from "./_core/rateLimit";
import { emailInput } from "./localUsersHelpers";
import { buildGoogleCalendarAuthUrl, getGoogleCalendarRedirectUri, getPublicBaseUrl } from "./googleCalendar";
import { sendActivationEmail } from "./_core/activationEmail";
import { randomBytes } from "node:crypto";
import { STATUS_CONTATO, cpfValido, digitos, emailValido, normalizarTelefone } from "@shared/contatos";
import { LayoutInvalidoError, parseEmpresaquiCsv } from "./empresaqui/parserCsv";
import { LEAD_NAO_ENCONTRADO, exigirAcessoLead, responsavelDoEscopo, visaoKanban } from "./acesso";
import * as carteira from "./carteira";
import * as sincronizacao from "./empresaqui/sincronizacao";
import { MENSAGEM_ERRO_API } from "./empresaqui/clienteApi";
import { chaveCnpjLead } from "./empresaqui/importacao";
import { MOTIVOS_ARQUIVAMENTO, SITUACOES_CADASTRAIS, UFS, limparFiltro } from "@shared/carteira";
import { eventoDoGoogle, type EventoAgenda } from "@shared/agenda";
import { parseLocalOpenId } from "./localUsersHelpers";
import { ArquivoInvalidoError, contarLeadsPorCnpj, decodificarArquivo, linhaEmpresa, resumirImportacao } from "./empresaqui/importacao";

// Filtro de carteira (shared/carteira.ts). Datas ISO; divida em reais.
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filtroInput = z.object({
  situacoes: z.array(z.enum(SITUACOES_CADASTRAIS)).optional(),
  dividaMin: z.number().min(0).nullable().optional(),
  dividaMax: z.number().min(0).nullable().optional(),
  ufs: z.array(z.string().refine(u => UFS.includes(u), { message: "UF invalida" })).optional(),
  cnaeDivisoes: z.array(z.string().regex(/^\d{2}$/)).max(99).optional(),
  publicacaoDe: dataIso.nullable().optional(),
  publicacaoAte: dataIso.nullable().optional(),
  somentePrazoAberto: z.boolean().optional(),
  incluirSemEmpresa: z.boolean().optional(),
}).transform(limparFiltro);

/** Data de hoje no Brasil (o servidor roda em UTC). */
const hojeBrasil = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Quem esta agindo, para a trilha de eventos (local_users.id + nome). */
const atorDe = (user: NonNullable<TrpcContext["user"]>): carteira.Ator => ({ localUserId: parseLocalOpenId(user.openId), nome: user.name || "Admin" });

/** CNPJ de 14 digitos com digito verificador valido (o mesmo calculo do leitor do CSV). */
function cnpjValido14(c: string | null): c is string {
  if (!c || !/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len: number) => {
    let soma = 0;
    let peso = len - 7;
    for (let i = 0; i < len; i++) { soma += Number(c[i]) * peso; peso = peso === 2 ? 9 : peso - 1; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

/** Sincroniza pela API e traduz as falhas para mensagens de tela (sem detalhes internos). */
async function sincronizarComMensagem(cnpj14: string, userId: number, forcar: boolean) {
  try {
    const r = await sincronizacao.sincronizarEmpresa(cnpj14, { userId, forcar });
    if (r.status === "erro") return { ...r, mensagem: MENSAGEM_ERRO_API[r.codigo] };
    return r;
  } catch (e) {
    if (e instanceof sincronizacao.IntegracaoIndisponivelError || e instanceof sincronizacao.TetoAtingidoError) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
    }
    throw e;
  }
}

async function exigirParceiroAtivo(id: number) {
  if (!(await carteira.ehParceiroAtivo(id))) throw new TRPCError({ code: "BAD_REQUEST", message: "Parceiro inexistente, inativo ou sem perfil comercial" });
}

// Visao do Kanban pedida pela tela (o servidor restringe o parceiro a propria carteira; ver acesso.visaoKanban).
const visaoInput = z.union([z.enum(["todos", "livres", "arquivados"]), z.number().int().positive()]).optional();

const arquivoCsvInput = z.object({
  fileName: z.string().max(255),
  conteudoBase64: z.string().min(1).max(30 * 1024 * 1024),
});

/**
 * Cancelar/remarcar: alem do acesso ao lead, o evento informado tem de ser o do proprio lead
 * (impede usar um lead da carteira para mexer no evento de outro).
 */
async function exigirEventoDoLead(user: NonNullable<TrpcContext["user"]>, leadId: number, eventId: string) {
  await exigirAcessoLead(user, leadId);
  const lead = await db.getLeadById(leadId);
  if (!lead || !lead.calendarEventId || lead.calendarEventId !== eventId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Evento não encontrado para este lead" });
  }
}

/** Tamanho maximo de cada campo na importacao de Excel (= tamanho das colunas em `leads`). */
export const LIMITES_IMPORTACAO = { nome: 255, email: 320, telefone: 30, cnpj: 20, valorDivida: 50, devedorPrincipal: 255 } as const;

/** Problemas por linha (linha 2 = primeira linha de dados da planilha). Sem valores na mensagem. */
export function validarLinhasImportacao(linhas: Array<Partial<Record<keyof typeof LIMITES_IMPORTACAO | "mensagem", string>>>): string[] {
  const out: string[] = [];
  linhas.forEach((l, i) => {
    const n = i + 2;
    if (!l.nome || !l.nome.trim()) out.push(`linha ${n}: nome vazio`);
    for (const [campo, max] of Object.entries(LIMITES_IMPORTACAO) as [keyof typeof LIMITES_IMPORTACAO, number][]) {
      const v = l[campo];
      if (v && v.length > max) out.push(`linha ${n}: ${campo} com mais de ${max} caracteres`);
    }
  });
  return out;
}

/** Le o CSV EmpresAqui enviado; erros de formato viram BAD_REQUEST com mensagem sem dados do arquivo. */
function lerCsvEmpresaqui(conteudoBase64: string) {
  try {
    return parseEmpresaquiCsv(decodificarArquivo(conteudoBase64));
  } catch (e) {
    if (e instanceof LayoutInvalidoError || e instanceof ArquivoInvalidoError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    }
    throw e;
  }
}

// CPF opcional: "" limpa (null); qualquer outro valor precisa ter digito verificador valido.
const cpfInput = z
  .string()
  .transform(v => digitos(v))
  .refine(v => v === "" || cpfValido(v), { message: "CPF inválido (confira os dígitos)" });

/** Valida e normaliza o valor de um contato conforme o tipo. Lanca BAD_REQUEST com mensagem para o usuario. */
function normalizarValorContato(tipo: "telefone" | "email", valor: string): string {
  if (tipo === "telefone") {
    const t = normalizarTelefone(valor);
    if (!t) throw new TRPCError({ code: "BAD_REQUEST", message: "Telefone inválido: informe DDD + número (10 ou 11 dígitos)" });
    return t;
  }
  if (!emailValido(valor)) throw new TRPCError({ code: "BAD_REQUEST", message: "E-mail inválido" });
  return valor.trim().toLowerCase();
}

const leadInputSchema = z.object({
  nome: z.string().min(2, "Nome é obrigatório"),
  email: z.string().email("Email inválido"),
  telefone: z.string().min(8, "Telefone inválido"),
  cnpj: z.string().optional(),
  valorDivida: z.string().optional(),
  mensagem: z.string().optional(),
  lgpdConsent: z.number().min(1, "Consentimento LGPD é obrigatório"),
});

// Helper: get Google Calendar access token from refresh token
async function getCalendarAccessToken(): Promise<string | null> {
  const refreshToken = await db.getSetting("googleCalendarRefreshToken");
  const clientId = ENV.googleCalendarClientId;
  const clientSecret = ENV.googleCalendarClientSecret;
  if (!refreshToken || !clientId || !clientSecret) return null;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token || null;
}

// Login/changePassword: todos os caminhos de recusa (e-mail inexistente, conta inativa, hash nulo,
// senha errada) devolvem o MESMO codigo e mensagem, para nao enumerar contas.
const LOGIN_ERROR = { code: "UNAUTHORIZED" as const, message: "Email ou senha inválidos" };
const CHANGE_PASSWORD_ERROR = { code: "UNAUTHORIZED" as const, message: "Senha atual incorreta" };
// Hash bcrypt fixo (custo 10) de uma senha descartavel. Nao e segredo: serve so para que os caminhos
// que recusam antes de ter um hash real executem uma comparacao de custo equivalente (oraculo de tempo).
const DUMMY_BCRYPT_HASH = "$2b$10$YGMvGuLarZXVzQNHIor0W.doKE/N.U5yMPDP.vJWiBjSepO8rWykS";

/** Compara a senha contra o hash da conta; sem hash utilizavel, compara contra o dummy e recusa. */
async function verifyPassword(
  bcrypt: typeof import("bcryptjs"),
  password: string,
  localUser: { active: number; passwordHash: string | null } | undefined
): Promise<boolean> {
  const usable = Boolean(localUser && localUser.active && localUser.passwordHash);
  const hash = usable ? (localUser!.passwordHash as string) : DUMMY_BCRYPT_HASH;
  const match = await bcrypt.compare(password, hash);
  return usable && match;
}

// Ativacao de conta por link: token em claro no banco (hash do token esta no backlog)
const ACTIVATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function newActivationToken(): { token: string; expiry: Date } {
  return { token: randomBytes(32).toString("hex"), expiry: new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS) };
}
function buildActivationLink(token: string): string {
  return `${getPublicBaseUrl()}/ativar-conta?token=${token}`;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  settings: router({
    get: publicProcedure.query(async () => {
      const settings = await db.getAllSettings();
      return {
        videoUrl: settings["videoUrl"] || null,
        googleCalendarConnected: settings["googleCalendarRefreshToken"] ? true : false,
      };
    }),
    // Admin: so a chave editavel pela tela (nunca o refresh token do Calendar por aqui)
    update: adminProcedure.input(z.object({
      key: z.enum(["videoUrl"]),
      value: z.string(),
    })).mutation(async ({ input }) => {
      await db.setSetting(input.key, input.value);
      return { success: true };
    }),
    // Admin: nunca devolve googleCalendarRefreshToken, so o booleano de conexao
    getAdmin: adminProcedure.query(async () => {
      const settings = await db.getAllSettings();
      return {
        videoUrl: settings["videoUrl"] || null,
        googleCalendarConnected: Boolean(settings["googleCalendarRefreshToken"]),
        googleCalendarEmail: settings["googleCalendarEmail"] || null,
      };
    }),
  }),

  leads: router({
    // Public: create lead from LP form
    create: publicProcedure.input(leadInputSchema).mutation(async ({ input }) => {
      const leadId = await db.createLead({
        nome: input.nome,
        email: input.email,
        telefone: input.telefone,
        cnpj: input.cnpj || null,
        valorDivida: input.valorDivida || null,
        mensagem: input.mensagem || null,
        lgpdConsent: input.lgpdConsent,
        status: "novo_lead",
      });

      // Notify owner (e-mail). Falha nunca derruba a criação do lead: notifyOwner não lança,
      // o try/catch é defesa em profundidade e o log não inclui dados do lead.
      try {
        await notifyOwner({
          title: `Novo Lead PARR: ${input.nome}`,
          content:
            `Novo lead capturado na LP do PARR\n\n` +
            `Nome: ${input.nome}\n` +
            `Email: ${input.email}\n` +
            `Telefone: ${input.telefone}\n` +
            `CNPJ: ${input.cnpj || "Não informado"}\n` +
            `Valor da Dívida: ${input.valorDivida || "Não informado"}\n` +
            `Mensagem: ${input.mensagem || "Sem mensagem"}\n\n` +
            `Lead #${leadId}`,
        });
      } catch (e) {
        console.error("[Notification] Falha inesperada ao notificar:", e instanceof Error ? e.message : String(e));
      }

      // Try Pipedrive integration
      try {
        const pipedriveToken = process.env.PIPEDRIVE_API_TOKEN;
        const pipedriveDomain = process.env.PIPEDRIVE_DOMAIN;
        if (pipedriveToken && pipedriveDomain) {
          const baseUrl = `https://${pipedriveDomain}.pipedrive.com/api/v1`;
          const personRes = await fetch(`${baseUrl}/persons?api_token=${pipedriveToken}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: input.nome,
              email: [{ value: input.email, primary: true }],
              phone: [{ value: input.telefone, primary: true }],
            }),
          });
          const personData = await personRes.json();
          const personId = personData?.data?.id;
          if (personId) {
            const dealValue = input.valorDivida ? parseFloat(input.valorDivida.replace(/[^\d.,]/g, "").replace(",", ".")) : 0;
            const dealRes = await fetch(`${baseUrl}/deals?api_token=${pipedriveToken}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: `PARR - ${input.nome}`,
                person_id: personId,
                value: dealValue || undefined,
                currency: "BRL",
              }),
            });
            const dealData = await dealRes.json();
            const dealId = dealData?.data?.id;
            if (dealId) {
              await db.updateLeadPipedrive(leadId, String(personId), String(dealId));
            }
          }
        }
      } catch (e) {
        console.error("[Pipedrive] Integration error:", e);
      }

      return { id: leadId, success: true };
    }),

    // Kanban paginado: uma pagina de uma coluna (substitui a antiga leads.list, que carregava todos os leads).
    coluna: protectedProcedure.input(z.object({
      status: z.enum(["novo_lead", "contato_inicial", "reuniao_agendada", "proposta_enviada"]),
      busca: z.string().max(100).optional(),
      cursor: z.number().int().min(0).optional(), // offset
      limite: z.number().int().min(1).max(100).default(50),
      visao: visaoInput,
    })).query(async ({ input, ctx }) => {
      const offset = input.cursor ?? 0;
      const { itens, total } = await db.listarColuna(input.status, input.busca, offset, input.limite, visaoKanban(ctx.user, input.visao));
      const proximo = offset + itens.length < total ? offset + itens.length : null;
      return { itens, total, proximo };
    }),

    // Totais por coluna (cabecalho do Kanban), respeitando a busca.
    contagem: protectedProcedure.input(z.object({ busca: z.string().max(100).optional(), visao: visaoInput })).query(async ({ input, ctx }) => {
      return db.contarPorStatus(input.busca, visaoKanban(ctx.user, input.visao));
    }),

    // Editais e procedimentos do lead.
    procedimentos: protectedProcedure.input(z.object({ leadId: z.number() })).query(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      return db.getProcedimentosDoLead(input.leadId);
    }),

    // Protected: get lead by id
    getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.id);
      return db.getLeadById(input.id);
    }),

    // Protected: update lead status
    updateStatus: protectedProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["novo_lead", "contato_inicial", "reuniao_agendada", "proposta_enviada"]),
    })).mutation(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.id);
      return db.updateLeadStatus(input.id, input.status, ctx.user.id, ctx.user.name || "Admin");
    }),

    // Protected: update lead fields
    update: protectedProcedure.input(z.object({
      id: z.number(),
      nome: z.string().min(2).optional(),
      email: z.string().email().optional(),
      telefone: z.string().min(8).optional(),
      cnpj: z.string().optional(),
      devedorPrincipal: z.string().optional(),
      valorDivida: z.string().optional(),
      cpf: cpfInput.optional(),
    })).mutation(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.id);
      const { id, ...data } = input;
      const cleanData: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) cleanData[key] = value || null;
      }
      return db.updateLead(id, cleanData as any);
    }),

    // Excluir lead: so admin (decisao 02/10/2026). O parceiro arquiva.
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.deleteLead(input.id);
      return { success: true };
    }),

    // Protected: get notes for a lead
    getNotes: protectedProcedure.input(z.object({ leadId: z.number() })).query(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      return db.getLeadNotes(input.leadId);
    }),

    // Protected: add note to a lead
    addNote: protectedProcedure.input(z.object({
      leadId: z.number(),
      content: z.string().min(1),
    })).mutation(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      return db.createLeadNote({
        leadId: input.leadId,
        userId: ctx.user.id,
        userName: ctx.user.name || "Admin",
        content: input.content,
      });
    }),

    // Protected: get status history for a lead
    getHistory: protectedProcedure.input(z.object({ leadId: z.number() })).query(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      return db.getLeadStatusHistory(input.leadId);
    }),

    // Protected: schedule calendar event
    scheduleEvent: protectedProcedure.input(z.object({
      leadId: z.number(),
      title: z.string(),
      description: z.string().optional(),
      startTime: z.string(),
      endTime: z.string(),
      attendeeEmail: z.string().email().optional(),
    })).mutation(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      let calendarEventId = `local-${Date.now()}`;
      try {
        const accessToken = await getCalendarAccessToken();
        if (accessToken) {
          // Ensure times have timezone offset for Sao Paulo
          const event: Record<string, unknown> = {
            summary: input.title,
            description: input.description || "",
            start: { dateTime: input.startTime, timeZone: "America/Sao_Paulo" },
            end: { dateTime: input.endTime, timeZone: "America/Sao_Paulo" },
          };
          if (input.attendeeEmail) {
            event.attendees = [{ email: input.attendeeEmail }];
          }

          const calRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(event),
          });
          const calData = await calRes.json();
          // Nao registrar a resposta inteira: traz e-mail de convidado (dado pessoal).
          console.log("[Google Calendar] Create event:", calData.id ? "ok" : "sem id");
          if (calData.id) {
            calendarEventId = calData.id;
          } else if (calData.error) {
            console.error("[Google Calendar] API error:", calData.error);
          }
        }
      } catch (e) {
        console.error("[Google Calendar] Error creating event:", e);
      }

      // Store event info as a note
      await db.createLeadNote({
        leadId: input.leadId,
        userId: ctx.user.id,
        userName: ctx.user.name || "Admin",
        content: `📅 Reunião agendada: ${input.title}\nInício: ${input.startTime}\nFim: ${input.endTime}\n${input.description ? `Descrição: ${input.description}` : ""}`,
      });
      await db.updateLeadCalendarEvent(input.leadId, calendarEventId);
      return { success: true, eventId: calendarEventId };
    }),

    // Protected: cancel calendar event
    cancelEvent: protectedProcedure.input(z.object({
      leadId: z.number(),
      eventId: z.string(),
    })).mutation(async ({ input, ctx }) => {
      await exigirEventoDoLead(ctx.user, input.leadId, input.eventId);
      try {
        const accessToken = await getCalendarAccessToken();
        if (accessToken && !input.eventId.startsWith("local-")) {
          const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${input.eventId}?sendUpdates=all`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!calRes.ok) {
            const errData = await calRes.json().catch(() => ({}));
            console.error("[Google Calendar] Delete error:", errData);
          }
        }
      } catch (e) {
        console.error("[Google Calendar] Error canceling event:", e);
      }

      await db.updateLeadCalendarEvent(input.leadId, "");
      await db.createLeadNote({
        leadId: input.leadId,
        userId: ctx.user.id,
        userName: ctx.user.name || "Admin",
        content: `❌ Reunião cancelada`,
      });
      return { success: true };
    }),

    // Protected: reschedule calendar event
    rescheduleEvent: protectedProcedure.input(z.object({
      leadId: z.number(),
      eventId: z.string(),
      title: z.string(),
      description: z.string().optional(),
      startTime: z.string(),
      endTime: z.string(),
      attendeeEmail: z.string().email().optional(),
    })).mutation(async ({ input, ctx }) => {
      await exigirEventoDoLead(ctx.user, input.leadId, input.eventId);
      let newEventId = input.eventId;
      try {
        const accessToken = await getCalendarAccessToken();
        if (accessToken && !input.eventId.startsWith("local-")) {
          const event: Record<string, unknown> = {
            summary: input.title,
            description: input.description || "",
            start: { dateTime: input.startTime, timeZone: "America/Sao_Paulo" },
            end: { dateTime: input.endTime, timeZone: "America/Sao_Paulo" },
          };
          if (input.attendeeEmail) {
            event.attendees = [{ email: input.attendeeEmail }];
          }

          const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${input.eventId}?sendUpdates=all`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(event),
          });
          const calData = await calRes.json();
          console.log("[Google Calendar] Reschedule response:", JSON.stringify(calData));
          if (calData.id) {
            newEventId = calData.id;
          }
        }
      } catch (e) {
        console.error("[Google Calendar] Error rescheduling event:", e);
      }

      await db.updateLeadCalendarEvent(input.leadId, newEventId);
      await db.createLeadNote({
        leadId: input.leadId,
        userId: ctx.user.id,
        userName: ctx.user.name || "Admin",
        content: `🔄 Reunião remarcada: ${input.title}\nNovo horário: ${input.startTime} - ${input.endTime}`,
      });
      return { success: true, eventId: newEventId };
    }),

    // Protected: import leads from Excel data
    importExcel: adminProcedure.input(z.object({
      fileName: z.string().optional(),
      sheetName: z.string().optional(),
      leads: z.array(z.object({
        nome: z.string(),
        email: z.string().optional(),
        telefone: z.string().optional(),
        cnpj: z.string().optional(),
        valorDivida: z.string().optional(),
        mensagem: z.string().optional(),
        devedorPrincipal: z.string().optional(),
      })).max(5000),
    })).mutation(async ({ input, ctx }) => {
      // Valida tudo antes de gravar: o erro aponta a linha e o campo, nunca o conteudo.
      const problemas = validarLinhasImportacao(input.leads);
      if (problemas.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Planilha recusada, nada foi gravado. ${problemas.slice(0, 5).join("; ")}${problemas.length > 5 ? ` (e mais ${problemas.length - 5})` : ""}.` });
      }
      // Create import batch record
      const batchId = await db.createImportBatch({
        fileName: input.fileName || "Importação Excel",
        sheetName: input.sheetName || null,
        leadsCount: 0,
        importedBy: ctx.user.name || "Admin",
      });

      const leadsToInsert = input.leads.map(l => ({
        nome: l.nome,
        email: l.email || "",
        telefone: l.telefone || "",
        cnpj: l.cnpj || null,
        devedorPrincipal: l.devedorPrincipal || null,
        valorDivida: l.valorDivida || null,
        mensagem: l.mensagem || null,
        lgpdConsent: 1,
        status: "novo_lead" as const,
      }));
      let count: number;
      try {
        count = await db.bulkCreateLeads(leadsToInsert, batchId);
      } catch (e) {
        // A transacao ja desfez os leads; remove tambem o registro do lote, que ficaria vazio.
        await db.deleteImportBatch(batchId).catch(() => undefined);
        throw e;
      }
      await db.updateImportBatchCount(batchId, count);
      // Liga os leads novos as empresas ja importadas do CSV EmpresAqui (pelo CNPJ). Nao fatal: os leads ja
      // foram gravados; uma falha aqui so deixa o vinculo para a proxima importacao do CSV.
      let vinculados: number | null = null;
      try {
        vinculados = await db.vincularLeadsAEmpresas(batchId);
      } catch (e) {
        console.warn("[importExcel] vinculo com empresas falhou:", (e as Error).name);
      }
      return { success: true, imported: count, batchId, vinculados };
    }),

    // Protected: list import batches
    listImports: adminProcedure.query(async () => {
      return db.getAllImportBatches();
    }),

    // Protected: delete import batch and its leads
    deleteImport: adminProcedure.input(z.object({
      batchId: z.number(),
    })).mutation(async ({ input }) => {
      const deletedCount = await db.deleteImportBatch(input.batchId);
      return { success: true, deletedLeads: deletedCount };
    }),

    // Protected: get calendar events for dashboard calendar view
    getCalendarEvents: protectedProcedure.query(async ({ ctx }) => {
      try {
        const accessToken = await getCalendarAccessToken();
        if (!accessToken) return { connected: false, events: [] };

        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

        const calRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=250`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const calData = await calRes.json();

        // Local de trabalho ("Escritorio") fica fora; dia inteiro vem marcado (shared/agenda.ts).
        const events: EventoAgenda[] = (calData.items || [])
          .map(eventoDoGoogle)
          .filter((e: EventoAgenda | null): e is EventoAgenda => e !== null);

        // Parceiro ve so os eventos dos leads da carteira dele (decisao 02/10/2026).
        const responsavel = responsavelDoEscopo(ctx.user);
        if (responsavel !== undefined) {
          const meus = await db.getCalendarEventIdsDoResponsavel(responsavel);
          return { connected: true, events: events.filter((e: { id: string }) => meus.has(e.id)) };
        }
        return { connected: true, events };
      } catch (e) {
        console.error("[Google Calendar] Error fetching events:", e);
        return { connected: false, events: [] };
      }
    }),
  }),

  // Local Users management (admin creates users with email/password)
  // Contatos do lead (lead_contatos): qualquer usuario logado le e edita (decisao 02/10/2026).
  // Cada escrita grava quem alterou (users.id + nome). Telefone so digitos, sem DDI.
  contatos: router({
    list: protectedProcedure.input(z.object({ leadId: z.number() })).query(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      return db.getLeadContatos(input.leadId);
    }),

    create: protectedProcedure.input(z.object({
      leadId: z.number(),
      pessoaNome: z.string().trim().max(255).optional(),
      pessoaCpf: cpfInput.optional(),
      tipo: z.enum(["telefone", "email"]),
      valor: z.string().min(1).max(320),
      observacao: z.string().max(2000).optional(),
    })).mutation(async ({ input, ctx }) => {
      const valor = normalizarValorContato(input.tipo, input.valor);
      await exigirAcessoLead(ctx.user, input.leadId);
      const lead = await db.getLeadById(input.leadId);
      if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: LEAD_NAO_ENCONTRADO });
      const id = await db.createLeadContato({
        leadId: input.leadId,
        pessoaNome: input.pessoaNome || null,
        pessoaCpf: input.pessoaCpf || null,
        tipo: input.tipo,
        valor,
        origem: "manual",
        observacao: input.observacao?.trim() || null,
        atualizadoPorUserId: ctx.user.id,
        atualizadoPorNome: ctx.user.name || "Admin",
      });
      return { id };
    }),

    update: protectedProcedure.input(z.object({
      id: z.number(),
      status: z.enum(STATUS_CONTATO).optional(),
      observacao: z.string().max(2000).optional(),
      valor: z.string().min(1).max(320).optional(),
    })).mutation(async ({ input, ctx }) => {
      const atual = await db.getLeadContatoById(input.id);
      if (!atual) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado" });
      await exigirAcessoLead(ctx.user, atual.leadId);
      return db.updateLeadContato(input.id, {
        ...(input.status !== undefined && { status: input.status }),
        ...(input.observacao !== undefined && { observacao: input.observacao.trim() || null }),
        ...(input.valor !== undefined && { valor: normalizarValorContato(atual.tipo, input.valor) }),
        atualizadoPorUserId: ctx.user.id,
        atualizadoPorNome: ctx.user.name || "Admin",
      });
    }),

    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const atual = await db.getLeadContatoById(input.id);
      if (!atual) throw new TRPCError({ code: "NOT_FOUND", message: "Contato não encontrado" });
      await exigirAcessoLead(ctx.user, atual.leadId);
      return db.deleteLeadContato(input.id);
    }),
  }),

  // Empresas (CNPJ) enriquecidas pela EmpresAqui. Importacao: so admin. Leitura: qualquer logado.
  empresas: router({
    // Previa: le o arquivo e compara com o banco. Nao grava nada.
    previewCsv: adminProcedure.input(arquivoCsvInput).mutation(async ({ input }) => {
      const resultado = lerCsvEmpresaqui(input.conteudoBase64);
      const [existentes, cnpjsLeads] = await Promise.all([db.getCnpjsEmpresas(), db.getCnpjsLeads()]);
      return resumirImportacao(resultado, existentes, contarLeadsPorCnpj(cnpjsLeads));
    }),

    // Grava todas as empresas do arquivo (upsert) e vincula os leads, em uma transacao.
    importarCsv: adminProcedure.input(arquivoCsvInput).mutation(async ({ input }) => {
      const resultado = lerCsvEmpresaqui(input.conteudoBase64);
      const agora = new Date();
      const { gravadas, leadsVinculados } = await db.gravarEmpresasCsv(resultado.empresas.map(e => linhaEmpresa(e, agora)));
      return { gravadas, leadsVinculados };
    }),

    doLead: protectedProcedure.input(z.object({ leadId: z.number() })).query(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      return db.getEmpresaDoLead(input.leadId);
    }),

    // Atualiza a empresa do lead pela API EmpresAqui (admin e parceiro; parceiro so na propria carteira).
    // Cache e teto mensal em empresaqui/sincronizacao.ts; "forcar" (ignorar o cache) so admin.
    sincronizar: protectedProcedure.input(z.object({ leadId: z.number(), forcar: z.boolean().optional() })).mutation(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      const lead = await db.getLeadById(input.leadId);
      if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: LEAD_NAO_ENCONTRADO });
      const cnpj = chaveCnpjLead(lead.cnpj);
      if (!cnpjValido14(cnpj)) throw new TRPCError({ code: "BAD_REQUEST", message: "Lead sem CNPJ válido para consultar" });
      return sincronizarComMensagem(cnpj, ctx.user.id, !!input.forcar && ctx.user.role === "admin");
    }),
  }),

  // Configuracoes > Integracoes (so admin). O token nunca sai do servidor: so "configurado: sim/nao".
  integracoes: router({
    empresaqui: adminProcedure.query(async () => {
      const [config, consumo] = await Promise.all([sincronizacao.getConfig(), sincronizacao.consumoDoMes()]);
      return { tokenConfigurado: sincronizacao.tokenConfigurado(), ...config, consumoMes: consumo.total, consumoPorResultado: consumo.porResultado };
    }),

    salvarEmpresaqui: adminProcedure.input(z.object({
      cacheDias: z.number().int().min(1).max(365),
      tetoMensal: z.number().int().min(0).max(100000),
    })).mutation(async ({ input }) => {
      await sincronizacao.salvarConfig(input);
      return { success: true };
    }),

    // Testar conexao: consulta um CNPJ informado ignorando o cache (gasta 1 consulta).
    testarEmpresaqui: adminProcedure.input(z.object({ cnpj: z.string().max(20) })).mutation(async ({ input, ctx }) => {
      const cnpj = chaveCnpjLead(input.cnpj);
      if (!cnpjValido14(cnpj)) throw new TRPCError({ code: "BAD_REQUEST", message: "CNPJ inválido" });
      return sincronizarComMensagem(cnpj, ctx.user.id, true);
    }),
  }),

  // Carteiras de parceiros (Fase B2). Distribuir, transferir e reabrir: so admin. Devolver e arquivar: dono ou admin.
  carteira: router({
    parceiros: adminProcedure.query(async () => carteira.parceiros()),

    filtroSalvo: adminProcedure.input(z.object({ responsavelId: z.number().int() })).query(async ({ input }) => {
      return carteira.getFiltroSalvo(input.responsavelId);
    }),

    salvarFiltro: adminProcedure.input(z.object({ responsavelId: z.number().int(), filtro: filtroInput })).mutation(async ({ input, ctx }) => {
      await exigirParceiroAtivo(input.responsavelId);
      await carteira.salvarFiltro(input.responsavelId, input.filtro, atorDe(ctx.user));
      return { success: true };
    }),

    previa: adminProcedure.input(z.object({ filtro: filtroInput })).query(async ({ input }) => {
      return carteira.previaDistribuicao(input.filtro, hojeBrasil());
    }),

    atribuir: adminProcedure.input(z.object({
      responsavelId: z.number().int(),
      filtro: filtroInput,
      maxGrupos: z.number().int().min(1).max(20000),
    })).mutation(async ({ input, ctx }) => {
      await exigirParceiroAtivo(input.responsavelId);
      return carteira.atribuir(input.filtro, hojeBrasil(), input.responsavelId, input.maxGrupos, atorDe(ctx.user));
    }),

    previaCompletar: adminProcedure.query(async () => carteira.previaCompletar()),

    completar: adminProcedure.mutation(async ({ ctx }) => carteira.completarGrupos(atorDe(ctx.user))),

    doLead: protectedProcedure.input(z.object({ leadId: z.number() })).query(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      const c = await carteira.carteiraDoLead(input.leadId);
      if (!c || ctx.user.role === "admin") return c;
      // Parceiro nao ve quem sao os outros parceiros: eventos de terceiros aparecem como "Primetax".
      const eu = parseLocalOpenId(ctx.user.openId);
      return {
        ...c,
        eventos: c.eventos.map(e => ({
          ...e,
          deResponsavelId: null,
          paraResponsavelId: null,
          usuarioNome: e.usuarioId === eu ? e.usuarioNome : "Primetax",
        })),
      };
    }),

    devolver: protectedProcedure.input(z.object({ leadId: z.number(), motivo: z.string().max(300).optional() })).mutation(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      return carteira.devolver(input.leadId, atorDe(ctx.user), input.motivo?.trim() || null);
    }),

    arquivar: protectedProcedure.input(z.object({
      leadId: z.number(),
      motivo: z.enum(Object.keys(MOTIVOS_ARQUIVAMENTO) as [keyof typeof MOTIVOS_ARQUIVAMENTO, ...(keyof typeof MOTIVOS_ARQUIVAMENTO)[]]),
      detalhe: z.string().max(300).optional(),
    })).mutation(async ({ input, ctx }) => {
      await exigirAcessoLead(ctx.user, input.leadId);
      const detalhe = input.detalhe?.trim() || null;
      if (input.motivo === "outro" && !detalhe) throw new TRPCError({ code: "BAD_REQUEST", message: "Descreva o motivo do arquivamento" });
      await carteira.arquivar(input.leadId, input.motivo, detalhe, atorDe(ctx.user));
      return { success: true };
    }),

    reabrir: adminProcedure.input(z.object({ leadId: z.number() })).mutation(async ({ input, ctx }) => {
      await carteira.reabrir(input.leadId, atorDe(ctx.user));
      return { success: true };
    }),

    transferir: adminProcedure.input(z.object({ leadId: z.number(), para: z.number().int().nullable() })).mutation(async ({ input, ctx }) => {
      if (input.para !== null) await exigirParceiroAtivo(input.para);
      return carteira.transferir(input.leadId, input.para, atorDe(ctx.user));
    }),
  }),

  localUsers: router({
    list: adminProcedure.query(async () => {
      const rows = await db.getAllLocalUsers();
      // activationPending: "nunca ativou" = passwordHash IS NULL (0/1 no MySQL -> boolean)
      return rows.map(({ activationPending, ...rest }) => ({
        ...rest,
        activationPending: Boolean(Number(activationPending)),
      }));
    }),
    // Cria o usuario sem senha e envia o convite de ativacao por e-mail.
    // Falha no envio nao desfaz a criacao: emailSent=false e o admin pode reenviar.
    create: adminProcedure.input(z.object({
      nome: z.string().min(2),
      email: emailInput,
      role: z.enum(["comercial", "admin"]).default("comercial"),
    })).mutation(async ({ input, ctx }) => {
      const existing = await db.getLocalUserByEmail(input.email);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email já cadastrado" });
      const id = await db.createLocalUser({
        nome: input.nome,
        email: input.email,
        role: input.role,
        passwordHash: null,
        active: 0,
        mustChangePassword: 1,
        createdBy: ctx.user.id,
      });
      const { token, expiry } = newActivationToken();
      await db.setActivationToken(id, token, expiry);
      const emailSent = await sendActivationEmail({
        to: input.email,
        nome: input.nome,
        activationLink: buildActivationLink(token),
      });
      return { id, success: true, emailSent };
    }),
    resendActivation: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const localUser = await db.getLocalUserById(input.id);
      if (!localUser) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
      // Conta que ja definiu senha nao pode ser "reativada" por link: reverteria uma desativacao
      if (localUser.passwordHash !== null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: 'Este usuário já ativou a conta. Use "Redefinir senha".' });
      }
      const { token, expiry } = newActivationToken();
      await db.setActivationToken(localUser.id, token, expiry);
      const emailSent = await sendActivationEmail({
        to: localUser.email,
        nome: localUser.nome,
        activationLink: buildActivationLink(token),
      });
      return { success: true, emailSent };
    }),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.deleteLocalUser(input.id);
      return { success: true };
    }),
    toggleActive: adminProcedure.input(z.object({
      id: z.number(),
      active: z.boolean(),
    })).mutation(async ({ input }) => {
      await db.toggleLocalUserActive(input.id, input.active);
      return { success: true };
    }),
    resetPassword: adminProcedure.input(z.object({
      id: z.number(),
      newPassword: z.string().min(6),
    })).mutation(async ({ input }) => {
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.hash(input.newPassword, 10);
      // Senha definida pelo admin e temporaria: forca a troca na proxima entrada
      await db.updateLocalUserPassword(input.id, hash, { mustChangePassword: 1 });
      return { success: true };
    }),
  }),

  // Local user login (email/password)
  localAuth: router({
    login: publicProcedure.input(z.object({
      email: emailInput,
      senha: z.string().min(1),
    })).mutation(async ({ input, ctx }) => {
      const bcrypt = await import("bcryptjs");
      const limiterKey = rateLimitKey(ctx.req.ip, input.email);
      checkRateLimit(limiterKey);
      const localUser = await db.getLocalUserByEmail(input.email);
      // Inexistente, inativa (active=0), sem senha (ativacao pendente) ou senha errada: mesma resposta,
      // e bcrypt.compare roda em todos os caminhos (verifyPassword usa hash dummy quando nao ha hash real)
      const valid = await verifyPassword(bcrypt, input.senha, localUser);
      if (!valid || !localUser) throw new TRPCError(LOGIN_ERROR);
      resetRateLimit(limiterKey);

      // Create or upsert into the main users table so the session system works
      const localOpenId = `local-${localUser.id}`;
      await db.upsertUser({
        openId: localOpenId,
        name: localUser.nome,
        email: localUser.email,
        loginMethod: "local",
        role: localUser.role,
        lastSignedIn: new Date(),
      });
      await db.updateLocalUserLastSignedIn(localUser.id);

      // Issue session cookie (same as OAuth flow)
      const { sdk: sdkInstance } = await import("./_core/sdk");
      const { COOKIE_NAME, ONE_YEAR_MS } = await import("@shared/const");
      const { getSessionCookieOptions } = await import("./_core/cookies");
      const sessionToken = await sdkInstance.createSessionToken(localOpenId, {
        name: localUser.nome,
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      return {
        success: true,
        mustChangePassword: localUser.mustChangePassword === 1,
        user: { id: localUser.id, nome: localUser.nome, email: localUser.email, role: localUser.role },
      };
    }),

    changePassword: publicProcedure.input(z.object({
      email: emailInput,
      currentPassword: z.string().min(1),
      newPassword: z.string().min(6),
    })).mutation(async ({ input, ctx }) => {
      const bcrypt = await import("bcryptjs");
      const limiterKey = rateLimitKey(ctx.req.ip, input.email);
      checkRateLimit(limiterKey);
      const localUser = await db.getLocalUserByEmail(input.email);
      // Mesma indistinguibilidade do login (endpoint publico)
      const valid = await verifyPassword(bcrypt, input.currentPassword, localUser);
      if (!valid || !localUser) throw new TRPCError(CHANGE_PASSWORD_ERROR);
      resetRateLimit(limiterKey);
      const newHash = await bcrypt.hash(input.newPassword, 10);
      // updateLocalUserPassword tambem zera mustChangePassword (primeiro acesso concluido)
      await db.updateLocalUserPassword(localUser.id, newHash);
      return { success: true };
    }),
  }),

  // Ativacao de conta por link (publico)
  activation: router({
    validate: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ input }) => {
      const localUser = await db.getLocalUserByActivationToken(input.token);
      // Token inexistente, expirado ou de conta ja ativada: mesma resposta, sem revelar qual
      if (
        !localUser ||
        localUser.passwordHash !== null ||
        !localUser.activationTokenExpiry ||
        localUser.activationTokenExpiry.getTime() < Date.now()
      ) {
        return { valid: false as const, email: null, nome: null };
      }
      return { valid: true as const, email: localUser.email, nome: localUser.nome };
    }),
    activate: publicProcedure.input(z.object({
      token: z.string().min(1),
      password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres"),
    })).mutation(async ({ input }) => {
      const bcrypt = await import("bcryptjs");
      const localUser = await db.getLocalUserByActivationToken(input.token);
      // Conta ja ativada com token antigo ainda vivo: mesmo erro de token inexistente (defesa em profundidade)
      if (!localUser || localUser.passwordHash !== null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Token de ativação inválido" });
      }
      if (!localUser.activationTokenExpiry || localUser.activationTokenExpiry.getTime() < Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Token expirado. Solicite um novo email de ativação ao administrador." });
      }
      const passwordHash = await bcrypt.hash(input.password, 10);
      await db.activateLocalUser(localUser.id, passwordHash);
      return { success: true };
    }),
  }),

  // Google Calendar OAuth flow
  googleCalendar: router({
    getAuthUrl: adminProcedure.query(async ({ ctx }) => {
      const clientId = ENV.googleCalendarClientId;
      console.log('[Google Calendar] getAuthUrl called, clientId present:', !!clientId, 'length:', clientId?.length);
      if (!clientId || !getPublicBaseUrl()) return { url: null, configured: false };

      // Redirect URI fixa em PUBLIC_BASE_URL (evita redirect_uri_mismatch atras do reverse proxy)
      const url = buildGoogleCalendarAuthUrl(clientId, getGoogleCalendarRedirectUri());
      return { url, configured: true };
    }),
    disconnect: adminProcedure.mutation(async () => {
      await db.setSetting("googleCalendarRefreshToken", "");
      await db.setSetting("googleCalendarEmail", "");
      return { success: true };
    }),
  }),
});

export type AppRouter = typeof appRouter;
