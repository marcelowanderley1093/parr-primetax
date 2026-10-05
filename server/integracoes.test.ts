import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

// Lead 1: parceiro 10, CNPJ valido. Lead 2: parceiro 20. Lead 3: parceiro 10, sem CNPJ.
const LEADS: Record<number, { id: number; responsavelId: number; cnpj: string | null }> = {
  1: { id: 1, responsavelId: 10, cnpj: "12.345.678/0001-95" },
  2: { id: 2, responsavelId: 20, cnpj: "11.222.333/0001-81" },
  3: { id: 3, responsavelId: 10, cnpj: null },
};
vi.mock("./db", async importOriginal => {
  const real = await importOriginal<typeof import("./db")>();
  return {
    ...real,
    getResponsavelDoLead: vi.fn(async (id: number) => (LEADS[id] ? { responsavelId: LEADS[id].responsavelId } : undefined)),
    getLeadById: vi.fn(async (id: number) => LEADS[id]),
  };
});
vi.mock("./empresaqui/sincronizacao", async importOriginal => {
  const real = await importOriginal<typeof import("./empresaqui/sincronizacao")>();
  return {
    ...real,
    sincronizarEmpresa: vi.fn(async () => ({ status: "ok", empresaId: 5, apiAtualizadoEm: new Date() })),
    getConfig: vi.fn(async () => ({ cacheDias: 30, tetoMensal: 500 })),
    consumoDoMes: vi.fn(async () => ({ total: 7, porResultado: { ok: 6, nao_encontrado: 1 } })),
    salvarConfig: vi.fn(async () => undefined),
  };
});

const sinc = await import("./empresaqui/sincronizacao");
const { appRouter } = await import("./routers");

function caller(role: "admin" | "comercial", localId = role === "admin" ? 1 : 10) {
  const user: NonNullable<TrpcContext["user"]> = {
    id: 77, openId: `local-${localId}`, email: "u@exemplo.test", name: "Teste", loginMethod: "local",
    role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  };
  return appRouter.createCaller({ user, req: { protocol: "https", headers: {}, get: () => "x" } as any, res: { clearCookie: () => {} } as any });
}

beforeEach(() => vi.clearAllMocks());

describe("empresas.sincronizar", () => {
  it("parceiro sincroniza lead da propria carteira (sem forcar, mesmo se pedir)", async () => {
    await expect(caller("comercial").empresas.sincronizar({ leadId: 1, forcar: true })).resolves.toMatchObject({ status: "ok" });
    expect(sinc.sincronizarEmpresa).toHaveBeenCalledWith("12345678000195", { userId: 77, forcar: false });
  });

  it("parceiro nao sincroniza lead de outro; lead sem CNPJ e recusado", async () => {
    await expect(caller("comercial").empresas.sincronizar({ leadId: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("comercial").empresas.sincronizar({ leadId: 3 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(sinc.sincronizarEmpresa).not.toHaveBeenCalled();
  });

  it("admin pode forcar (ignorar o cache)", async () => {
    await caller("admin").empresas.sincronizar({ leadId: 2, forcar: true });
    expect(sinc.sincronizarEmpresa).toHaveBeenCalledWith("11222333000181", { userId: 77, forcar: true });
  });

  it("sem token ou teto atingido -> PRECONDITION_FAILED com mensagem; erro da API vem com mensagem de tela", async () => {
    vi.mocked(sinc.sincronizarEmpresa).mockRejectedValueOnce(new sinc.TetoAtingidoError("Teto mensal de 500 consultas atingido."));
    await expect(caller("admin").empresas.sincronizar({ leadId: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: /Teto mensal/ });
    vi.mocked(sinc.sincronizarEmpresa).mockResolvedValueOnce({ status: "erro", codigo: "token_invalido" });
    await expect(caller("admin").empresas.sincronizar({ leadId: 1 })).resolves.toMatchObject({ status: "erro", mensagem: expect.stringMatching(/Token/) });
  });
});

describe("integracoes (so admin)", () => {
  it("parceiro nao ve nem altera a integracao", async () => {
    await expect(caller("comercial").integracoes.empresaqui()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("comercial").integracoes.salvarEmpresaqui({ cacheDias: 30, tetoMensal: 500 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("comercial").integracoes.testarEmpresaqui({ cnpj: "12345678000195" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("status nunca devolve o token, so se esta configurado", async () => {
    const r = await caller("admin").integracoes.empresaqui();
    expect(r).toEqual({ tokenConfigurado: expect.any(Boolean), cacheDias: 30, tetoMensal: 500, consumoMes: 7, consumoPorResultado: { ok: 6, nao_encontrado: 1 } });
  });

  it("valida limites da configuracao e o CNPJ do teste", async () => {
    await expect(caller("admin").integracoes.salvarEmpresaqui({ cacheDias: 0, tetoMensal: 500 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller("admin").integracoes.testarEmpresaqui({ cnpj: "12.345.678/0001-90" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller("admin").integracoes.testarEmpresaqui({ cnpj: "12.345.678/0001-95" });
    expect(sinc.sincronizarEmpresa).toHaveBeenCalledWith("12345678000195", { userId: 77, forcar: true });
  });
});
