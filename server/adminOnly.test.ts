import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../shared/const";

process.env.JWT_SECRET = "segredo-de-teste-admin-only-32-chars!";
process.env.PUBLIC_BASE_URL = "https://staging.exemplo.test";
process.env.GOOGLE_CALENDAR_CLIENT_ID = "123-abc.apps.googleusercontent.com";

// Banco em memoria: users (sessao) + local_users (papel efetivo) + site_settings
const users = new Map<string, any>();
const localUsers = new Map<number, any>();
const settings = new Map<string, string>();
const setSetting = vi.fn(async (key: string, value: string) => { settings.set(key, value); });

vi.mock("./db", () => ({
  getUserByOpenId: vi.fn(async (openId: string) => users.get(openId)),
  getLocalUserById: vi.fn(async (id: number) => localUsers.get(id)),
  upsertUser: vi.fn(async (u: any) => { users.set(u.openId, { ...(users.get(u.openId) ?? {}), ...u }); }),
  getAllSettings: vi.fn(async () => Object.fromEntries(settings)),
  setSetting: (...args: [string, string]) => setSetting(...args),
  getAllImportBatches: vi.fn(async () => []),
  deleteImportBatch: vi.fn(async () => 0),
  createImportBatch: vi.fn(async () => 1),
  bulkCreateLeads: vi.fn(async () => 0),
  updateImportBatchCount: vi.fn(async () => undefined),
}));

const { appRouter } = await import("./routers");
const { sdk } = await import("./_core/sdk");
const { createContext } = await import("./_core/context");

function seed(role: "admin" | "comercial") {
  users.set("local-1", { id: 1, openId: "local-1", name: "Pessoa", role, loginMethod: "local" });
  localUsers.set(1, { id: 1, role, active: 1, mustChangePassword: 0 });
}

/** Contexto como o app monta de verdade: cookie -> authenticateRequest -> ctx.user (papel efetivo). */
async function callerFromCookie() {
  const token = await sdk.createSessionToken("local-1", { name: "Pessoa" });
  const ctx = await createContext({
    req: { headers: { cookie: `${COOKIE_NAME}=${token}` }, ip: "1.1.1.1", protocol: "https" },
    res: {},
  } as any);
  return appRouter.createCaller(ctx);
}

beforeEach(() => {
  users.clear();
  localUsers.clear();
  settings.clear();
  setSetting.mockClear();
  settings.set("videoUrl", "https://video.exemplo.test/x");
  settings.set("googleCalendarRefreshToken", "token-que-nao-pode-vazar");
  settings.set("googleCalendarEmail", "agenda@primetax.com.br");
});

const ADMIN_ONLY: Array<[string, (c: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>]> = [
  ["settings.getAdmin", c => c.settings.getAdmin()],
  ["settings.update", c => c.settings.update({ key: "videoUrl", value: "https://v.test/y" })],
  ["leads.listImports", c => c.leads.listImports()],
  ["leads.deleteImport", c => c.leads.deleteImport({ batchId: 1 })],
  ["leads.importExcel", c => c.leads.importExcel({ leads: [] })],
  ["googleCalendar.getAuthUrl", c => c.googleCalendar.getAuthUrl()],
  ["googleCalendar.disconnect", c => c.googleCalendar.disconnect()],
];

describe("procedures restritas a admin", () => {
  for (const [name, call] of ADMIN_ONLY) {
    it(`${name}: comercial -> FORBIDDEN; admin -> passa`, async () => {
      seed("comercial");
      await expect(call(await callerFromCookie())).rejects.toMatchObject({ code: "FORBIDDEN" });
      seed("admin");
      await expect(call(await callerFromCookie())).resolves.toBeDefined();
    });
  }

  it("sem sessao -> UNAUTHORIZED/FORBIDDEN em todas", async () => {
    const c = appRouter.createCaller({ req: { headers: {} }, res: {}, user: null } as any);
    for (const [, call] of ADMIN_ONLY) {
      await expect(call(c)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

describe("settings.getAdmin / settings.update", () => {
  it("getAdmin nunca devolve o refresh token; expoe so videoUrl, googleCalendarConnected e googleCalendarEmail", async () => {
    seed("admin");
    const r = await (await callerFromCookie()).settings.getAdmin();
    expect(r).toEqual({
      videoUrl: "https://video.exemplo.test/x",
      googleCalendarConnected: true,
      googleCalendarEmail: "agenda@primetax.com.br",
    });
    expect(JSON.stringify(r)).not.toContain("token-que-nao-pode-vazar");
    expect(r).not.toHaveProperty("googleCalendarRefreshToken");
    settings.set("googleCalendarRefreshToken", "");
    expect((await (await callerFromCookie()).settings.getAdmin()).googleCalendarConnected).toBe(false);
  });

  it("update aceita so key=videoUrl; googleCalendarRefreshToken e recusado pelo zod", async () => {
    seed("admin");
    const c = await callerFromCookie();
    await expect(c.settings.update({ key: "videoUrl", value: "https://v.test/y" })).resolves.toEqual({ success: true });
    expect(setSetting).toHaveBeenCalledWith("videoUrl", "https://v.test/y");
    await expect(
      c.settings.update({ key: "googleCalendarRefreshToken", value: "x" } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(settings.get("googleCalendarRefreshToken")).toBe("token-que-nao-pode-vazar");
  });
});

describe("papel efetivo vem de local_users a cada requisicao (sem novo login)", () => {
  it("admin rebaixado para comercial em local_users recebe FORBIDDEN na requisicao seguinte", async () => {
    seed("admin");
    const admin = await callerFromCookie();
    await expect(admin.settings.getAdmin()).resolves.toBeDefined();
    // rebaixamento direto no banco; users.role continua 'admin' (so seria sincronizado no login)
    localUsers.set(1, { id: 1, role: "comercial", active: 1, mustChangePassword: 0 });
    const depois = await callerFromCookie();
    await expect(depois.settings.getAdmin()).rejects.toMatchObject({ code: "FORBIDDEN" });
    // e users.role foi sincronizado pela propria requisicao
    expect(users.get("local-1").role).toBe("comercial");
  });

  it("comercial promovido a admin em local_users passa na requisicao seguinte", async () => {
    seed("comercial");
    await expect((await callerFromCookie()).settings.getAdmin()).rejects.toMatchObject({ code: "FORBIDDEN" });
    localUsers.set(1, { id: 1, role: "admin", active: 1, mustChangePassword: 0 });
    await expect((await callerFromCookie()).settings.getAdmin()).resolves.toBeDefined();
    expect(users.get("local-1").role).toBe("admin");
  });
});
