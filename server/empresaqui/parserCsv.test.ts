import { describe, expect, it } from "vitest";
import {
  COLUNAS, COLUNAS_MINIMAS, LayoutInvalidoError, cnpjValido, parseData, parseDividas, parseEmpresaquiCsv,
  parseQualificacoes, parseRegime, parseTelefone, parseValorBr, splitLista,
} from "./parserCsv";

// Fixture 100% sintetica. Reproduz as armadilhas do export real: cabecalho com U+FFFD no lugar dos
// acentos (ate "Total Dívidas") e UTF-8 correto nas colunas finais, corpo em cp1252, Grupo em UTF-8, CRLF.
const CNPJ_OK = "12.345.678/0001-95"; // DV valido
const CNPJ_OK_2 = "11.222.333/0001-81"; // DV valido
const CNPJ_DV_ERRADO = "12.345.678/0001-90";

type Linha = Partial<Record<(typeof COLUNAS)[number], string>>;

function cabecalho(n = COLUNAS.length): Buffer {
  const nomes = COLUNAS.slice(0, n).map((c, i) => (i < COLUNAS_MINIMAS ? c.replace(/[^\x00-\x7f]/g, "�") : c));
  return Buffer.from(nomes.join(";"), "utf-8");
}

function linha(l: Linha, n = COLUNAS.length): Buffer {
  const campos = COLUNAS.slice(0, n).map(c => {
    const v = l[c] ?? "";
    return c === "Grupo" ? Buffer.from(v, "utf-8") : Buffer.from(v, "latin1");
  });
  const partes: Buffer[] = [];
  campos.forEach((b, i) => {
    if (i) partes.push(Buffer.from(";"));
    partes.push(b);
  });
  return Buffer.concat(partes);
}

function arquivo(linhas: Buffer[], cab: Buffer = cabecalho()): Buffer {
  const partes: Buffer[] = [cab];
  for (const l of linhas) partes.push(Buffer.from("\r\n"), l);
  partes.push(Buffer.from("\r\n"));
  return Buffer.concat(partes);
}

const BASE: Linha = {
  Grupo: "CLÍNICAS JÁ CLIENTE",
  Status: "NOVO",
  CNPJ: CNPJ_OK,
  "Razão": "EMPRESA FICTÍCIA DE AÇÃO LTDA",
  Tipo: "RUA",
  "Endereço": "DAS FLORES",
  "Número": "100",
  Bairro: "CENTRO",
  Cidade: "SÃO PAULO",
  UF: "SP",
  "Cód. IBGE": "3550308",
  CEP: "01.000-000",
  "Telefone 1": "5,51139E+11",
  "Telefone 2": "1130000000",
  "E-mail": "Contato@Exemplo.test",
  "CNAE Principal": "620100",
  "Texto CNAE Principal": "Desenvolvimento de software",
  "CNAE Secundário": "6202300,7820500,",
  "Matriz/Filial": "Matriz com 2 Filiais",
  "Situação Cad.": "INAPTA",
  "Data Situação Cad.": "10/01/2022",
  "Natureza Jurídica": "Sociedade Empresária Limitada",
  "Data Início Atv.": "01/02/2000",
  "Opção pelo MEI": "N",
  "Data entrada MEI": "00/00/0000",
  "Data exclusão MEI": "//",
  "Programas Especiais": "IMPORTACAO E EXPORTACAO - BENEFICIARIO DO PAT - ",
  "Regime Tributário": "ANO 2022 LUCRO REAL, ANO 2020 LUCRO PRESUMIDO, ",
  "Data Opção Simples": "//",
  "Data Exclusão Simples": "//0",
  "Capital Social da Empresa": "R$ 1.234,56",
  "Identificador 1º Sócio": "PF-PF-",
  "Nome do Sócio": "FULANO DE TAL-BELTRANA DE TAL-",
  "Faixa Etária": "41 A 50 ANOS-51 A 60 ANOS-",
  "CPF/CNPJ do Sócio": "***111111**-***222222**-",
  "Qualificação": "SÓCIO-ADMINISTRADOR-SÓCIO-",
  "Data da Entrada": "01/02/2000-15/03/2010-",
  "Faturamento Estimado": "R$ 81.000,01 a R$ 360.000,00",
  "Quadro de Funcionários": "0 A 5 COLABORADORES",
  "Dívidas Federais Ativas": "Num: 1000000001 Valor: 1000,00 - Num: 1.2 Valor: 500,50 - Num: FGSP1 Valor: 99,50",
  "Total Dívidas": "R$ 1.600,00",
};

const parse = (linhas: Linha[]) => parseEmpresaquiCsv(arquivo(linhas.map(l => linha(l))));

describe("layout do arquivo", () => {
  it("aceita cabecalho com acentos corrompidos (U+FFFD) e colunas finais em UTF-8", () => {
    const r = parse([BASE]);
    expect(r.colunasNoArquivo).toBe(58);
    expect(r.linhasLidas).toBe(1);
    expect(r.empresas).toHaveLength(1);
  });

  it("aceita arquivo so ate 'Total Dívidas' (sem colunas de verificados)", () => {
    const r = parseEmpresaquiCsv(arquivo([linha(BASE, COLUNAS_MINIMAS)], cabecalho(COLUNAS_MINIMAS)));
    expect(r.empresas).toHaveLength(1);
    expect(r.colunasNoArquivo).toBe(COLUNAS_MINIMAS);
  });

  it("aceita BOM UTF-8 no inicio e arquivo com LF simples", () => {
    const lf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), cabecalho(), Buffer.from("\n"), linha(BASE), Buffer.from("\n")]);
    expect(parseEmpresaquiCsv(lf).empresas).toHaveLength(1);
  });

  it("rejeita colunas fora de ordem, nomeando a posicao", () => {
    const nomes = [...COLUNAS] as string[];
    [nomes[3], nomes[4]] = [nomes[4], nomes[3]];
    const cab = Buffer.from(nomes.join(";"), "utf-8");
    expect(() => parseEmpresaquiCsv(arquivo([], cab))).toThrow(LayoutInvalidoError);
    expect(() => parseEmpresaquiCsv(arquivo([], cab))).toThrow(/colunas: 4 .*5 /);
  });

  it("rejeita outro separador ou quantidade de colunas fora da faixa", () => {
    const virgula = Buffer.from(COLUNAS.join(","), "utf-8");
    expect(() => parseEmpresaquiCsv(arquivo([], virgula))).toThrow(LayoutInvalidoError);
    expect(() => parseEmpresaquiCsv(arquivo([], cabecalho(COLUNAS_MINIMAS - 1)))).toThrow(LayoutInvalidoError);
    expect(() => parseEmpresaquiCsv(Buffer.alloc(0))).toThrow(LayoutInvalidoError);
  });

  it("descarta linha com colunas a mais (';' dentro de campo) e alerta", () => {
    const r = parse([{ ...BASE, Complemento: "SALA 1; FUNDOS" }]);
    expect(r.empresas).toHaveLength(0);
    expect(r.alertas.linha_colunas_divergentes).toEqual({ total: 1, linhas: [2] });
  });
});

describe("decodificacao por campo", () => {
  it("corpo cp1252 e Grupo UTF-8 saem corretos no mesmo arquivo", () => {
    const e = parse([BASE]).empresas[0];
    expect(e.razaoSocial).toBe("EMPRESA FICTÍCIA DE AÇÃO LTDA");
    expect(e.endereco.municipio).toBe("SÃO PAULO");
    expect(e.bruto["Grupo"]).toBe("CLÍNICAS JÁ CLIENTE");
    expect(e.socios[0].qualificacao).toBe("SÓCIO-ADMINISTRADOR");
    expect(Object.values(e.bruto).some(v => v.includes("�"))).toBe(false);
  });

  it("bruto guarda todas as colunas pelo nome canonico", () => {
    const e = parse([BASE]).empresas[0];
    expect(Object.keys(e.bruto)).toEqual([...COLUNAS]);
    expect(e.bruto["Telefone 1"]).toBe("5,51139E+11");
  });
});

describe("CNPJ", () => {
  it("valida digito verificador", () => {
    expect(cnpjValido(CNPJ_OK)).toBe(true);
    expect(cnpjValido(CNPJ_OK_2)).toBe(true);
    expect(cnpjValido(CNPJ_DV_ERRADO)).toBe(false);
    expect(cnpjValido("11.111.111/1111-11")).toBe(false);
    expect(cnpjValido("123")).toBe(false);
  });

  it("descarta linha com CNPJ invalido e mantem a ultima ocorrencia de CNPJ duplicado", () => {
    const r = parse([BASE, { ...BASE, CNPJ: CNPJ_DV_ERRADO }, { ...BASE, "Razão": "SEGUNDA VERSAO" }, { ...BASE, CNPJ: CNPJ_OK_2 }]);
    expect(r.empresas.map(e => e.cnpj)).toEqual(["12345678000195", "11222333000181"]);
    expect(r.empresas[0].razaoSocial).toBe("SEGUNDA VERSAO");
    expect(r.alertas.cnpj_invalido).toEqual({ total: 1, linhas: [3] });
    expect(r.alertas.cnpj_duplicado).toEqual({ total: 1, linhas: [4] });
  });
});

describe("telefones", () => {
  it("normaliza: tira DDI 55, aceita 10 e 11 digitos", () => {
    expect(parseTelefone("5511912345678")).toBe("11912345678");
    expect(parseTelefone("551130000000")).toBe("1130000000");
    expect(parseTelefone("11912345678")).toBe("11912345678");
    expect(parseTelefone("(11) 3000-0000")).toBe("1130000000");
    expect(parseTelefone("")).toBeNull();
  });

  it("notacao cientifica e DDI isolado sao perda na origem: 'corrompido', nunca reconstruidos", () => {
    expect(parseTelefone("5,51139E+11")).toBe("corrompido");
    expect(parseTelefone("5.5E+12")).toBe("corrompido");
    expect(parseTelefone("55")).toBe("corrompido");
    expect(parseTelefone("9")).toBe("invalido");
    expect(parseTelefone("123456789012345")).toBe("invalido");
  });

  it("na empresa: descarta o corrompido, guarda o valido, alerta sem valor", () => {
    const r = parse([BASE, { ...BASE, CNPJ: CNPJ_OK_2, "Telefone 1": "55", "Telefone 2": "9" }]);
    expect(r.empresas[0].telefones).toEqual(["1130000000"]);
    expect(r.empresas[1].telefones).toEqual([]);
    expect(r.alertas.telefone_corrompido_no_export).toEqual({ total: 2, linhas: [2, 3] });
    expect(r.alertas.telefone_invalido).toEqual({ total: 1, linhas: [3] });
  });

  it("nao duplica telefone igual nas duas colunas", () => {
    const e = parse([{ ...BASE, "Telefone 1": "551130000000" }]).empresas[0];
    expect(e.telefones).toEqual(["1130000000"]);
  });
});

describe("datas e valores", () => {
  it("datas: converte para ISO; sentinelas viram null; data impossivel e invalida", () => {
    expect(parseData("10/01/2022")).toBe("2022-01-10");
    for (const s of ["", "//", "//0", "00/00/0000"]) expect(parseData(s)).toBeNull();
    expect(parseData("31/02/2020")).toBe("invalida");
    expect(parseData("2020-01-01")).toBe("invalida");
  });

  it("valores BR em centavos", () => {
    expect(parseValorBr("R$ 1.234,56")).toBe(123456);
    expect(parseValorBr("R$ 0,00")).toBe(0);
    expect(parseValorBr("1575420,00")).toBe(157542000);
    expect(parseValorBr("R$ 2.852.200,5")).toBe(285220050);
    expect(parseValorBr("")).toBeNull();
    expect(parseValorBr("R$ abc")).toBe("invalido");
    expect(parseValorBr("1,234.56")).toBe("invalido");
  });

  it("na empresa: data invalida vira null com alerta", () => {
    const r = parse([{ ...BASE, "Data Início Atv.": "31/02/2020" }]);
    expect(r.empresas[0].dataInicioAtividade).toBeNull();
    expect(r.alertas.data_invalida?.total).toBe(1);
  });
});

describe("socios", () => {
  it("splitLista remove o hifen terminador", () => {
    expect(splitLista("PF-PF-")).toEqual(["PF", "PF"]);
    expect(splitLista("PF")).toEqual(["PF"]);
    expect(splitLista("")).toEqual([]);
  });

  it("qualificacao: funde SÓCIO + ADMINISTRADOR quando a contagem exige", () => {
    expect(parseQualificacoes("SÓCIO-ADMINISTRADOR-SÓCIO-ADMINISTRADOR-", 2)).toEqual(["SÓCIO-ADMINISTRADOR", "SÓCIO-ADMINISTRADOR"]);
    expect(parseQualificacoes("SÓCIO-ADMINISTRADOR-", 1)).toEqual(["SÓCIO-ADMINISTRADOR"]);
    expect(parseQualificacoes("SÓCIO-ADMINISTRADOR RESIDENTE OU DOMICILIADO NO EXTERIOR-", 1)).toEqual([
      "SÓCIO-ADMINISTRADOR RESIDENTE OU DOMICILIADO NO EXTERIOR",
    ]);
    expect(parseQualificacoes("DIRETOR-PRESIDENTE-", 2)).toEqual(["DIRETOR", "PRESIDENTE"]);
  });

  it("qualificacao: com 2 socios, 'SÓCIO-ADMINISTRADOR-' sao duas pessoas distintas", () => {
    expect(parseQualificacoes("SÓCIO-ADMINISTRADOR-", 2)).toEqual(["SÓCIO", "ADMINISTRADOR"]);
  });

  it("qualificacao: ambigua devolve null (nunca chuta)", () => {
    // 4 tokens, 3 socios, 2 pares candidatos: qual par fundir? ambiguo.
    expect(parseQualificacoes("SÓCIO-ADMINISTRADOR-SÓCIO-ADMINISTRADOR-", 3)).toBeNull();
    expect(parseQualificacoes("DIRETOR-", 2)).toBeNull();
  });

  it("na empresa: monta socios com datas ISO", () => {
    const e = parse([BASE]).empresas[0];
    expect(e.socios).toEqual([
      { identificador: "PF", nome: "FULANO DE TAL", faixaEtaria: "41 A 50 ANOS", cpfCnpjMascarado: "***111111**", qualificacao: "SÓCIO-ADMINISTRADOR", dataEntrada: "2000-02-01" },
      { identificador: "PF", nome: "BELTRANA DE TAL", faixaEtaria: "51 A 60 ANOS", cpfCnpjMascarado: "***222222**", qualificacao: "SÓCIO", dataEntrada: "2010-03-15" },
    ]);
  });

  it("nome com hifen desalinha as listas: socios nao importados, alerta para revisao", () => {
    const r = parse([{ ...BASE, "Nome do Sócio": "ANA MARIA-SOUZA-BELTRANA DE TAL-" }]);
    expect(r.empresas[0].socios).toEqual([]);
    expect(r.alertas.socios_ambiguos).toEqual({ total: 1, linhas: [2] });
  });

  it("qualificacao ambigua: socios importados com qualificacao null e alerta", () => {
    const r = parse([{ ...BASE, "Qualificação": "DIRETOR-" }]);
    expect(r.empresas[0].socios.map(s => s.qualificacao)).toEqual([null, null]);
    expect(r.alertas.qualificacao_ambigua?.total).toBe(1);
  });

  it("empresa sem socios", () => {
    const sem = { ...BASE, "Identificador 1º Sócio": "", "Nome do Sócio": "", "Faixa Etária": "", "CPF/CNPJ do Sócio": "", "Qualificação": "", "Data da Entrada": "" };
    const r = parse([sem]);
    expect(r.empresas[0].socios).toEqual([]);
    expect(r.alertas).toEqual({ telefone_corrompido_no_export: { total: 1, linhas: [2] } });
  });
});

describe("dividas", () => {
  it("le inscricoes com numero numerico, com ponto e FGTS", () => {
    expect(parseDividas(BASE["Dívidas Federais Ativas"]!)).toEqual([
      { numero: "1000000001", valorCentavos: 100000 },
      { numero: "1.2", valorCentavos: 50050 },
      { numero: "FGSP1", valorCentavos: 9950 },
    ]);
    expect(parseDividas("")).toEqual([]);
  });

  it("total igual a soma (ou com arredondamento) nao alerta", () => {
    const r = parse([BASE]);
    expect(r.empresas[0].totalDividasCentavos).toBe(160000);
    expect(r.alertas.dividas_total_divergente).toBeUndefined();
  });

  it("total divergente da soma em mais de 1% alerta", () => {
    const r = parse([{ ...BASE, "Total Dívidas": "R$ 5.000,00" }]);
    expect(r.alertas.dividas_total_divergente).toEqual({ total: 1, linhas: [2] });
  });
});

describe("demais campos", () => {
  it("normaliza endereco, CNAE, matriz, regime, programas, MEI e capital", () => {
    const e = parse([BASE]).empresas[0];
    expect(e.endereco).toEqual({
      tipo: "RUA", logradouro: "DAS FLORES", numero: "100", complemento: null, bairro: "CENTRO",
      municipio: "SÃO PAULO", uf: "SP", codigoIbge: "3550308", cep: "01000000",
    });
    expect(e.email).toBe("contato@exemplo.test");
    expect(e.cnaePrincipal).toBe("0620100");
    expect(e.cnaesSecundarios).toEqual(["6202300", "7820500"]);
    expect(e.matriz).toBe(true);
    expect(e.quantidadeFiliais).toBe(2);
    expect(e.regimeTributario).toBe("LUCRO REAL");
    expect(e.historicoRegime).toEqual([{ ano: 2020, regime: "LUCRO PRESUMIDO" }, { ano: 2022, regime: "LUCRO REAL" }]);
    expect(e.programasEspeciais).toEqual(["IMPORTACAO E EXPORTACAO", "BENEFICIARIO DO PAT"]);
    expect(e.opcaoMei).toBe(false);
    expect(e.dataEntradaMei).toBeNull();
    expect(e.dataExclusaoSimples).toBeNull();
    expect(e.capitalSocialCentavos).toBe(123456);
    expect(e.nomeFantasia).toBeNull();
  });

  it("filial e regime sem historico", () => {
    const e = parse([{ ...BASE, "Matriz/Filial": "Filial", "Regime Tributário": "PRESUMIDO OU LUCRO REAL", "Programas Especiais": "NAO" }]).empresas[0];
    expect(e.matriz).toBe(false);
    expect(e.quantidadeFiliais).toBeNull();
    expect(e.regimeTributario).toBe("PRESUMIDO OU LUCRO REAL");
    expect(e.historicoRegime).toEqual([]);
    expect(e.programasEspeciais).toEqual([]);
  });

  it("parseRegime vazio", () => {
    expect(parseRegime("")).toEqual({ atual: null, historico: [] });
  });
});

describe("alertas nao vazam dados", () => {
  it("alertas so tem total e numeros de linha", () => {
    const r = parse([{ ...BASE, CNPJ: CNPJ_DV_ERRADO }, { ...BASE, "Total Dívidas": "R$ 9,00" }]);
    const json = JSON.stringify(r.alertas);
    expect(json).not.toMatch(/FULANO|FICT|12345678|E\+11|1130000000/);
    for (const a of Object.values(r.alertas)) {
      expect(Object.keys(a!)).toEqual(["total", "linhas"]);
      expect(a!.linhas.every(n => Number.isInteger(n))).toBe(true);
    }
  });
});
