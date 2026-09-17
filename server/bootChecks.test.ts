import { describe, expect, it } from "vitest";
import { formatBootProblems, JWT_SECRET_MIN_LENGTH, validateBootEnv } from "./_core/bootChecks";

const SECRET_OK = "s".repeat(40);
const DB_URL = "mysql://usuario:senha-de-teste-xyz@127.0.0.1:3306/parr";
const BASE_URL = "https://parr.exemplo.test";

describe("validateBootEnv", () => {
  it("env completo -> sem problemas", () => {
    expect(validateBootEnv({ DATABASE_URL: DB_URL, JWT_SECRET: SECRET_OK, PUBLIC_BASE_URL: BASE_URL })).toEqual([]);
  });

  it("sem DATABASE_URL -> aponta DATABASE_URL", () => {
    const problems = validateBootEnv({ JWT_SECRET: SECRET_OK, PUBLIC_BASE_URL: BASE_URL });
    expect(problems.map(p => p.variable)).toEqual(["DATABASE_URL"]);
    expect(validateBootEnv({ DATABASE_URL: "   ", JWT_SECRET: SECRET_OK, PUBLIC_BASE_URL: BASE_URL }).map(p => p.variable)).toEqual(["DATABASE_URL"]);
  });

  it("JWT_SECRET vazio ou ausente -> aponta JWT_SECRET", () => {
    expect(validateBootEnv({ DATABASE_URL: DB_URL, JWT_SECRET: "", PUBLIC_BASE_URL: BASE_URL }).map(p => p.variable)).toEqual(["JWT_SECRET"]);
    expect(validateBootEnv({ DATABASE_URL: DB_URL, PUBLIC_BASE_URL: BASE_URL }).map(p => p.variable)).toEqual(["JWT_SECRET"]);
  });

  it("JWT_SECRET com 31 caracteres -> curto; com 32 -> ok", () => {
    const short = validateBootEnv({ DATABASE_URL: DB_URL, JWT_SECRET: "x".repeat(31), PUBLIC_BASE_URL: BASE_URL });
    expect(short).toHaveLength(1);
    expect(short[0].variable).toBe("JWT_SECRET");
    expect(short[0].problem).toContain(String(JWT_SECRET_MIN_LENGTH));
    expect(validateBootEnv({ DATABASE_URL: DB_URL, JWT_SECRET: "x".repeat(32), PUBLIC_BASE_URL: BASE_URL })).toEqual([]);
  });

  it("todas ausentes -> tres problemas", () => {
    expect(validateBootEnv({}).map(p => p.variable)).toEqual(["DATABASE_URL", "JWT_SECRET", "PUBLIC_BASE_URL"]);
  });

  it("PUBLIC_BASE_URL ausente, vazia ou sem esquema http(s) -> aponta PUBLIC_BASE_URL", () => {
    expect(validateBootEnv({ DATABASE_URL: DB_URL, JWT_SECRET: SECRET_OK }).map(p => p.variable)).toEqual(["PUBLIC_BASE_URL"]);
    expect(validateBootEnv({ DATABASE_URL: DB_URL, JWT_SECRET: SECRET_OK, PUBLIC_BASE_URL: " " }).map(p => p.variable)).toEqual(["PUBLIC_BASE_URL"]);
    expect(validateBootEnv({ DATABASE_URL: DB_URL, JWT_SECRET: SECRET_OK, PUBLIC_BASE_URL: "parr.exemplo.test" }).map(p => p.variable)).toEqual(["PUBLIC_BASE_URL"]);
    expect(validateBootEnv({ DATABASE_URL: DB_URL, JWT_SECRET: SECRET_OK, PUBLIC_BASE_URL: "http://localhost:3000" })).toEqual([]);
  });

  it("mensagens nunca contem o valor do segredo nem da URL", () => {
    const secret = "segredo-curto-nao-vazar";
    const url = "mysql://root:senha-super-secreta@db.interno:3306/parr";
    const problems = validateBootEnv({ DATABASE_URL: url, JWT_SECRET: secret, PUBLIC_BASE_URL: BASE_URL });
    const text = formatBootProblems(problems) + JSON.stringify(problems);
    expect(problems).toHaveLength(1);
    expect(text).not.toContain(secret);
    expect(text).not.toContain("senha-super-secreta");
    expect(text).toContain("JWT_SECRET");
  });
});
