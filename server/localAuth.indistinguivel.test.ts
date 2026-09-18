import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRateLimits } from "./_core/rateLimit";

// bcryptjs real, mas com `compare` observavel (routers.ts chama pelo namespace do import dinamico)
const compareSpy = vi.fn();
vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  const compare: typeof actual.compare = (...args: any[]) => {
    compareSpy(...args);
    return (actual.compare as any)(...args);
  };
  return { ...actual, compare, default: { ...actual.default, compare } };
});
const bcrypt = (await import("bcryptjs")).default;

process.env.JWT_SECRET = "segredo-de-teste-indistinguibilidade-32c";

// Quatro caminhos de recusa devem ser indistinguiveis (codigo + mensagem):
// e-mail inexistente, senha errada, hash nulo (ativacao pendente), active=0 com hash valido.
type Row = {
  id: number; nome: string; email: string; passwordHash: string | null;
  role: "comercial" | "admin"; active: number; mustChangePassword: number;
};
const rows: Row[] = [];
const users = new Map<string, any>();

vi.mock("./db", () => ({
  getLocalUserByEmail: vi.fn(async (email: string) => rows.find(r => r.email === email.trim().toLowerCase())),
  getLocalUserById: vi.fn(async (id: number) => rows.find(r => r.id === id)),
  updateLocalUserPassword: vi.fn(async (id: number, passwordHash: string) => {
    const r = rows.find(x => x.id === id)!;
    r.passwordHash = passwordHash;
    r.mustChangePassword = 0;
  }),
  updateLocalUserLastSignedIn: vi.fn(async () => undefined),
  upsertUser: vi.fn(async (u: any) => { users.set(u.openId, { ...(users.get(u.openId) ?? {}), ...u }); }),
  getUserByOpenId: vi.fn(async (openId: string) => users.get(openId)),
}));

const { appRouter } = await import("./routers");

function caller(ip = "10.0.0.7") {
  const ctx = {
    req: { ip, headers: {}, protocol: "https" },
    res: { cookie: vi.fn(), clearCookie: vi.fn() },
    user: null,
  } as any;
  return appRouter.createCaller(ctx);
}

type Rejection = { code: string; message: string };
async function rejection(p: Promise<unknown>): Promise<Rejection> {
  try {
    await p;
    throw new Error("esperava rejeicao");
  } catch (e: any) {
    return { code: e.code, message: e.message };
  }
}

const SENHA_OK = "senha-correta-123";
let hashOk: string;

beforeEach(async () => {
  rows.length = 0;
  users.clear();
  clearRateLimits();
  hashOk = hashOk ?? (await bcrypt.hash(SENHA_OK, 4));
  rows.push(
    { id: 1, nome: "Ativa", email: "ativa@primetax.com.br", passwordHash: hashOk, role: "admin", active: 1, mustChangePassword: 0 },
    { id: 2, nome: "Pendente", email: "pendente@primetax.com.br", passwordHash: null, role: "comercial", active: 0, mustChangePassword: 1 },
    { id: 3, nome: "Desligada", email: "desligada@primetax.com.br", passwordHash: hashOk, role: "comercial", active: 0, mustChangePassword: 0 },
  );
});

describe("localAuth.login — recusas indistinguiveis", () => {
  it("inexistente, senha errada, hash nulo e active=0 devolvem o mesmo codigo e mensagem", async () => {
    const c = caller();
    const results = {
      inexistente: await rejection(c.localAuth.login({ email: "ninguem@primetax.com.br", senha: SENHA_OK })),
      senhaErrada: await rejection(c.localAuth.login({ email: "ativa@primetax.com.br", senha: "errada" })),
      hashNulo: await rejection(c.localAuth.login({ email: "pendente@primetax.com.br", senha: "qualquer" })),
      inativa: await rejection(c.localAuth.login({ email: "desligada@primetax.com.br", senha: SENHA_OK })),
    };
    const distinct = new Set(Object.values(results).map(r => `${r.code}|${r.message}`));
    expect(distinct.size).toBe(1);
    expect(results.senhaErrada).toEqual({ code: "UNAUTHORIZED", message: "Email ou senha inválidos" });
    // nenhuma das recusas cria sessao em `users`
    expect(users.size).toBe(0);
  });

  it("conta ativa com hash valido e senha correta -> sucesso (caminho feliz preservado)", async () => {
    const r = await caller().localAuth.login({ email: "ativa@primetax.com.br", senha: SENHA_OK });
    expect(r.success).toBe(true);
    expect(r.user.email).toBe("ativa@primetax.com.br");
    expect(users.get("local-1").role).toBe("admin");
  });

  it("mensagens antigas especificas nao existem mais", async () => {
    const c = caller();
    const inativa = await rejection(c.localAuth.login({ email: "desligada@primetax.com.br", senha: SENHA_OK }));
    expect(inativa.code).not.toBe("FORBIDDEN");
    expect(inativa.message).not.toMatch(/desativad/i);
  });
});

describe("localAuth.changePassword — recusas indistinguiveis", () => {
  const nova = "nova-senha-456";

  it("inexistente, inativa, hash nulo e senha atual errada devolvem o mesmo codigo e mensagem", async () => {
    const c = caller();
    const results = {
      inexistente: await rejection(c.localAuth.changePassword({ email: "ninguem@primetax.com.br", currentPassword: SENHA_OK, newPassword: nova })),
      inativa: await rejection(c.localAuth.changePassword({ email: "desligada@primetax.com.br", currentPassword: SENHA_OK, newPassword: nova })),
      hashNulo: await rejection(c.localAuth.changePassword({ email: "pendente@primetax.com.br", currentPassword: "qualquer", newPassword: nova })),
      senhaErrada: await rejection(c.localAuth.changePassword({ email: "ativa@primetax.com.br", currentPassword: "errada", newPassword: nova })),
    };
    const distinct = new Set(Object.values(results).map(r => `${r.code}|${r.message}`));
    expect(distinct.size).toBe(1);
    expect(results.senhaErrada).toEqual({ code: "UNAUTHORIZED", message: "Senha atual incorreta" });
    // nada foi gravado
    expect(rows[0].passwordHash).toBe(hashOk);
    expect(rows[1].passwordHash).toBeNull();
    expect(rows[2].passwordHash).toBe(hashOk);
  });

  it("hash nulo -> recusado mesmo com senha atual vazia-equivalente", async () => {
    await expect(
      caller().localAuth.changePassword({ email: "pendente@primetax.com.br", currentPassword: "x", newPassword: nova })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(rows[1].passwordHash).toBeNull();
  });

  it("caminho feliz: conta ativa com senha atual correta troca a senha", async () => {
    const r = await caller().localAuth.changePassword({ email: "ativa@primetax.com.br", currentPassword: SENHA_OK, newPassword: nova });
    expect(r).toEqual({ success: true });
    expect(await bcrypt.compare(nova, rows[0].passwordHash!)).toBe(true);
  });
});

describe("comparacao descartavel (oraculo de tempo)", () => {
  it("bcrypt.compare e executado tambem nos caminhos sem hash real (inexistente, hash nulo, inativa)", async () => {
    compareSpy.mockClear();
    const spy = compareSpy;
    const c = caller();
    await rejection(c.localAuth.login({ email: "ninguem@primetax.com.br", senha: SENHA_OK }));
    await rejection(c.localAuth.login({ email: "pendente@primetax.com.br", senha: SENHA_OK }));
    await rejection(c.localAuth.login({ email: "desligada@primetax.com.br", senha: SENHA_OK }));
    await rejection(c.localAuth.changePassword({ email: "ninguem@primetax.com.br", currentPassword: SENHA_OK, newPassword: "nova-senha-456" }));
    expect(spy).toHaveBeenCalledTimes(4);
    // todas contra um hash bcrypt de custo 10 (o dummy), nunca contra string vazia
    for (const call of spy.mock.calls) {
      expect(String(call[1])).toMatch(/^\$2[aby]\$10\$/);
    }
  });
});
