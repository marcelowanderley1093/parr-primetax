import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "./_core/context";
import { descreverFiltro, limparFiltro, parseCnaeDivisoes, planoRedistribuicao, usaEmpresa, type GrupoNaCarteira } from "../shared/carteira";

// Banco simulado: lead 1 e do parceiro 10; lead 2 do parceiro 20. Parceiros ativos: 10 e 20.
const DONOS: Record<number, number | null> = { 1: 10, 2: 20 };
vi.mock("./db", async importOriginal => {
  const real = await importOriginal<typeof import("./db")>();
  return { ...real, getResponsavelDoLead: vi.fn(async (id: number) => (id in DONOS ? { responsavelId: DONOS[id] } : undefined)) };
});
vi.mock("./carteira", async importOriginal => {
  const real = await importOriginal<typeof import("./carteira")>();
  return {
    ...real,
    ehParceiroAtivo: vi.fn(async (id: number) => id === 10 || id === 20),
    atribuir: vi.fn(async () => ({ grupos: 1, leads: 2 })),
    devolver: vi.fn(async () => ({ leads: 2 })),
    arquivar: vi.fn(async () => undefined),
    reabrir: vi.fn(async () => undefined),
    transferir: vi.fn(async () => ({ leads: 2 })),
    parceiros: vi.fn(async () => []),
    // Filtro salvo: parceiro 10 tem (com chave vazia, que a rota normaliza); parceiro 20 nao tem.
    getFiltroSalvo: vi.fn(async (id: number) => (id === 10 ? { ufs: ["SP"], tamanhoGrupos: 50, situacoes: [] } : null)),
    previaRedistribuicao: vi.fn(async () => ({ saemGrupos: 1, saemLeads: 2, ficamGrupos: 49, tamanho: 50, entramGrupos: 1, entramLeads: 3 })),
    redistribuir: vi.fn(async () => ({ saiu: { grupos: 1, leads: 2 }, entrou: { grupos: 1, leads: 3 } })),
    historico: vi.fn(async () => [{ id: 1, acao: "filtro_salvo", filtros: { ufs: ["SP"] }, anterior: false }]),
    carteiraDoLead: vi.fn(async (leadId: number) => ({
      responsavelId: DONOS[leadId], responsavelNome: "Parceiro", atribuidoEm: null, arquivadoEm: null, arquivadoMotivo: null, grupoId: 5, leadsNoGrupo: 2,
      eventos: [
        { id: 1, leadId, tipo: "transferido", deResponsavelId: 20, paraResponsavelId: 10, motivo: null, usuarioId: 1, usuarioNome: "Admin Real", createdAt: new Date() },
        { id: 2, leadId, tipo: "arquivado", deResponsavelId: null, paraResponsavelId: null, motivo: "sem_interesse", usuarioId: 10, usuarioNome: "Eu Parceiro", createdAt: new Date() },
      ],
    })),
  };
});

const carteira = await import("./carteira");
const { appRouter } = await import("./routers");

function caller(role: "admin" | "comercial", localId = role === "admin" ? 1 : 10) {
  const user: NonNullable<TrpcContext["user"]> = {
    id: 99, openId: `local-${localId}`, email: "u@exemplo.test", name: role === "admin" ? "Admin" : "Eu Parceiro", loginMethod: "local",
    role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  };
  return appRouter.createCaller({ user, req: { protocol: "https", headers: {}, get: () => "x" } as any, res: { clearCookie: () => {} } as any });
}

beforeEach(() => vi.clearAllMocks());

describe("regras do filtro (shared/carteira)", () => {
  it("parseCnaeDivisoes pega 2 digitos de cada item, sem repetir", () => {
    expect(parseCnaeDivisoes("86, 47 ;8610  41-2")).toEqual(["86", "47", "41"]);
    expect(parseCnaeDivisoes("")).toEqual([]);
  });

  it("limparFiltro remove campos vazios; usaEmpresa so com criterio da EmpresAqui", () => {
    expect(limparFiltro({ situacoes: [], dividaMin: null, ufs: [], publicacaoDe: "", somentePrazoAberto: false })).toEqual({});
    expect(usaEmpresa({ publicacaoDe: "2026-01-01" })).toBe(false);
    expect(usaEmpresa({ dividaMin: 0 })).toBe(true);
  });
});

describe("redistribuicao: regras (planoRedistribuicao)", () => {
  const g = (x: Partial<GrupoNaCarteira> & { g: number }): GrupoNaCarteira => ({ leads: 1, ativos: 1, trabalhado: false, atende: true, ...x });

  it("sai so o grupo parado que nao atende mais ao filtro", () => {
    const p = planoRedistribuicao([
      g({ g: 1, atende: false }), // parado e fora do filtro: sai
      g({ g: 2, atende: false, trabalhado: true }), // trabalhado: fica mesmo fora do filtro
      g({ g: 3 }), // parado mas atende: fica
    ], 10);
    expect(p.saem.map(x => x.g)).toEqual([1]);
    expect(p.ficam).toBe(2);
    expect(p.vagas).toBe(8);
  });

  it("nada sai quando todos atendem ou estao trabalhados", () => {
    const p = planoRedistribuicao([g({ g: 1 }), g({ g: 2, atende: false, trabalhado: true })], 2);
    expect(p.saem).toEqual([]);
    expect(p.vagas).toBe(0);
  });

  it("sem tamanho salvo nada entra; carteira acima do tamanho nao recebe nem perde por isso", () => {
    expect(planoRedistribuicao([g({ g: 1 })], null).vagas).toBe(0);
    const acima = planoRedistribuicao([g({ g: 1 }), g({ g: 2 }), g({ g: 3 })], 2);
    expect(acima.vagas).toBe(0);
    expect(acima.saem).toEqual([]);
  });

  it("grupo so com arquivados nao ocupa vaga", () => {
    const p = planoRedistribuicao([g({ g: 1, ativos: 0, trabalhado: true }), g({ g: 2 })], 3);
    expect(p.ficam).toBe(1);
    expect(p.vagas).toBe(2);
  });

  it("limparFiltro guarda o tamanho so se for inteiro positivo", () => {
    expect(limparFiltro({ tamanhoGrupos: 500 })).toEqual({ tamanhoGrupos: 500 });
    expect(limparFiltro({ tamanhoGrupos: 0 })).toEqual({});
    expect(limparFiltro({ tamanhoGrupos: null })).toEqual({});
    expect(limparFiltro({ tamanhoGrupos: 1.5 })).toEqual({});
  });

  it("marca de trabalho (SQL) cobre coluna, arquivamento, reuniao, nota, historico e contato editado", () => {
    const r = new MySqlDialect().sqlToQuery(carteira.leadTrabalhado);
    expect(r.sql).toMatch(/`leads`\.`status` <> 'novo_lead'/);
    expect(r.sql).toMatch(/`leads`\.`arquivadoEm` IS NOT NULL/);
    expect(r.sql).toMatch(/`leads`\.`calendarEventId` IS NOT NULL/);
    expect(r.sql).toMatch(/FROM `lead_notes` WHERE `lead_notes`\.`leadId` = `leads`\.`id`/);
    // Historico: so movimentacao real conta; a linha de criacao (fromStatus nulo) nao segura o grupo.
    expect(r.sql).toMatch(/FROM `lead_status_history` WHERE `lead_status_history`\.`leadId` = `leads`\.`id` AND `lead_status_history`\.`fromStatus` IS NOT NULL\)/);
    expect(r.sql).not.toMatch(/`lead_status_history`\.`leadId` = `leads`\.`id`\)/);
    expect(r.sql).toMatch(/`lead_contatos`\.`atualizadoPorUserId` IS NOT NULL/);
  });
});

describe("historico: descreverFiltro", () => {
  it("criterios em portugues; regiao inteira vira o nome da regiao", () => {
    const d = descreverFiltro({
      situacoes: ["ATIVA"], dividaMin: 100000, ufs: ["PR", "RS", "SC", "MG"], cnaeDivisoes: ["86"],
      publicacaoDe: "2026-01-01", publicacaoAte: "2026-06-30", somentePrazoAberto: true, tamanhoGrupos: 1500,
    });
    expect(d[0]).toBe("Situação: ATIVA");
    expect(d[1]).toMatch(/^Dívida ≥ R\$\s?100\.000$/);
    expect(d.slice(2)).toEqual([
      "UF: Sul, MG", "CNAE: 86", "Publicação: 01/01/2026 a 30/06/2026", "Só prazo aberto", "Tamanho: 1.500 grupos",
    ]);
  });

  it("faixa de divida e datas abertas", () => {
    expect(descreverFiltro({ dividaMin: 10, dividaMax: 20 })[0]).toMatch(/^Dívida: R\$\s?10 a R\$\s?20$/);
    expect(descreverFiltro({ publicacaoAte: "2026-03-31" })).toEqual(["Publicação até 31/03/2026"]);
  });

  it("filtro vazio = Sem criterios", () => {
    expect(descreverFiltro({})).toEqual(["Sem critérios"]);
  });
});

describe("condicaoFiltro (SQL)", () => {
  const dialect = new MySqlDialect();
  const q = (f: Parameters<typeof carteira.condicaoFiltro>[0]) => {
    const c = carteira.condicaoFiltro(f, "2026-10-02");
    return c ? dialect.sqlToQuery(c) : undefined;
  };

  it("sem criterio -> sem condicao", () => {
    expect(q({})).toBeUndefined();
  });

  it("criterios da empresa exigem empresa vinculada; divida em centavos", () => {
    const r = q({ situacoes: ["ATIVA", "SUSPENSA"], dividaMin: 100000, dividaMax: 2500000.5, ufs: ["SP"], cnaeDivisoes: ["86"] })!;
    expect(r.sql).toMatch(/empresaId` IS NOT NULL/);
    expect(r.sql).toMatch(/LEFT\(/);
    expect(r.params).toEqual(["ATIVA", "SUSPENSA", 10000000, 250000050, "SP", "86"]);
  });

  it("incluir leads sem EmpresAqui vira OU empresaId nulo", () => {
    expect(q({ situacoes: ["ATIVA"], incluirSemEmpresa: true })!.sql).toMatch(/OR `leads`\.`empresaId` IS NULL/);
  });

  it("prazo aberto = publicacao nos ultimos 30 dias; periodo de publicacao", () => {
    expect(q({ somentePrazoAberto: true })!.params).toEqual(["2026-09-02"]);
    expect(q({ publicacaoDe: "2026-01-01", publicacaoAte: "2026-06-30" })!.params).toEqual(["2026-01-01", "2026-06-30"]);
  });
});

describe("rotas da carteira: permissoes", () => {
  it("parceiro nao distribui, nao transfere, nao reabre nem ve a lista de parceiros", async () => {
    const p = caller("comercial");
    await expect(p.carteira.parceiros()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.carteira.atribuir({ responsavelId: 10, filtro: {}, maxGrupos: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.carteira.transferir({ leadId: 1, para: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.carteira.reabrir({ leadId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.carteira.previa({ filtro: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("parceiro devolve e arquiva so o que e dele", async () => {
    const p = caller("comercial");
    await expect(p.carteira.devolver({ leadId: 1 })).resolves.toEqual({ leads: 2 });
    await expect(p.carteira.devolver({ leadId: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.carteira.arquivar({ leadId: 2, motivo: "sem_interesse" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.carteira.arquivar({ leadId: 1, motivo: "sem_interesse" })).resolves.toEqual({ success: true });
    expect(carteira.arquivar).toHaveBeenCalledWith(1, "sem_interesse", null, { localUserId: 10, nome: "Eu Parceiro" });
  });

  it("arquivar com motivo 'outro' exige descricao; motivo fora da lista e recusado", async () => {
    const p = caller("comercial");
    await expect(p.carteira.arquivar({ leadId: 1, motivo: "outro" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Descreva o motivo do arquivamento" });
    await expect(p.carteira.arquivar({ leadId: 1, motivo: "outro", detalhe: "mudou de ramo" })).resolves.toEqual({ success: true });
    await expect(p.carteira.arquivar({ leadId: 1, motivo: "qualquer" as any })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("admin so atribui/transfere para parceiro ativo; para = null devolve a fila", async () => {
    const a = caller("admin");
    await expect(a.carteira.atribuir({ responsavelId: 99, filtro: {}, maxGrupos: 10 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.carteira.atribuir({ responsavelId: 10, filtro: { ufs: ["SP"] }, maxGrupos: 10 })).resolves.toEqual({ grupos: 1, leads: 2 });
    await expect(a.carteira.transferir({ leadId: 1, para: 99 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.carteira.transferir({ leadId: 1, para: null })).resolves.toEqual({ leads: 2 });
  });

  it("filtro invalido e recusado (UF, CNAE, data, limite de grupos)", async () => {
    const a = caller("admin");
    await expect(a.carteira.previa({ filtro: { ufs: ["XX"] } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.carteira.previa({ filtro: { cnaeDivisoes: ["8"] } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.carteira.previa({ filtro: { publicacaoDe: "01/01/2026" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.carteira.atribuir({ responsavelId: 10, filtro: {}, maxGrupos: 20001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("redistribuicao: so admin; usa o filtro SALVO normalizado; sem filtro salvo ou parceiro inativo e recusado", async () => {
    const p = caller("comercial");
    await expect(p.carteira.previaRedistribuicao({ responsavelId: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.carteira.redistribuir({ responsavelId: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(carteira.redistribuir).not.toHaveBeenCalled();

    const a = caller("admin");
    await expect(a.carteira.previaRedistribuicao({ responsavelId: 10 })).resolves.toMatchObject({ saemGrupos: 1, entramLeads: 3 });
    await expect(a.carteira.redistribuir({ responsavelId: 10 })).resolves.toEqual({ saiu: { grupos: 1, leads: 2 }, entrou: { grupos: 1, leads: 3 } });
    expect(carteira.redistribuir).toHaveBeenCalledWith(10, { ufs: ["SP"], tamanhoGrupos: 50 }, expect.any(String), { localUserId: 1, nome: "Admin" });

    await expect(a.carteira.redistribuir({ responsavelId: 20 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Salve o filtro do parceiro antes de redistribuir" });
    await expect(a.carteira.previaRedistribuicao({ responsavelId: 20 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.carteira.redistribuir({ responsavelId: 99 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(carteira.redistribuir).toHaveBeenCalledTimes(1);
  });

  it("historico de criterios: so admin", async () => {
    await expect(caller("comercial").carteira.historico({ responsavelId: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(carteira.historico).not.toHaveBeenCalled();
    await expect(caller("admin").carteira.historico({ responsavelId: 10 })).resolves.toHaveLength(1);
    expect(carteira.historico).toHaveBeenCalledWith(10);
  });

  it("tamanho da carteira invalido e recusado ao salvar o filtro", async () => {
    const a = caller("admin");
    await expect(a.carteira.salvarFiltro({ responsavelId: 10, filtro: { tamanhoGrupos: 0 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.carteira.salvarFiltro({ responsavelId: 10, filtro: { tamanhoGrupos: 20001 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.carteira.salvarFiltro({ responsavelId: 10, filtro: { tamanhoGrupos: 2.5 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("historico: parceiro nao ve nomes nem ids de outros parceiros; admin ve tudo", async () => {
    const p = await caller("comercial").carteira.doLead({ leadId: 1 });
    expect(p!.eventos.map(e => e.usuarioNome)).toEqual(["Primetax", "Eu Parceiro"]);
    expect(p!.eventos.every(e => e.deResponsavelId === null && e.paraResponsavelId === null)).toBe(true);
    const a = await caller("admin").carteira.doLead({ leadId: 1 });
    expect(a!.eventos[0]).toMatchObject({ usuarioNome: "Admin Real", deResponsavelId: 20 });
  });
});
