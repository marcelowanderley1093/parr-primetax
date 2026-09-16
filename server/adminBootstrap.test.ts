import { describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { ensureAdmin, generateTemporaryPassword, type AdminBootstrapDeps } from "./adminBootstrap";

function makeDeps(existing?: { id: number }) {
  const deps: AdminBootstrapDeps & { created: any[]; updated: any[] } = {
    created: [],
    updated: [],
    getLocalUserByEmail: vi.fn(async () => existing),
    createLocalUser: vi.fn(async (data: any) => { deps.created.push(data); return 11; }),
    updateLocalUserAdmin: vi.fn(async (id: number, data: any) => { deps.updated.push({ id, ...data }); }),
  };
  return deps;
}

describe("generateTemporaryPassword", () => {
  it("gera >= 16 caracteres e valores distintos", () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
  });
});

describe("ensureAdmin", () => {
  it("cria admin quando o e-mail nao existe (role admin, active 1, mustChangePassword 1)", async () => {
    const deps = makeDeps(undefined);
    const r = await ensureAdmin(deps, { email: "  Marcelo@Primetax.com.br ", nome: " Marcelo " });
    expect(r).toMatchObject({ id: 11, email: "marcelo@primetax.com.br", created: true });
    expect(r.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect(deps.created[0]).toMatchObject({ email: "marcelo@primetax.com.br", nome: "Marcelo", role: "admin", active: 1, mustChangePassword: 1, createdBy: null });
    expect(await bcrypt.compare(r.temporaryPassword, deps.created[0].passwordHash)).toBe(true);
    expect(deps.updated).toHaveLength(0);
  });

  it("quando existe: reseta senha temporaria e forca admin/active/mustChangePassword (idempotente)", async () => {
    const deps = makeDeps({ id: 3 });
    const r = await ensureAdmin(deps, { email: "marcelo@primetax.com.br", nome: "Marcelo" });
    expect(r).toMatchObject({ id: 3, created: false });
    expect(deps.created).toHaveLength(0);
    expect(deps.updated[0]).toMatchObject({ id: 3, role: "admin", active: 1, mustChangePassword: 1 });
    expect(await bcrypt.compare(r.temporaryPassword, deps.updated[0].passwordHash)).toBe(true);
  });

  it("rejeita e-mail invalido e nome curto", async () => {
    await expect(ensureAdmin(makeDeps(), { email: "sem-arroba", nome: "Marcelo" })).rejects.toThrow(/ADMIN_EMAIL/);
    await expect(ensureAdmin(makeDeps(), { email: "a@b.c", nome: "M" })).rejects.toThrow(/ADMIN_NOME/);
  });
});
