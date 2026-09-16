import { beforeEach, describe, expect, it, vi } from "vitest";

// Verifica as queries do db.ts para local_users com um drizzle falso:
// - updateLocalUserPassword grava mustChangePassword = 0
// - getLocalUserByEmail compara LOWER(TRIM(email)) com o valor normalizado
process.env.DATABASE_URL = "mysql://fake";

const calls: { set?: any; where?: any } = {};
const fakeDb = {
  update: vi.fn(() => ({
    set: vi.fn((values: any) => { calls.set = values; return { where: vi.fn(async () => undefined) }; }),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((cond: any) => { calls.where = cond; return { limit: vi.fn(async () => []) }; }),
    })),
  })),
};
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => fakeDb }));

const db = await import("./db");

beforeEach(() => { calls.set = undefined; calls.where = undefined; });

describe("db.updateLocalUserPassword", () => {
  it("grava o novo hash e zera mustChangePassword", async () => {
    await db.updateLocalUserPassword(42, "hash-novo");
    expect(calls.set).toEqual({ passwordHash: "hash-novo", mustChangePassword: 0 });
  });
});

describe("db.getLocalUserByEmail", () => {
  it("compara LOWER(TRIM(email)) no banco com o input normalizado", async () => {
    await db.getLocalUserByEmail("  Marcelo@Primetax.com.br ");
    const chunks: any[] = calls.where.queryChunks;
    const text = chunks
      .filter(c => c && c.constructor?.name === "StringChunk")
      .map(c => (Array.isArray(c.value) ? c.value.join("") : String(c.value)))
      .join("");
    expect(text).toContain("LOWER(TRIM(");
    // parametros interpolados via sql`${...}` ficam como string crua nos chunks
    const params = chunks.filter(c => typeof c === "string");
    expect(params).toContain("marcelo@primetax.com.br");
  });
});

describe("db.updateLocalUserAdmin", () => {
  it("forca role admin, active e mustChangePassword conforme recebido", async () => {
    await db.updateLocalUserAdmin(7, { nome: "N", passwordHash: "h", role: "admin", active: 1, mustChangePassword: 1 });
    expect(calls.set).toEqual({ nome: "N", passwordHash: "h", role: "admin", active: 1, mustChangePassword: 1 });
  });
});
