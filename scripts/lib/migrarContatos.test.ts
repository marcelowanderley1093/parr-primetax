import { describe, expect, it } from "vitest";
import { parseSocios } from "../../client/src/lib/socios";
import {
  MigracaoAbort, contatosDoLead, estatisticasVazias, mesmoNome, normalizarTelefone, parseArgsMigracao,
} from "./migrarContatos";

// Dados 100% sinteticos.
const lead = (telefoneSocios: string | null, nome = "FULANO DE TAL") => ({ id: 7, nome, telefoneSocios });
const json = (v: unknown) => JSON.stringify(v);

describe("contatosDoLead", () => {
  it("gera uma linha por telefone, com pessoa, CPF so digitos e telefone normalizado", () => {
    const s = estatisticasVazias();
    const out = contatosDoLead(
      lead(json([{ nome: "FULANO DE TAL", cpf: "123.456.789-09", telefones: ["(11) 91234-5678", "(11) 3000-0000"] }])),
      s,
    );
    expect(out).toEqual([
      { leadId: 7, pessoaNome: "FULANO DE TAL", pessoaCpf: "12345678909", tipo: "telefone", valor: "11912345678", origem: "base_anterior" },
      { leadId: 7, pessoaNome: "FULANO DE TAL", pessoaCpf: "12345678909", tipo: "telefone", valor: "1130000000", origem: "base_anterior" },
    ]);
    expect(s.contatosGerados).toBe(2);
    expect(s.cpfsValidos).toBe(1);
    expect(s.sociosMesmoNomeDoLead).toBe(1);
  });

  it("opcao (a): guarda contatos de todos os socios, cada um com seu nome", () => {
    const s = estatisticasVazias();
    const out = contatosDoLead(
      lead(json([
        { nome: "FULANO DE TAL", cpf: "", telefones: ["(11) 91111-1111"] },
        { nome: "BELTRANA SOCIA", cpf: "", telefones: ["(21) 92222-2222"] },
      ])),
      s,
    );
    expect(out.map(c => [c.pessoaNome, c.valor])).toEqual([["FULANO DE TAL", "11911111111"], ["BELTRANA SOCIA", "21922222222"]]);
    expect(s.sociosMesmoNomeDoLead).toBe(1);
  });

  it("descarta nome invalido, telefone invalido e socio sem telefone e sem CPF (contando cada caso)", () => {
    const s = estatisticasVazias();
    const out = contatosDoLead(
      lead(json([
        { nome: "(11) 99999-9999", cpf: "", telefones: ["(11) 91111-1111"] },
        { nome: "AB", telefones: ["(11) 91111-1111"] },
        { nome: "SEM CONTATO NENHUM", cpf: "123", telefones: ["11 91111-1111", "(11) abc"] },
      ])),
      s,
    );
    expect(out).toEqual([]);
    expect(s.sociosNomeInvalido).toBe(2);
    expect(s.sociosSemTelefoneESemCpf).toBe(1);
    expect(s.telefonesInvalidos).toBe(2);
    expect(s.cpfsInvalidosZerados).toBe(1);
  });

  it("socio so com CPF nao vira contato, mas e contado", () => {
    const s = estatisticasVazias();
    expect(contatosDoLead(lead(json([{ nome: "SO CPF SILVA", cpf: "12345678909", telefones: [] }])), s)).toEqual([]);
    expect(s.sociosSoComCpf).toBe(1);
  });

  it("remove telefone duplicado da mesma pessoa (inclusive com e sem DDI)", () => {
    const s = estatisticasVazias();
    const out = contatosDoLead(lead(json([{ nome: "FULANO DE TAL", telefones: ["(11) 91234-5678", "(55) 11 91234-5678"] }])), s);
    expect(out).toHaveLength(1);
    expect(s.telefonesDuplicados).toBe(1);
  });

  it("JSON nulo, invalido ou nao-array gera zero linhas e nunca lanca", () => {
    const s = estatisticasVazias();
    expect(contatosDoLead(lead(null), s)).toEqual([]);
    expect(contatosDoLead(lead("{nao e json"), s)).toEqual([]);
    expect(contatosDoLead(lead(json({ nome: "X" })), s)).toEqual([]);
    expect(contatosDoLead(lead(json([null, 1, "x"])), s)).toEqual([]);
    expect(s.leadsComJson).toBe(3);
    expect(s.jsonInvalido).toBe(2);
  });
});

describe("paridade com a tela (client/src/lib/socios.ts)", () => {
  const casos = [
    [{ nome: "FULANO DE TAL", cpf: "123.456.789-09", telefones: ["(11) 91234-5678"] }],
    [{ nome: "AB", telefones: ["(11) 91234-5678"] }, { nome: "OUTRO SOCIO", cpf: "1", telefones: ["(11) 3000-0000", "x"] }],
    [{ nome: "12345678901", telefones: ["(11) 91234-5678"] }, { nome: "SO CPF", cpf: "12345678909", telefones: [] }],
    [{ nome: "SEM NADA", cpf: "", telefones: [] }, { nome: "COM 13 DIGITOS", telefones: ["(55) 11 91234-5678"] }],
  ];

  it.each(casos.map((c, i) => [i, c] as const))("caso %i: mesmos socios com telefone e mesmos telefones", (_, caso) => {
    const tela = parseSocios(json(caso)).filter(s => s.telefones.length > 0);
    const out = contatosDoLead(lead(json(caso)), estatisticasVazias());
    const daMigracao = [...new Set(out.map(c => c.pessoaNome))];
    expect(daMigracao).toEqual(tela.map(s => s.nome));
    for (const s of tela) {
      expect(out.filter(c => c.pessoaNome === s.nome).map(c => c.valor)).toEqual([...new Set(s.telefones.map(normalizarTelefone))]);
    }
  });
});

describe("auxiliares", () => {
  it("normalizarTelefone tira DDI 55 so quando sobra DDD + numero", () => {
    expect(normalizarTelefone("(55) 11 91234-5678")).toBe("11912345678");
    expect(normalizarTelefone("(11) 3000-0000")).toBe("1130000000");
    expect(normalizarTelefone("(55) 3000-0000")).toBe("5530000000"); // 10 digitos: DDD 55 (RS), nao DDI
  });

  it("mesmoNome ignora acento, caixa e espacos", () => {
    expect(mesmoNome("José  da Silva", "JOSE DA SILVA")).toBe(true);
    expect(mesmoNome("JOSE DA SILVA", "JOSE SILVA")).toBe(false);
    expect(mesmoNome("", "")).toBe(false);
  });

  it("parseArgsMigracao exige exatamente um modo", () => {
    expect(parseArgsMigracao(["--dry-run"])).toEqual({ run: "dry-run" });
    expect(parseArgsMigracao(["--apply"])).toEqual({ run: "apply" });
    expect(() => parseArgsMigracao([])).toThrow(MigracaoAbort);
    expect(() => parseArgsMigracao(["--dry-run", "--apply"])).toThrow(MigracaoAbort);
    expect(() => parseArgsMigracao(["--dry-run", "--force"])).toThrow(/desconhecido/);
  });
});
