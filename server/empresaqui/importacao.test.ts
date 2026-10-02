import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { COLUNAS, parseEmpresaquiCsv, type ResultadoCsv } from "./parserCsv";
import {
  ArquivoInvalidoError, MAX_BYTES_ARQUIVO, chaveCnpjLead, contarLeadsPorCnpj, decodificarArquivo, linhaEmpresa,
  resumirImportacao,
} from "./importacao";

// Fixture 100% sintetica (CNPJs de teste com DV valido).
const CNPJ_A = "12.345.678/0001-95";
const CNPJ_B = "11.222.333/0001-81";

function csv(linhas: Partial<Record<(typeof COLUNAS)[number], string>>[]): Buffer {
  const cab = COLUNAS.join(";");
  const corpo = linhas.map(l => COLUNAS.map(c => l[c] ?? "").join(";"));
  return Buffer.from([cab, ...corpo, ""].join("\r\n"), "latin1");
}
const linhaBase = (cnpj: string) => ({
  CNPJ: cnpj, "Razão": "EMPRESA FICTÍCIA LTDA", Cidade: "SÃO PAULO", UF: "SP", "Situação Cad.": "INAPTA",
  "Regime Tributário": "LUCRO PRESUMIDO", "CNAE Principal": "620100", "Telefone 1": "5,51139E+11",
  "Dívidas Federais Ativas": "Num: 1 Valor: 100,00 - Num: 2 Valor: 50,00", "Total Dívidas": "R$ 150,00",
  "Identificador 1º Sócio": "PF-", "Nome do Sócio": "FULANO DE TAL-", "Faixa Etária": "41 A 50 ANOS-",
  "CPF/CNPJ do Sócio": "***111111**-", "Qualificação": "SÓCIO-ADMINISTRADOR-", "Data da Entrada": "01/02/2000-",
});
const b64 = (b: Buffer) => b.toString("base64");

function ctx(role: "admin" | "comercial" | null): TrpcContext {
  return {
    user: role
      ? { id: 1, openId: "local-1", email: "x@exemplo.test", name: "Teste", loginMethod: "local", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }
      : null,
    req: { protocol: "https", headers: {}, get: () => "localhost:3000" } as any,
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("decodificarArquivo", () => {
  it("aceita base64 puro e com prefixo data:", () => {
    expect(Array.from(decodificarArquivo("YWJj"))).toEqual([97, 98, 99]);
    expect(Array.from(decodificarArquivo("data:text/csv;base64,YWJj"))).toEqual([97, 98, 99]);
  });

  it("rejeita vazio, lixo e arquivo acima do limite", () => {
    expect(() => decodificarArquivo("")).toThrow(ArquivoInvalidoError);
    expect(() => decodificarArquivo("@@@")).toThrow(ArquivoInvalidoError);
    expect(() => decodificarArquivo(Buffer.alloc(MAX_BYTES_ARQUIVO + 1).toString("base64"))).toThrow(/20 MB/);
  });
});

describe("chaveCnpjLead", () => {
  it("so digitos, completa zero a esquerda perdido pelo Excel", () => {
    expect(chaveCnpjLead("12.345.678/0001-95")).toBe("12345678000195");
    expect(chaveCnpjLead("1222333000181")).toBe("01222333000181");
  });

  it("vazio ou com digitos demais -> null", () => {
    expect(chaveCnpjLead(null)).toBeNull();
    expect(chaveCnpjLead("")).toBeNull();
    expect(chaveCnpjLead("abc")).toBeNull();
    expect(chaveCnpjLead("123456789012345")).toBeNull();
  });

  it("contarLeadsPorCnpj soma leads do mesmo CNPJ (socios do mesmo edital)", () => {
    const m = contarLeadsPorCnpj([{ cnpj: CNPJ_A }, { cnpj: "12345678000195" }, { cnpj: null }, { cnpj: CNPJ_B }]);
    expect(Object.fromEntries(m)).toEqual({ "12345678000195": 2, "11222333000181": 1 });
  });
});

describe("linhaEmpresa", () => {
  it("monta a linha de empresas com colunas de filtro, dados.csv sem o bruto e brutoCsv", () => {
    const e = parseEmpresaquiCsv(csv([linhaBase(CNPJ_A)])).empresas[0];
    const agora = new Date("2026-10-02T12:00:00Z");
    const l = linhaEmpresa(e, agora);
    expect(l).toMatchObject({
      cnpj: "12345678000195", razaoSocial: "EMPRESA FICTÍCIA LTDA", situacaoCadastral: "INAPTA",
      regimeTributario: "LUCRO PRESUMIDO", cnaePrincipal: "0620100", uf: "SP", municipio: "SÃO PAULO",
      totalDividasCentavos: 15000, qtdInscricoes: 2, csvAtualizadoEm: agora,
    });
    expect(l.dados.csv).not.toHaveProperty("bruto");
    expect(l.dados.csv).not.toHaveProperty("linha");
    expect(l.dados.csv.socios[0].qualificacao).toBe("SÓCIO-ADMINISTRADOR");
    expect(l.brutoCsv).toEqual(e.bruto);
  });

  it("corta textos acima do tamanho da coluna", () => {
    const e = parseEmpresaquiCsv(csv([{ ...linhaBase(CNPJ_A), "Razão": "X".repeat(300) }])).empresas[0];
    expect(linhaEmpresa(e, new Date()).razaoSocial).toHaveLength(255);
  });
});

describe("resumirImportacao", () => {
  const resultado: ResultadoCsv = parseEmpresaquiCsv(csv([linhaBase(CNPJ_A), linhaBase(CNPJ_B)]));

  it("conta novas, existentes, leads a vincular e empresas ainda sem lead", () => {
    const r = resumirImportacao(resultado, new Set(["12345678000195"]), new Map([["12345678000195", 2]]));
    expect(r).toMatchObject({
      linhasLidas: 2, empresasNoArquivo: 2, novas: 1, atualizadas: 1, leadsAVincular: 2, empresasComLead: 1, empresasSemLeadAinda: 1,
    });
  });

  it("alertas: so codigo, descricao e total (sem dados), do mais frequente ao menos", () => {
    const r = resumirImportacao(resultado, new Set(), new Map());
    expect(r.alertas[0]).toEqual({ codigo: "telefone_corrompido_no_export", descricao: expect.any(String), total: 2 });
    expect(JSON.stringify(r)).not.toMatch(/FULANO|FICT|12345678/);
  });
});

describe("empresas (router)", () => {
  const arquivo = { fileName: "teste.csv", conteudoBase64: b64(csv([linhaBase(CNPJ_A)])) };

  it("previa e importacao sao so de admin", async () => {
    await expect(appRouter.createCaller(ctx("comercial")).empresas.previewCsv(arquivo)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(appRouter.createCaller(ctx("comercial")).empresas.importarCsv(arquivo)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(appRouter.createCaller(ctx(null)).empresas.previewCsv(arquivo)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("arquivo fora do layout -> BAD_REQUEST com mensagem, antes de tocar no banco", async () => {
    const errado = { fileName: "x.csv", conteudoBase64: b64(Buffer.from("a,b,c\r\n1,2,3\r\n")) };
    await expect(appRouter.createCaller(ctx("admin")).empresas.previewCsv(errado)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/colunas/),
    });
  });

  it("arquivo valido passa da leitura e chega ao banco", async () => {
    await expect(appRouter.createCaller(ctx("admin")).empresas.previewCsv(arquivo)).rejects.toThrow("Database not available");
    await expect(appRouter.createCaller(ctx("admin")).empresas.importarCsv(arquivo)).rejects.toThrow("Database not available");
  });

  it("doLead: comercial pode ler; sem banco devolve null", async () => {
    await expect(appRouter.createCaller(ctx("comercial")).empresas.doLead({ leadId: 1 })).resolves.toBeNull();
    await expect(appRouter.createCaller(ctx(null)).empresas.doLead({ leadId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
