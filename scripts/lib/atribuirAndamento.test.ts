import { describe, expect, it } from "vitest";
import { planejarAtribuicao, ultimoAutorPorLead, type LeadAndamento, type LeadDoGrupo, type MudancaStatus } from "./atribuirAndamento";

// Dados 100% sinteticos.
const USUARIOS = [{ id: 10, nome: "Ana Comercial" }, { id: 20, nome: "Bruno Parceiro" }, { id: 30, nome: "Dup Nome" }, { id: 31, nome: "DUP  NOME" }];
let seq = 0;
const h = (leadId: number, userName: string | null, quando = "2026-09-01T10:00:00Z"): MudancaStatus => ({ leadId, userName, createdAt: quando, id: ++seq });
const lead = (id: number, grupoId: number | null, status = "contato_inicial", responsavelId: number | null = null): LeadAndamento => ({ id, status, grupoId, responsavelId });
const doGrupo = (l: LeadAndamento): LeadDoGrupo => ({ id: l.id, grupoId: l.grupoId, responsavelId: l.responsavelId });

describe("ultimoAutorPorLead", () => {
  it("pega a mudanca mais recente; 'Sistema' e importacao contam como sem autor", () => {
    const m = ultimoAutorPorLead([
      h(1, "Ana Comercial", "2026-09-01T10:00:00Z"), h(1, "Bruno Parceiro", "2026-09-02T10:00:00Z"),
      h(2, "Sistema"), h(3, "Importação Excel"),
    ]);
    expect(m.get(1)).toBe("Bruno Parceiro");
    expect(m.get(2)).toBeNull();
    expect(m.get(3)).toBeNull();
  });
});

describe("planejarAtribuicao", () => {
  it("atribui ao autor (nome sem acento/caixa) e leva o grupo inteiro junto", () => {
    const a = lead(1, 100);
    const outroDoGrupo = lead(2, 100, "novo_lead");
    const r = planejarAtribuicao([a, outroDoGrupo], [h(1, "ana  comercial")], USUARIOS, [a, outroDoGrupo].map(doGrupo));
    expect(r.atribuicoes).toEqual([{ leadId: 1, responsavelId: 10 }, { leadId: 2, responsavelId: 10 }]);
    expect(r.pendentes).toEqual([]);
  });

  it("lead sem grupo e atribuido sozinho; novo_lead sem andamento e ignorado", () => {
    const a = lead(1, null);
    const novo = lead(2, null, "novo_lead");
    const r = planejarAtribuicao([a, novo], [h(1, "Bruno Parceiro"), h(2, "Ana Comercial")], USUARIOS, []);
    expect(r.atribuicoes).toEqual([{ leadId: 1, responsavelId: 20 }]);
  });

  it("sem autor, autor desconhecido e autor ambiguo ficam pendentes", () => {
    const ls = [lead(1, null), lead(2, null), lead(3, null)];
    const r = planejarAtribuicao(ls, [h(2, "Fulano Que Saiu"), h(3, "Dup Nome")], USUARIOS, []);
    expect(r.atribuicoes).toEqual([]);
    expect(r.pendentes).toEqual([
      { leadId: 1, motivo: "sem_autor" }, { leadId: 2, motivo: "autor_desconhecido" }, { leadId: 3, motivo: "autor_ambiguo" },
    ]);
  });

  it("grupo movido por pessoas diferentes fica pendente inteiro (evita concorrencia)", () => {
    const a = lead(1, 100), b = lead(2, 100), c = lead(3, 100, "novo_lead");
    const r = planejarAtribuicao([a, b, c], [h(1, "Ana Comercial"), h(2, "Bruno Parceiro")], USUARIOS, [a, b, c].map(doGrupo));
    expect(r.atribuicoes).toEqual([]);
    expect(r.pendentes.map(p => p.motivo)).toEqual(["grupo_com_autores_diferentes", "grupo_com_autores_diferentes"]);
  });

  it("nunca altera lead que ja tem dono; grupo com dono diferente do proposto vira conflito", () => {
    const comDono = lead(1, 100, "contato_inicial", 20);
    const semDono = lead(2, 100);
    const r = planejarAtribuicao([comDono, semDono], [h(1, "Bruno Parceiro"), h(2, "Ana Comercial")], USUARIOS, [comDono, semDono].map(doGrupo));
    expect(r.atribuicoes).toEqual([]);
    expect(r.pendentes).toEqual([{ leadId: 2, motivo: "grupo_com_autores_diferentes" }]);
  });

  it("grupo com dono igual ao proposto completa os leads sem dono", () => {
    const comDono = lead(1, 100, "contato_inicial", 10);
    const semDono = lead(2, 100);
    const r = planejarAtribuicao([comDono, semDono], [h(2, "Ana Comercial")], USUARIOS, [comDono, semDono].map(doGrupo));
    expect(r.atribuicoes).toEqual([{ leadId: 2, responsavelId: 10 }]);
  });
});
