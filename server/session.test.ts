import { beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { COOKIE_NAME, SESSION_APP_ID } from "../shared/const";

// A sessão JWT é local: depende apenas de JWT_SECRET. Nenhuma variável da plataforma de origem
// (VITE_APP_ID, OAUTH_SERVER_URL, OWNER_OPEN_ID) pode influenciar o resultado.
process.env.JWT_SECRET = "segredo-de-teste-para-sessao-local";
delete process.env.VITE_APP_ID;
delete process.env.OAUTH_SERVER_URL;
delete process.env.OWNER_OPEN_ID;

const fakeUsers = new Map<string, any>();
const fakeLocalUsers = new Map<number, any>();
vi.mock("./db", () => ({
  getUserByOpenId: vi.fn(async (openId: string) => fakeUsers.get(openId)),
  getLocalUserById: vi.fn(async (id: number) => fakeLocalUsers.get(id)),
  upsertUser: vi.fn(async () => undefined),
}));

let sdk: typeof import("./_core/sdk").sdk;

beforeAll(async () => {
  sdk = (await import("./_core/sdk")).sdk;
});

function reqWithCookie(token: string) {
  return { headers: { cookie: `${COOKIE_NAME}=${token}` } } as any;
}

describe("sessão JWT local", () => {
  it("createSessionToken -> verifySession faz roundtrip sem VITE_APP_ID", async () => {
    const token = await sdk.createSessionToken("local-7", { name: "Marcelo" });
    const session = await sdk.verifySession(token);
    expect(session).toEqual({ openId: "local-7", appId: SESSION_APP_ID, name: "Marcelo" });
  });

  it("rejeita token assinado com appId diferente (sessão legada do OAuth externo)", async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const legacy = await new SignJWT({ openId: "oauth-user", appId: "ce79CANE", name: "X" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime("1h")
      .sign(secret);
    expect(await sdk.verifySession(legacy)).toBeNull();
  });

  it("rejeita token assinado com outro segredo", async () => {
    const other = new TextEncoder().encode("outro-segredo");
    const forged = await new SignJWT({ openId: "local-7", appId: SESSION_APP_ID, name: "X" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime("1h")
      .sign(other);
    expect(await sdk.verifySession(forged)).toBeNull();
  });

  it("authenticateRequest devolve o usuário de `users` quando existe", async () => {
    fakeUsers.set("local-7", { id: 7, openId: "local-7", name: "Marcelo", role: "admin" });
    fakeLocalUsers.set(7, { id: 7, active: 1, mustChangePassword: 0, role: "admin" });
    const token = await sdk.createSessionToken("local-7", { name: "Marcelo" });
    const user = await sdk.authenticateRequest(reqWithCookie(token));
    expect(user.openId).toBe("local-7");
    expect(user.role).toBe("admin");
  });

  it("authenticateRequest lança Forbidden quando o openId não existe em `users` (sem consultar OAuth)", async () => {
    const token = await sdk.createSessionToken("local-999", { name: "Ninguém" });
    await expect(sdk.authenticateRequest(reqWithCookie(token))).rejects.toThrow(/User not found/);
  });

  it("authenticateRequest lança Forbidden quando o local_user foi desativado (sessão ainda válida)", async () => {
    fakeUsers.set("local-8", { id: 8, openId: "local-8", name: "Ex", role: "user" });
    fakeLocalUsers.set(8, { id: 8, active: 0, mustChangePassword: 0, role: "user" });
    const token = await sdk.createSessionToken("local-8", { name: "Ex" });
    await expect(sdk.authenticateRequest(reqWithCookie(token))).rejects.toThrow(/User inactive/);
  });

  it("authenticateRequest lança Forbidden enquanto mustChangePassword = 1 (senha temporária)", async () => {
    fakeUsers.set("local-9", { id: 9, openId: "local-9", name: "Temp", role: "admin" });
    fakeLocalUsers.set(9, { id: 9, active: 1, mustChangePassword: 1, role: "admin" });
    const token = await sdk.createSessionToken("local-9", { name: "Temp" });
    await expect(sdk.authenticateRequest(reqWithCookie(token))).rejects.toThrow(/Password change required/);
    // mesma sessão passa a valer assim que a flag é zerada (changePassword)
    fakeLocalUsers.set(9, { id: 9, active: 1, mustChangePassword: 0, role: "admin" });
    await expect(sdk.authenticateRequest(reqWithCookie(token))).resolves.toMatchObject({ openId: "local-9" });
  });

  it("authenticateRequest lança Forbidden sem cookie", async () => {
    await expect(sdk.authenticateRequest({ headers: {} } as any)).rejects.toThrow(/Invalid session cookie/);
  });
});
