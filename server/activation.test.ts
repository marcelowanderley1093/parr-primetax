import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

process.env.PUBLIC_BASE_URL = "https://staging.exemplo.test";
process.env.JWT_SECRET = "segredo-de-teste-ativacao-com-32-chars";

// Banco em memoria com o comportamento das funcoes de db.ts usadas pela ativacao
type Row = {
  id: number; nome: string; email: string; passwordHash: string | null;
  role: "comercial" | "admin"; active: number; mustChangePassword: number;
  activationToken: string | null; activationTokenExpiry: Date | null; createdBy: number | null;
};
const rows: Row[] = [];
let nextId = 1;
const users = new Map<string, any>();

vi.mock("./db", () => ({
  getUserByOpenId: vi.fn(async (openId: string) => users.get(openId)),
  updateLocalUserLastSignedIn: vi.fn(async () => undefined),
  upsertUser: vi.fn(async (u: any) => { users.set(u.openId, { ...(users.get(u.openId) ?? {}), ...u }); }),
  getLocalUserByEmail: vi.fn(async (email: string) => rows.find(r => r.email === email.trim().toLowerCase())),
  getLocalUserById: vi.fn(async (id: number) => rows.find(r => r.id === id)),
  // Imita o select de db.ts: 8 colunas + activationPending como 0/1 (passwordHash IS NULL), sem o hash
  getAllLocalUsers: vi.fn(async () =>
    rows.map(r => ({
      id: r.id, nome: r.nome, email: r.email, role: r.role, active: r.active,
      mustChangePassword: r.mustChangePassword, activationPending: r.passwordHash === null ? 1 : 0,
      createdAt: new Date(), lastSignedIn: null,
    }))
  ),
  createLocalUser: vi.fn(async (data: any) => {
    const row: Row = { id: nextId++, activationToken: null, activationTokenExpiry: null, ...data };
    rows.push(row);
    return row.id;
  }),
  setActivationToken: vi.fn(async (id: number, token: string, expiry: Date) => {
    const r = rows.find(x => x.id === id)!;
    r.activationToken = token;
    r.activationTokenExpiry = expiry;
  }),
  getLocalUserByActivationToken: vi.fn(async (token: string) => rows.find(r => r.activationToken === token)),
  activateLocalUser: vi.fn(async (id: number, passwordHash: string) => {
    const r = rows.find(x => x.id === id)!;
    r.passwordHash = passwordHash;
    r.active = 1;
    r.mustChangePassword = 0;
    r.activationToken = null;
    r.activationTokenExpiry = null;
  }),
}));

const sendActivationEmail = vi.fn();
vi.mock("./_core/activationEmail", () => ({
  sendActivationEmail: (...args: any[]) => sendActivationEmail(...args),
}));

const { appRouter } = await import("./routers");

const adminCtx = { req: { ip: "1.1.1.1", headers: {} }, res: {}, user: { id: 99, role: "admin", openId: "local-99", name: "Admin" } } as any;
const publicCtx = { req: { ip: "1.1.1.1", headers: {} }, res: {}, user: null } as any;
const asAdmin = () => appRouter.createCaller(adminCtx);
const asPublic = () => appRouter.createCaller(publicCtx);

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  rows.length = 0;
  nextId = 1;
  users.clear();
  sendActivationEmail.mockReset();
  sendActivationEmail.mockResolvedValue(true);
});

describe("localUsers.create (convite)", () => {
  it("usuario nasce active=0, sem senha, com token valido por ~7 dias e e-mail enviado", async () => {
    const before = Date.now();
    const r = await asAdmin().localUsers.create({ nome: "Ana Comercial", email: "Ana@Primetax.com.br", role: "comercial" });
    expect(r).toEqual({ id: 1, success: true, emailSent: true });
    const row = rows[0];
    expect(row.active).toBe(0);
    expect(row.passwordHash).toBeNull();
    expect(row.mustChangePassword).toBe(1);
    expect(row.role).toBe("comercial");
    expect(row.createdBy).toBe(99);
    expect(row.activationToken).toMatch(/^[0-9a-f]{64}$/);
    const ttl = row.activationTokenExpiry!.getTime() - before;
    expect(ttl).toBeGreaterThan(SEVEN_DAYS_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(SEVEN_DAYS_MS + 60_000);
    expect(sendActivationEmail).toHaveBeenCalledTimes(1);
    const params = sendActivationEmail.mock.calls[0][0];
    expect(params.to).toBe("ana@primetax.com.br");
    expect(params.nome).toBe("Ana Comercial");
    expect(params.activationLink).toBe(`https://staging.exemplo.test/ativar-conta?token=${row.activationToken}`);
  });

  it("e-mail falhando: usuario criado assim mesmo, emailSent=false", async () => {
    sendActivationEmail.mockResolvedValue(false);
    const r = await asAdmin().localUsers.create({ nome: "Bia", email: "bia@primetax.com.br" });
    expect(r).toEqual({ id: 1, success: true, emailSent: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].activationToken).not.toBeNull();
  });

  it("nao aceita senha no input e exige admin", async () => {
    await expect(
      asAdmin().localUsers.create({ nome: "X Y", email: "x@y.com", senha: "abcdef" } as any)
    ).resolves.toMatchObject({ success: true }); // campo extra e ignorado pelo zod, nao vira senha
    expect(rows[0].passwordHash).toBeNull();
    await expect(asPublic().localUsers.create({ nome: "X Y", email: "z@y.com" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resendActivation em conta sem hash gera novo token e novo envio", async () => {
    await asAdmin().localUsers.create({ nome: "Caio", email: "caio@primetax.com.br" });
    const first = rows[0].activationToken;
    sendActivationEmail.mockResolvedValue(false);
    const r = await asAdmin().localUsers.resendActivation({ id: 1 });
    expect(r).toEqual({ success: true, emailSent: false });
    expect(rows[0].activationToken).not.toBe(first);
    expect(sendActivationEmail).toHaveBeenCalledTimes(2);
    await expect(asAdmin().localUsers.resendActivation({ id: 42 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("resendActivation em conta com hash (ja ativou) -> BAD_REQUEST, sem novo token nem e-mail", async () => {
    await asAdmin().localUsers.create({ nome: "Dora", email: "dora@primetax.com.br" });
    rows[0].passwordHash = await bcrypt.hash("senha-ja-definida", 4);
    rows[0].active = 0; // desativada pelo admin depois de ativar
    const tokenBefore = rows[0].activationToken;
    sendActivationEmail.mockClear();
    await expect(asAdmin().localUsers.resendActivation({ id: 1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: 'Este usuário já ativou a conta. Use "Redefinir senha".',
    });
    expect(rows[0].activationToken).toBe(tokenBefore);
    expect(sendActivationEmail).not.toHaveBeenCalled();
  });
});

describe("localUsers.list x activationPending", () => {
  it("nenhum item traz passwordHash; pendente = hash nulo; desativada-com-hash nao e pendente", async () => {
    await asAdmin().localUsers.create({ nome: "Nunca Ativou", email: "nunca@primetax.com.br" });
    await asAdmin().localUsers.create({ nome: "Ativou e Foi Desligado", email: "desligado@primetax.com.br" });
    rows[1].passwordHash = await bcrypt.hash("senha", 4);
    rows[1].active = 0;
    await asAdmin().localUsers.create({ nome: "Ativo Normal", email: "ativo@primetax.com.br" });
    rows[2].passwordHash = await bcrypt.hash("senha", 4);
    rows[2].active = 1;

    const list = await asAdmin().localUsers.list();
    expect(list).toHaveLength(3);
    for (const item of list) {
      expect(item).not.toHaveProperty("passwordHash");
      expect(typeof item.activationPending).toBe("boolean");
    }
    const byEmail = Object.fromEntries(list.map(u => [u.email, u]));
    expect(byEmail["nunca@primetax.com.br"]).toMatchObject({ active: 0, activationPending: true });
    expect(byEmail["desligado@primetax.com.br"]).toMatchObject({ active: 0, activationPending: false });
    expect(byEmail["ativo@primetax.com.br"]).toMatchObject({ active: 1, activationPending: false });
  });
});

describe("activation.activate / validate", () => {
  async function seedInvited(expiryOffsetMs = SEVEN_DAYS_MS) {
    await asAdmin().localUsers.create({ nome: "Dani", email: "dani@primetax.com.br" });
    rows[0].activationTokenExpiry = new Date(Date.now() + expiryOffsetMs);
    return rows[0].activationToken!;
  }

  it("token inexistente -> NOT_FOUND", async () => {
    await expect(asPublic().activation.activate({ token: "nao-existe", password: "senha123" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("token expirado -> BAD_REQUEST com a mensagem de referencia", async () => {
    const token = await seedInvited(-1000);
    await expect(asPublic().activation.activate({ token, password: "senha123" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Token expirado. Solicite um novo email de ativação ao administrador.",
    });
    expect(rows[0].active).toBe(0);
  });

  it("senha curta -> rejeitada pelo zod antes de tocar o banco", async () => {
    const token = await seedInvited();
    await expect(asPublic().activation.activate({ token, password: "12345" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(rows[0].active).toBe(0);
  });

  it("token valido -> active=1, mustChangePassword=0, token/expiry nulos, hash bcrypt da senha", async () => {
    const token = await seedInvited();
    const r = await asPublic().activation.activate({ token, password: "senha-forte-1" });
    expect(r).toEqual({ success: true });
    const row = rows[0];
    expect(row.active).toBe(1);
    expect(row.mustChangePassword).toBe(0);
    expect(row.activationToken).toBeNull();
    expect(row.activationTokenExpiry).toBeNull();
    expect(row.passwordHash).not.toBeNull();
    expect(await bcrypt.compare("senha-forte-1", row.passwordHash!)).toBe(true);
  });

  it("token de conta que ja tem hash (token antigo vivo) -> mesmo erro de token invalido; validate -> valid:false", async () => {
    const token = await seedInvited();
    rows[0].passwordHash = await bcrypt.hash("ja-definida", 4);
    rows[0].active = 0; // desativada; um clique em reenviar nao existe mais, mas o token antigo continua no banco
    const inexistente = await asPublic().activation.activate({ token: "nao-existe", password: "senha123" }).catch(e => e);
    const jaAtiva = await asPublic().activation.activate({ token, password: "senha123" }).catch(e => e);
    expect(jaAtiva.code).toBe(inexistente.code);
    expect(jaAtiva.message).toBe(inexistente.message);
    expect(jaAtiva.code).toBe("NOT_FOUND");
    expect(rows[0].active).toBe(0);
    expect(await bcrypt.compare("ja-definida", rows[0].passwordHash!)).toBe(true);
    expect(await asPublic().activation.validate({ token })).toEqual({ valid: false, email: null, nome: null });
  });

  it("recem-ativado: login emite cookie e authenticateRequest ACEITA (mustChangePassword=0 pos-ativacao)", async () => {
    const token = await seedInvited();
    await asPublic().activation.activate({ token, password: "senha-forte-1" });
    expect(rows[0]).toMatchObject({ active: 1, mustChangePassword: 0 });
    const cookies: Record<string, string> = {};
    const ctx = { req: { ip: "1.1.1.1", headers: {}, protocol: "https" }, res: { cookie: (n: string, v: string) => { cookies[n] = v; } }, user: null } as any;
    const login = await appRouter.createCaller(ctx).localAuth.login({ email: "dani@primetax.com.br", senha: "senha-forte-1" });
    expect(login.mustChangePassword).toBe(false);
    const { sdk } = await import("./_core/sdk");
    const { COOKIE_NAME } = await import("../shared/const");
    const req = { headers: { cookie: `${COOKIE_NAME}=${cookies[COOKIE_NAME]}` } } as any;
    await expect(sdk.authenticateRequest(req)).resolves.toMatchObject({ openId: "local-1", role: "comercial" });
  });

  it("reuso do mesmo token depois da ativacao falha", async () => {
    const token = await seedInvited();
    await asPublic().activation.activate({ token, password: "senha-forte-1" });
    await expect(asPublic().activation.activate({ token, password: "outra-senha" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await bcrypt.compare("senha-forte-1", rows[0].passwordHash!)).toBe(true);
  });

  it("validate: token valido devolve email e nome; expirado ou inexistente devolve tudo nulo", async () => {
    const token = await seedInvited();
    expect(await asPublic().activation.validate({ token })).toEqual({ valid: true, email: "dani@primetax.com.br", nome: "Dani" });
    rows[0].activationTokenExpiry = new Date(Date.now() - 1);
    expect(await asPublic().activation.validate({ token })).toEqual({ valid: false, email: null, nome: null });
    expect(await asPublic().activation.validate({ token: "inexistente" })).toEqual({ valid: false, email: null, nome: null });
  });
});
