import { describe, expect, it } from "vitest";
import {
  CABECALHO_CSV_EDITAIS, LayoutEditaisError, ImportEditaisAbort, chaveEdital, cnpjValido, dataIso, lerCsvEditais, linhaCsv,
  parseArgsEditais, parseLinhaCsv, planejarImportacao, type Existentes, type LeadExistente,
} from "./importEditais";

// Dados 100% sinteticos. CNPJs gerados com DV calculado a partir de bases ficticias.
function gerarCnpj(base12: string): string {
  const dv = (s: string) => {
    let soma = 0, peso = s.length - 7;
    for (const ch of s) { soma += Number(ch) * peso; peso = peso === 2 ? 9 : peso - 1; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12);
  const d2 = dv(base12 + d1);
  const d = `${base12}${d1}${d2}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
const EMP_A = gerarCnpj("111111110001");
const EMP_B = gerarCnpj("222222220001");
const EMP_C = gerarCnpj("033333330001"); // comeca com zero

type L = { ano?: string; ed?: string; data?: string; nome?: string; cpf?: string; dev?: string; cnpj?: string; proc: string; pag?: string };
function csv(linhas: L[]): string {
  const corpo = linhas.map(l =>
    linhaCsv([l.ano ?? "2025", l.ed ?? "100", l.data ?? "18/12/2025", l.nome ?? "FULANO DE TAL", l.cpf ?? "***.111.***-**",
      l.dev ?? "EMPRESA FICTICIA LTDA", l.cnpj ?? EMP_A, "", l.proc, "edital_100.pdf", l.pag ?? "4"]),
  );
  return [CABECALHO_CSV_EDITAIS.join(";"), ...corpo, ""].join("\n");
}
const vazio = (): Existentes => ({ leads: [], procedimentos: new Set(), editais: new Map(), maxGrupoId: 0 });
const plano = (linhas: L[], ex: Existentes = vazio()) => planejarImportacao(lerCsvEditais(csv(linhas)).linhas, ex);

describe("CSV", () => {
  it("linhaCsv e parseLinhaCsv fazem ida e volta com ; e aspas", () => {
    const v = ["A;B", 'disse "oi"', "simples", ""];
    expect(parseLinhaCsv(linhaCsv(v))).toEqual(v);
  });

  it("rejeita cabecalho diferente", () => {
    expect(() => lerCsvEditais("a;b;c\n1;2;3\n")).toThrow(LayoutEditaisError);
  });

  it("aceita BOM e CRLF", () => {
    const r = lerCsvEditais("﻿" + csv([{ proc: "1000000001" }]).replace(/\n/g, "\r\n"));
    expect(r.linhas).toHaveLength(1);
  });
});

describe("lerCsvEditais", () => {
  it("normaliza: data ISO, CNPJ 14 digitos (com zero a esquerda), procedimento so digitos", () => {
    const { linhas } = lerCsvEditais(csv([{ proc: "1029368797", cnpj: EMP_C.replace(/^0/, "") }]));
    expect(linhas[0]).toMatchObject({ ano: 2025, numeroEdital: "100", dataPublicacao: "2025-12-18", cnpj: EMP_C.replace(/\D/g, ""), numeroProcedimento: "1029368797", pagina: 4 });
  });

  it("aceita contribuinte pessoa juridica (CNPJ no lugar do CPF parcial)", () => {
    const { linhas } = lerCsvEditais(csv([{ proc: "1000000001", cpf: EMP_B }]));
    expect(linhas[0].cpfParcial).toBe(EMP_B);
  });

  it("descarta e conta cada tipo de linha invalida e procedimento repetido", () => {
    const r = lerCsvEditais(csv([
      { proc: "1000000001" },
      { proc: "1000000001" }, // repetido
      { proc: "1000000002", ano: "25" },
      { proc: "1000000003", data: "31/02/2025" },
      { proc: "1000000004", nome: "" },
      { proc: "1000000005", cpf: "" },
      { proc: "1000000006", cnpj: "11.111.111/0001-00" },
      { proc: "12" },
    ]));
    expect(r.linhas).toHaveLength(1);
    expect(r.lidas).toBe(8);
    expect(r.descartes).toEqual({
      procedimento_repetido_no_arquivo: 1, ano_invalido: 1, data_invalida: 1, nome_vazio: 1, cpf_parcial_vazio: 1, cnpj_invalido: 1, procedimento_invalido: 1,
    });
  });

  it("auxiliares de data e CNPJ", () => {
    expect(dataIso("01/02/2026")).toBe("2026-02-01");
    expect(dataIso("2026-02-01")).toBeNull();
    expect(cnpjValido(EMP_A.replace(/\D/g, ""))).toBe(true);
    expect(cnpjValido("11111111111111")).toBe(false);
  });
});

describe("planejarImportacao: leads e procedimentos", () => {
  it("mesma pessoa + empresa em dois editais = 1 lead com 2 procedimentos e datas min/max", () => {
    const p = plano([
      { proc: "1000000001", ed: "100", data: "18/12/2025" },
      { proc: "1000000002", ed: "200", data: "05/03/2026" },
    ]);
    expect(p.leadsNovos).toHaveLength(1);
    expect(p.leadsNovos[0]).toMatchObject({ primeiraPublicacao: "2025-12-18", ultimaPublicacao: "2026-03-05", cnpj: EMP_A });
    expect(p.procedimentosNovos).toHaveLength(2);
    expect(p.editaisNovos.map(e => e.numero).sort()).toEqual(["100", "200"]);
  });

  it("homonimos com CPF parcial diferente sao pessoas diferentes", () => {
    const p = plano([{ proc: "1000000001", cpf: "***.111.***-**" }, { proc: "1000000002", cpf: "***.999.***-**" }]);
    expect(p.leadsNovos).toHaveLength(2);
  });

  it("nome com acento/caixa diferente e a mesma pessoa", () => {
    const p = plano([{ proc: "1000000001", nome: "José da Silva" }, { proc: "1000000002", nome: "JOSE  DA SILVA" }]);
    expect(p.leadsNovos).toHaveLength(1);
  });

  it("edital e procedimento ja existentes nao sao recriados", () => {
    const ex = vazio();
    ex.editais = new Map([[chaveEdital(2025, "100"), 1]]);
    ex.procedimentos = new Set(["1000000001"]);
    const p = plano([{ proc: "1000000001" }, { proc: "1000000002" }], ex);
    expect(p.editaisNovos).toEqual([]);
    expect(p.procedimentosNovos.map(x => x.numeroProcedimento)).toEqual(["1000000002"]);
    expect(p.resumo.procedimentosJaNoBanco).toBe(1);
  });
});

describe("planejarImportacao: leads antigos (Manus)", () => {
  const antigo = (over: Partial<LeadExistente> = {}): LeadExistente => ({
    id: 7, nome: "Fulano de Tal", cnpj: EMP_A, cpfParcial: null, grupoId: null, primeiraPublicacao: null, ultimaPublicacao: null, devedorPrincipal: null, ...over,
  });

  it("casa por nome + CNPJ e atualiza so CPF parcial, datas, devedor e grupo (nao cria lead novo)", () => {
    const ex = vazio();
    ex.leads = [antigo()];
    const p = plano([{ proc: "1000000001" }], ex);
    expect(p.leadsNovos).toEqual([]);
    expect(p.leadsAtualizar).toEqual([
      { id: 7, cpfParcial: "***.111.***-**", primeiraPublicacao: "2025-12-18", ultimaPublicacao: "2025-12-18", devedorPrincipal: "EMPRESA FICTICIA LTDA", grupoId: 1 },
    ]);
    expect(p.procedimentosNovos[0].chaveLead).toBeDefined();
    expect(p.resumo.leadsCasadosPorNomeCnpj).toBe(1);
  });

  it("CNPJ do lead antigo sem zero a esquerda ainda casa", () => {
    const ex = vazio();
    ex.leads = [antigo({ cnpj: EMP_C.replace(/\D/g, "").replace(/^0/, "") })];
    const p = plano([{ proc: "1000000001", cnpj: EMP_C }], ex);
    expect(p.leadsNovos).toEqual([]);
  });

  it("nao sobrescreve devedor principal ja preenchido", () => {
    const ex = vazio();
    ex.leads = [antigo({ devedorPrincipal: "NOME ANTIGO" })];
    const p = plano([{ proc: "1000000001" }], ex);
    expect(p.leadsAtualizar[0].devedorPrincipal).toBe("NOME ANTIGO");
  });

  it("dois intimados homonimos na mesma empresa: so o primeiro casa com o lead antigo", () => {
    const ex = vazio();
    ex.leads = [antigo()];
    const p = plano([{ proc: "1000000001", cpf: "***.111.***-**" }, { proc: "1000000002", cpf: "***.222.***-**" }], ex);
    expect(p.leadsAtualizar).toHaveLength(1);
    expect(p.leadsNovos).toHaveLength(1);
  });
});

describe("planejarImportacao: grupos de distribuicao", () => {
  it("pessoa com duas empresas e empresa com dois intimados ficam no mesmo grupo; desconexos em grupos diferentes", () => {
    const p = plano([
      { proc: "1000000001", nome: "PESSOA UM", cpf: "***.111.***-**", cnpj: EMP_A },
      { proc: "1000000002", nome: "PESSOA UM", cpf: "***.111.***-**", cnpj: EMP_B }, // mesma pessoa, outra empresa
      { proc: "1000000003", nome: "PESSOA DOIS", cpf: "***.222.***-**", cnpj: EMP_B }, // mesma empresa, outra pessoa
      { proc: "1000000004", nome: "PESSOA TRES", cpf: "***.333.***-**", cnpj: EMP_C }, // isolada
    ]);
    const g = Object.fromEntries(p.leadsNovos.map(l => [`${l.nome}|${l.cnpj}`, l.grupoId]));
    expect(g[`PESSOA UM|${EMP_A}`]).toBe(g[`PESSOA UM|${EMP_B}`]);
    expect(g[`PESSOA DOIS|${EMP_B}`]).toBe(g[`PESSOA UM|${EMP_A}`]);
    expect(g[`PESSOA TRES|${EMP_C}`]).not.toBe(g[`PESSOA UM|${EMP_A}`]);
    expect(p.resumo).toMatchObject({ grupos: 2, gruposComMaisDeUmLead: 1, maiorGrupo: 3 });
  });

  it("reaproveita o grupo existente e, ao juntar dois grupos, fica com o menor id", () => {
    const ex = vazio();
    ex.maxGrupoId = 50;
    ex.leads = [
      { id: 1, nome: "PESSOA UM", cnpj: EMP_A, cpfParcial: "***.111.***-**", grupoId: 40, primeiraPublicacao: "2025-12-18", ultimaPublicacao: "2025-12-18", devedorPrincipal: "X" },
      { id: 2, nome: "PESSOA DOIS", cnpj: EMP_B, cpfParcial: "***.222.***-**", grupoId: 30, primeiraPublicacao: "2025-12-18", ultimaPublicacao: "2025-12-18", devedorPrincipal: "Y" },
    ];
    // edital novo liga PESSOA UM a EMP_B: os grupos 40 e 30 se juntam no 30
    const p = plano([{ proc: "1000000009", nome: "PESSOA UM", cpf: "***.111.***-**", cnpj: EMP_B, dev: "Y", data: "18/12/2025" }], ex);
    expect(p.leadsNovos).toHaveLength(1);
    expect(p.leadsNovos[0].grupoId).toBe(30);
    expect(p.leadsAtualizar).toEqual([expect.objectContaining({ id: 1, grupoId: 30 })]);
  });

  it("grupo novo comeca depois do maior grupo existente", () => {
    const ex = vazio();
    ex.maxGrupoId = 99;
    expect(plano([{ proc: "1000000001" }], ex).leadsNovos[0].grupoId).toBe(100);
  });
});

describe("idempotencia", () => {
  it("rodar de novo com o banco ja carregado produz plano vazio", () => {
    const linhas: L[] = [
      { proc: "1000000001", nome: "PESSOA UM", cnpj: EMP_A },
      { proc: "1000000002", nome: "PESSOA UM", cnpj: EMP_B, ed: "200", data: "05/03/2026" },
    ];
    const p1 = plano(linhas);
    let id = 0;
    const ex: Existentes = {
      leads: p1.leadsNovos.map(l => ({ id: ++id, nome: l.nome, cnpj: l.cnpj, cpfParcial: l.cpfParcial, grupoId: l.grupoId, primeiraPublicacao: l.primeiraPublicacao, ultimaPublicacao: l.ultimaPublicacao, devedorPrincipal: l.devedorPrincipal })),
      procedimentos: new Set(p1.procedimentosNovos.map(x => x.numeroProcedimento)),
      editais: new Map(p1.editaisNovos.map((e, i) => [chaveEdital(e.ano, e.numero), i + 1])),
      maxGrupoId: 1,
    };
    const p2 = plano(linhas, ex);
    expect([p2.editaisNovos.length, p2.leadsNovos.length, p2.leadsAtualizar.length, p2.procedimentosNovos.length]).toEqual([0, 0, 0, 0]);
  });
});

describe("parseArgsEditais", () => {
  it("exige arquivo e exatamente um modo", () => {
    expect(parseArgsEditais(["--file", "x.csv", "--dry-run"])).toEqual({ file: "x.csv", run: "dry-run" });
    expect(() => parseArgsEditais(["--dry-run"])).toThrow(ImportEditaisAbort);
    expect(() => parseArgsEditais(["--file", "x.csv"])).toThrow(ImportEditaisAbort);
    expect(() => parseArgsEditais(["--file", "x.csv", "--apply", "--force"])).toThrow(/desconhecido/);
  });
});
