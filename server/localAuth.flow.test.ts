import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { clearRateLimits, RATE_LIMIT_MAX_ATTEMPTS } from "./_core/rateLimit";

process.env.JWT_SECRET = "segredo-de-teste-fluxo-login";

// Banco em memoria que imita o comportamento do db.ts relevante para o fluxo:
// getLocalUserByEmail compara LOWER(TRIM()), updateLocalUserPassword zera mustChangePassword.
type LocalUserRow = {
  id: number; nome: string; email: string; passwordHash: string;
  role: "user" | "admin"; active: number; mustChangePassword: number;
};
const localUsers: LocalUserRow[] = [];
const users = new Map<string, any>();

vi.mock("./db", () => ({
  getLocalUserByEmail: vi.fn(async (email: string) => {
    const n = email.trim().toLowerCase();
    return localUsers.find(u => u.email.trim().toLowerCase() === n);
  }),
  getLocalUserById: vi.fn(async (id: number) => localUsers.find(u => u.id === id)),
  updateLocalUserPassword: vi.fn(async (id: number, passwordHash: string) => {
    const u = localUsers.find(x => x.id === id)!;
    u.passwordHash = passwordHash;
    u.mustChangePassword = 0;
  }),
  updateLocalUserLastSignedIn: vi.fn(async () => undefined),
  upsertUser: vi.fn(async (u: any) => { users.set(u.openId, { ...(users.get(u.openId) ?? {}), ...u }); }),
  getUserByOpenId: vi.fn(async (openId: string) => users.get(openId)),
}));

const { appRouter } = await import("./routers");

function makeCaller(ip = "10.0.0.1") {
  const cookies: Record<string, unknown> = {};
  const ctx = {
    req: { ip, headers: {}, protocol: "https" },
    res: { cookie: vi.fn((name: string, value: string) => { cookies[name] = value; }), clearCookie: vi.fn() },
    user: null,
  } as any;
  return { caller: appRouter.createCaller(ctx), cookies };
}

beforeEach(async () => {
  localUsers.length = 0;
  users.clear();
  clearRateLimits();
  localUsers.push({
    id: 1,
    nome: "Marcelo",
    // e-mail legado com maiusculas e espaco, como pode existir no banco da Manus
    email: "  Marcelo@Primetax.com.br ",
    passwordHash: await bcrypt.hash("senha-temporaria", 4),
    role: "admin",
    active: 1,
    mustChangePassword: 1,
  });
});

describe("fluxo de primeiro acesso", () => {
  it("login -> mustChangePassword=true; changePassword -> login -> mustChangePassword=false", async () => {
    const { caller, cookies } = makeCaller();

    const first = await caller.localAuth.login({ email: "marcelo@primetax.com.br", senha: "senha-temporaria" });
    expect(first.mustChangePassword).toBe(true);
    expect(first.user.role).toBe("admin");
    expect(cookies.app_session_id).toBeTypeOf("string");
    // admin de local_users virou admin em `users`
    expect(users.get("local-1").role).toBe("admin");

    const changed = await caller.localAuth.changePassword({
      email: "marcelo@primetax.com.br",
      currentPassword: "senha-temporaria",
      newPassword: "nova-senha-123",
    });
    expect(changed.success).toBe(true);
    expect(localUsers[0].mustChangePassword).toBe(0);

    const second = await caller.localAuth.login({ email: "marcelo@primetax.com.br", senha: "nova-senha-123" });
    expect(second.mustChangePassword).toBe(false);

    await expect(
      caller.localAuth.login({ email: "marcelo@primetax.com.br", senha: "senha-temporaria" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("aceita e-mail digitado com maiusculas/espacos (normaliza input e compara LOWER(TRIM) no banco)", async () => {
    const { caller } = makeCaller();
    const r = await caller.localAuth.login({ email: "  MARCELO@primetax.COM.BR ", senha: "senha-temporaria" });
    expect(r.success).toBe(true);
  });

  it("changePassword recusa usuario desativado", async () => {
    localUsers[0].active = 0;
    const { caller } = makeCaller();
    await expect(
      caller.localAuth.changePassword({ email: "marcelo@primetax.com.br", currentPassword: "senha-temporaria", newPassword: "nova-senha-123" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("rate limit (IP + e-mail)", () => {
  it("login: a 6a tentativa no mesmo IP+e-mail e recusada com TOO_MANY_REQUESTS", async () => {
    const { caller } = makeCaller("203.0.113.9");
    for (let i = 0; i < RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await expect(
        caller.localAuth.login({ email: "marcelo@primetax.com.br", senha: "errada" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    // 6a tentativa: mesmo com a senha certa, bloqueada
    await expect(
      caller.localAuth.login({ email: "marcelo@primetax.com.br", senha: "senha-temporaria" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("changePassword: a 6a tentativa e recusada com TOO_MANY_REQUESTS", async () => {
    const { caller } = makeCaller("203.0.113.9");
    for (let i = 0; i < RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await expect(
        caller.localAuth.changePassword({ email: "marcelo@primetax.com.br", currentPassword: "errada", newPassword: "nova-senha-123" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    await expect(
      caller.localAuth.changePassword({ email: "marcelo@primetax.com.br", currentPassword: "senha-temporaria", newPassword: "nova-senha-123" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("outro IP com o mesmo e-mail nao e bloqueado; sucesso zera o contador", async () => {
    const a = makeCaller("203.0.113.9");
    for (let i = 0; i < RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await expect(a.caller.localAuth.login({ email: "marcelo@primetax.com.br", senha: "errada" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    const b = makeCaller("198.51.100.4");
    const ok = await b.caller.localAuth.login({ email: "marcelo@primetax.com.br", senha: "senha-temporaria" });
    expect(ok.success).toBe(true);
    // apos sucesso, o IP b tem o contador zerado: 5 novas falhas ainda nao bloqueiam
    for (let i = 0; i < RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await expect(b.caller.localAuth.login({ email: "marcelo@primetax.com.br", senha: "errada" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });
});
