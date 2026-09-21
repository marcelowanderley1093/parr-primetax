import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import { checkRateLimit, rateLimitKey, resetRateLimit } from "./_core/rateLimit";
import { emailInput } from "./localUsersHelpers";
import { buildGoogleCalendarAuthUrl, getGoogleCalendarRedirectUri, getPublicBaseUrl } from "./googleCalendar";
import { sendActivationEmail } from "./_core/activationEmail";
import { randomBytes } from "node:crypto";

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

    // Protected: list all leads
    list: protectedProcedure.query(async () => {
      return db.getAllLeads();
    }),

    // Protected: get lead by id
    getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      return db.getLeadById(input.id);
    }),

    // Protected: update lead status
    updateStatus: protectedProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["novo_lead", "contato_inicial", "reuniao_agendada", "proposta_enviada"]),
    })).mutation(async ({ input, ctx }) => {
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
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      const cleanData: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) cleanData[key] = value || null;
      }
      return db.updateLead(id, cleanData as any);
    }),

    // Protected: delete lead
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.deleteLead(input.id);
      return { success: true };
    }),

    // Protected: get notes for a lead
    getNotes: protectedProcedure.input(z.object({ leadId: z.number() })).query(async ({ input }) => {
      return db.getLeadNotes(input.leadId);
    }),

    // Protected: add note to a lead
    addNote: protectedProcedure.input(z.object({
      leadId: z.number(),
      content: z.string().min(1),
    })).mutation(async ({ input, ctx }) => {
      return db.createLeadNote({
        leadId: input.leadId,
        userId: ctx.user.id,
        userName: ctx.user.name || "Admin",
        content: input.content,
      });
    }),

    // Protected: get status history for a lead
    getHistory: protectedProcedure.input(z.object({ leadId: z.number() })).query(async ({ input }) => {
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
          console.log("[Google Calendar] Create event response:", JSON.stringify(calData));
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
      })),
    })).mutation(async ({ input, ctx }) => {
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
      const count = await db.bulkCreateLeads(leadsToInsert, batchId);
      await db.updateImportBatchCount(batchId, count);
      return { success: true, imported: count, batchId };
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
    getCalendarEvents: protectedProcedure.query(async () => {
      try {
        const accessToken = await getCalendarAccessToken();
        if (!accessToken) return { connected: false, events: [] };

        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

        const calRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=100`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const calData = await calRes.json();

        const events = (calData.items || []).map((item: any) => ({
          id: item.id,
          title: item.summary || "Sem título",
          start: item.start?.dateTime || item.start?.date || "",
          end: item.end?.dateTime || item.end?.date || "",
          description: item.description || "",
        }));

        return { connected: true, events };
      } catch (e) {
        console.error("[Google Calendar] Error fetching events:", e);
        return { connected: false, events: [] };
      }
    }),
  }),

  // Local Users management (admin creates users with email/password)
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
      await db.updateLocalUserPassword(input.id, hash);
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
