import { describe, expect, it } from "vitest";
import {
  NaoEncontradoError, RespostaInvalidaError, centavosBr, centavosPonto, corrigirTexto, dataAaaammdd, dataBr, parseRespostaApi, regimeAtual, telefoneApi,
} from "./parserApi";
import { consultarCnpj } from "./clienteApi";
import { cacheValido, inicioDoMesBrasil } from "./sincronizacao";

// Resposta 100% sintetica, no formato observado nas sondas (02 e 05/10/2026).
const latin1 = (s: string) => Buffer.from(s, "utf8").toString("latin1"); // simula o texto corrompido da API
const RESPOSTA = {
  cnpj: "12345678000195", razao: "EMPRESA FICTICIA LTDA", fantasia: null, ddd_1: "11", tel_1: "30000000", ddd_2: null, tel_2: null,
  email: "Contato@Exemplo.test", site: "www.exemplo.test", cnae_principal: "7820500 - Locação de mão de obra temporária",
  cnae_secundario: "6202300,620100", log_tipo: "RUA", log_nome: "DAS FLORES", log_num: "10", log_comp: "SALA  101", log_bairro: "CENTRO",
  log_municipio: "SAO PAULO", log_uf: "sp", log_cep: "01000000", matriz: "1", situacao_cadastral: "4", data_sit_cad: "20220110",
  natureza_juridica: "Sociedade Simples Limitada", data_abertura: "19940617", opcao_mei: "", data_mei: "", data_exc_mei: "",
  opcao_simples: "N", data_simples: "00000000", data_exc_simples: "", porte: "5", capital_social: "0", regime_tributario: "Presumido ou Lucro Real",
  faturamento: "R$ 4800001,00 a R$ 20000000,00", quadro_funcionarios: "100 A 500 COLABORADORES", programas_especiais: ["BENEFICIARIO DO PAT"],
  historicoDividasPorTrimestre: [{ trimestreAno: "1º TRI/2020", valor: "Sem dívida" }, { trimestreAno: "2º TRI/2020", valor: "R$ 1.234.567,89" }],
  historicoRegimePorAno: [],
  "0": { socios_nome: "FULANO DE TAL", socios_cpf_cnpj: "***111111**", socios_entrada: "19940617", socios_qualificacao: "Sócio-Administrador", socios_faixa_etaria: "9" },
  "1": { dividas_numero: "1000000000001", dividas_tipo_devedor: "PRINCIPAL", dividas_tipo_situacao: latin1("Em cobrança"), dividas_inscricao: "Nao Previdenciaria",
    dividas_receita: latin1("Contribuições Previdenciárias"), dividas_data: "15/03/2019", dividas_indicador: "SIM", dividas_valor: "157542.5" },
  "2": { dividas_numero: "FGSP000000001", dividas_tipo_devedor: "PRINCIPAL", dividas_tipo_situacao: "Em cobranca", dividas_inscricao: "FGTS",
    dividas_receita: "FGTS", dividas_data: "01/01/2020", dividas_indicador: "NAO", dividas_valor: "999" },
};

describe("parseRespostaApi", () => {
  const d = parseRespostaApi(RESPOSTA);

  it("separa socios e dividas das chaves numericas e soma o total", () => {
    expect(d.socios).toEqual([{ identificador: "PF", nome: "FULANO DE TAL", faixaEtaria: "ACIMA DE 80 ANOS", cpfCnpjMascarado: "***111111**", qualificacao: "SÓCIO-ADMINISTRADOR", dataEntrada: "1994-06-17" }]);
    expect(d.dividas.map(x => [x.numero, x.valorCentavos, x.data])).toEqual([["1000000000001", 15754250, "2019-03-15"], ["FGSP000000001", 99900, "2020-01-01"]]);
    expect(d.totalDividasCentavos).toBe(15854150);
  });

  it("corrige acentuacao corrompida da API", () => {
    expect(d.dividas[0].receita).toBe("Contribuições Previdenciárias");
    expect(d.dividas[0].situacao).toBe("Em cobrança");
  });

  it("traduz codigos da Receita e normaliza cadastro", () => {
    expect(d).toMatchObject({
      cnpj: "12345678000195", situacaoCadastral: "INAPTA", porte: "DEMAIS", matriz: true, dataSituacaoCadastral: "2022-01-10",
      dataInicioAtividade: "1994-06-17", opcaoMei: null, opcaoSimples: false, dataOpcaoSimples: null, capitalSocialCentavos: 0,
      regimeTributario: "PRESUMIDO OU LUCRO REAL", telefones: ["1130000000"], email: "contato@exemplo.test",
      cnaePrincipal: "7820500", cnaePrincipalDescricao: "Locação de mão de obra temporária", cnaesSecundarios: ["6202300", "0620100"],
      programasEspeciais: ["BENEFICIARIO DO PAT"],
    });
    expect(d.endereco).toMatchObject({ uf: "SP", complemento: "SALA 101", cep: "01000000" });
  });

  it("historico trimestral: texto vira rotulo (sem valor); reais BR viram centavos", () => {
    expect(d.historicoDividasTrimestral).toEqual([
      { trimestre: "1º TRI/2020", valorCentavos: null, rotulo: "Sem dívida" },
      { trimestre: "2º TRI/2020", valorCentavos: 123456789, rotulo: null },
    ]);
  });

  it("{ Erro } -> nao encontrado; sem CNPJ ou razao -> resposta invalida", () => {
    expect(() => parseRespostaApi({ Erro: "Nada foi encontrado." })).toThrow(NaoEncontradoError);
    expect(() => parseRespostaApi({ cnpj: "123" })).toThrow(RespostaInvalidaError);
    expect(() => parseRespostaApi([])).toThrow(RespostaInvalidaError);
  });

  it("divida com valor ilegivel e descartada (nao vira zero)", () => {
    const r = parseRespostaApi({ ...RESPOSTA, "2": { ...RESPOSTA["2"], dividas_valor: "abc" } });
    expect(r.dividas).toHaveLength(1);
  });
});

describe("auxiliares", () => {
  it("valores", () => {
    expect(centavosPonto("12345.6")).toBe(1234560);
    expect(centavosPonto("999")).toBe(99900);
    expect(centavosPonto("1.234,56")).toBeNull();
    expect(centavosBr("R$ 1.234,56")).toBe(123456);
    expect(centavosBr("Sem dívida")).toBeNull();
  });

  it("datas", () => {
    expect(dataAaaammdd("20240229")).toBe("2024-02-29");
    expect(dataAaaammdd("20230229")).toBeNull();
    expect(dataAaaammdd("00000000")).toBeNull();
    expect(dataAaaammdd("")).toBeNull();
    expect(dataBr("31/01/2024")).toBe("2024-01-31");
    expect(dataBr("2024-01-31")).toBeNull();
  });

  it("regime: historico corrido vira o regime do ano mais recente; texto simples passa", () => {
    expect(regimeAtual("ANO 2022 LUCRO PRESUMIDO; ANO 2024 LUCRO REAL; ANO 2023 LUCRO PRESUMIDO")).toBe("LUCRO REAL");
    expect(regimeAtual("ANO 2020 LUCRO PRESUMIDO, ")).toBe("LUCRO PRESUMIDO");
    expect(regimeAtual("Presumido ou Lucro Real")).toBe("PRESUMIDO OU LUCRO REAL");
    expect(regimeAtual("")).toBeNull();
  });

  it("telefone e texto", () => {
    expect(telefoneApi("21", "987654321")).toBe("21987654321");
    expect(telefoneApi("21", "")).toBeNull();
    expect(corrigirTexto("Ação")).toBe("Ação"); // texto correto passa intacto
  });
});

describe("consultarCnpj (fetch falso)", () => {
  const resposta = (status: number, corpo: unknown) =>
    (async () => new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status })) as unknown as typeof fetch;

  it("classifica sucesso, nao encontrado e erros HTTP", async () => {
    expect((await consultarCnpj("12345678000195", "tk", resposta(200, RESPOSTA))).tipo).toBe("ok");
    expect(await consultarCnpj("12345678000195", "tk", resposta(404, { Erro: "Nada foi encontrado." }))).toEqual({ tipo: "nao_encontrado", http: 404 });
    expect(await consultarCnpj("12345678000195", "tk", resposta(401, {}))).toEqual({ tipo: "erro", codigo: "token_invalido", http: 401 });
    expect(await consultarCnpj("12345678000195", "tk", resposta(403, {}))).toEqual({ tipo: "erro", codigo: "sem_permissao", http: 403 });
    expect(await consultarCnpj("12345678000195", "tk", resposta(429, {}))).toEqual({ tipo: "erro", codigo: "limite", http: 429 });
    expect(await consultarCnpj("12345678000195", "tk", resposta(200, "<html>"))).toEqual({ tipo: "erro", codigo: "resposta_invalida", http: 200 });
    expect(await consultarCnpj("12345678000195", "tk", resposta(502, "x"))).toEqual({ tipo: "erro", codigo: "indisponivel", http: 502 });
  }, 20_000);

  it("falha de rede vira indisponivel, sem lancar", async () => {
    const falha = (async () => { throw new Error("getaddrinfo ENOTFOUND https://...Token=segredo"); }) as unknown as typeof fetch;
    expect(await consultarCnpj("12345678000195", "tk", falha)).toEqual({ tipo: "erro", codigo: "indisponivel", http: null });
  }, 10_000);

  it("respeita 1 consulta por segundo (consultas seguidas ficam >= 1,1 s uma da outra)", async () => {
    const inicios: number[] = [];
    const f = (async () => { inicios.push(Date.now()); return new Response(JSON.stringify({ Erro: "x" }), { status: 404 }); }) as unknown as typeof fetch;
    await Promise.all([consultarCnpj("1", "tk", f), consultarCnpj("2", "tk", f)]);
    expect(inicios[1] - inicios[0]).toBeGreaterThanOrEqual(1_050);
  }, 10_000);
});

describe("cache e mes de consumo", () => {
  it("cache vale por cacheDias", () => {
    const agora = new Date("2026-10-05T12:00:00Z");
    expect(cacheValido(new Date("2026-09-10T12:00:00Z"), 30, agora)).toBe(true);
    expect(cacheValido(new Date("2026-09-01T12:00:00Z"), 30, agora)).toBe(false);
    expect(cacheValido(null, 30, agora)).toBe(false);
  });

  it("mes comeca a meia-noite de Brasilia (03:00 UTC)", () => {
    expect(inicioDoMesBrasil(new Date("2026-10-05T12:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
    // 01/11 01:00 UTC ainda e 31/10 em Brasilia
    expect(inicioDoMesBrasil(new Date("2026-11-01T01:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});
