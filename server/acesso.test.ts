import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";

// Banco simulado: lead 1 e do parceiro local 10; lead 2 e do parceiro local 20; lead 3 sem dono.
const DONOS: Record<number, number | null> = { 1: 10, 2: 20, 3: null };
vi.mock("./db", async importOriginal => {
  const real = await importOriginal<typeof import("./db")>();
  return {
    ...real,
    getResponsavelDoLead: vi.fn(async (id: number) => (id in DONOS ? { responsavelId: DONOS[id] } : undefined)),
    getLeadById: vi.fn(async (id: number) => (id in DONOS ? { id, responsavelId: DONOS[id], calendarEventId: id === 1 ? "evt-1" : null } : undefined)),
    getLeadNotes: vi.fn(async () => []),
    deleteLead: vi.fn(async () => undefined),
    listarColuna: vi.fn(async () => ({ itens: [], total: 0 })),
    contarPorStatus: vi.fn(async () => ({ novo_lead: 0, contato_inicial: 0, reuniao_agendada: 0, proposta_enviada: 0 })),
    getCalendarEventIdsDoResponsavel: vi.fn(async () => new Set(["evt-1"])),
  };
});

const db = await import("./db");
const { appRouter } = await import("./routers");
const { exigirAcessoLead, podeAcessar, responsavelDoEscopo } = await import("./acesso");
const { formatarErro, MENSAGEM_ERRO_INTERNO } = await import("./_core/trpc");

type Role = "admin" | "comercial";
function usuario(role: Role, localId: number | null = role === "admin" ? 1 : 10): NonNullable<TrpcContext["user"]> {
  return {
    id: 99, openId: localId === null ? "oauth-x" : `local-${localId}`, email: "u@exemplo.test", name: "Teste", loginMethod: "local",
    role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  };
}
const caller = (role: Role, localId?: number | null) =>
  appRouter.createCaller({ user: usuario(role, localId), req: { protocol: "https", headers: {}, get: () => "x" } as any, res: { clearCookie: () => {} } as any });

beforeEach(() => vi.clearAllMocks());

describe("regras de escopo", () => {
  it("admin sem filtro; parceiro filtrado pelo proprio local_users.id; comercial sem conta local nao ve nada", () => {
    expect(responsavelDoEscopo(usuario("admin"))).toBeUndefined();
    expect(responsavelDoEscopo(usuario("comercial", 10))).toBe(10);
    expect(responsavelDoEscopo(usuario("comercial", null))).toBe(-1);
  });

  it("podeAcessar", () => {
    expect(podeAcessar(usuario("admin"), 20)).toBe(true);
    expect(podeAcessar(usuario("comercial", 10), 10)).toBe(true);
    expect(podeAcessar(usuario("comercial", 10), 20)).toBe(false);
    expect(podeAcessar(usuario("comercial", 10), null)).toBe(false); // lead sem dono: so admin
  });

  it("exigirAcessoLead: NOT_FOUND para lead de outro, sem dono ou inexistente (mesma mensagem)", async () => {
    await expect(exigirAcessoLead(usuario("comercial", 10), 1)).resolves.toBeUndefined();
    for (const id of [2, 3, 999]) {
      await expect(exigirAcessoLead(usuario("comercial", 10), id)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Lead não encontrado" });
    }
    await expect(exigirAcessoLead(usuario("admin"), 2)).resolves.toBeUndefined();
  });
});

describe("rotas com acesso por dono", () => {
  it("parceiro abre o proprio lead e nao abre o de outro parceiro", async () => {
    await expect(caller("comercial").leads.getById({ id: 1 })).resolves.toMatchObject({ id: 1 });
    await expect(caller("comercial").leads.getById({ id: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("comercial").leads.getNotes({ leadId: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("admin").leads.getById({ id: 2 })).resolves.toMatchObject({ id: 2 });
  });

  it("excluir lead: so admin", async () => {
    await expect(caller("comercial").leads.delete({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("admin").leads.delete({ id: 1 })).resolves.toEqual({ success: true });
  });

  it("Kanban: parceiro consulta so a propria carteira; admin sem filtro", async () => {
    await caller("comercial").leads.coluna({ status: "novo_lead" });
    expect(db.listarColuna).toHaveBeenLastCalledWith("novo_lead", undefined, 0, 50, 10);
    await caller("admin").leads.coluna({ status: "novo_lead" });
    expect(db.listarColuna).toHaveBeenLastCalledWith("novo_lead", undefined, 0, 50, undefined);
    await caller("comercial").leads.contagem({});
    expect(db.contarPorStatus).toHaveBeenLastCalledWith(undefined, 10);
  });

  it("cancelar evento: o evento tem de ser o do proprio lead", async () => {
    await expect(caller("comercial").leads.cancelEvent({ leadId: 1, eventId: "evt-de-outro-lead" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("comercial").leads.cancelEvent({ leadId: 2, eventId: "evt-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("formatarErro", () => {
  const shape = { message: "Failed query: insert into leads values (FULANO, 11999999999)", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", stack: "..." } };

  it("erro interno: troca a mensagem (que pode ter SQL com dados pessoais) e remove o stack", () => {
    const out = formatarErro({ shape, error: new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: shape.message }) });
    expect(out.message).toBe(MENSAGEM_ERRO_INTERNO);
    expect(JSON.stringify(out)).not.toMatch(/FULANO|11999999999/);
    expect(out.data.stack).toBeUndefined();
  });

  it("erros de negocio continuam com a mensagem original", () => {
    const s = { ...shape, message: "Lead não encontrado", data: { code: "NOT_FOUND" } };
    expect(formatarErro({ shape: s, error: new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado" }) }).message).toBe("Lead não encontrado");
  });
});
