// Leitor PURO da resposta da API EmpresAqui (GET /acesso/RetornoJson.php?Token=&Cnpj=). Sem I/O.
//
// Formato observado nas sondas de 02 e 05/10/2026 (so estrutura, sem valores):
// - objeto achatado; socios e dividas vem misturados em chaves numericas ("0", "1", ...), cada um com seus campos
//   (socios_* ou dividas_*); erro vem como { Erro: "..." } (ex.: HTTP 404 para CNPJ inexistente);
// - datas cadastrais em AAAAMMDD ("" = vazio); data da divida em dd/mm/aaaa;
// - valor da divida com ponto decimal e sem milhar ("12345.6"); historico trimestral em reais BR ("R$ 1.234,56") ou
//   texto quando nao ha divida;
// - situacao, porte, matriz e faixa etaria como CODIGOS do leiaute dos Dados Abertos do CNPJ (Receita Federal);
// - parte dos textos chega com acentuacao corrompida (UTF-8 lido como Latin-1: "ContribuiÃ§Ãµes"): corrigida aqui.
//
// O resultado usa os mesmos nomes de campo do leitor do CSV (server/empresaqui/parserCsv.ts) para o card mostrar
// as duas fontes; campos extras da API (receita, situacao da divida, historico) sao opcionais.

export class NaoEncontradoError extends Error {}
export class RespostaInvalidaError extends Error {}

/** Codigos do leiaute dos Dados Abertos do CNPJ (Receita Federal). */
export const SITUACAO_CADASTRAL: Record<string, string> = { "1": "NULA", "2": "ATIVA", "3": "SUSPENSA", "4": "INAPTA", "8": "BAIXADA" };
export const PORTE: Record<string, string> = { "0": "NÃO INFORMADO", "1": "MICROEMPRESA", "3": "EMPRESA DE PEQUENO PORTE", "5": "DEMAIS" };
export const FAIXA_ETARIA: Record<string, string> = {
  "0": "NÃO SE APLICA", "1": "0 A 12 ANOS", "2": "13 A 20 ANOS", "3": "21 A 30 ANOS", "4": "31 A 40 ANOS",
  "5": "41 A 50 ANOS", "6": "51 A 60 ANOS", "7": "61 A 70 ANOS", "8": "71 A 80 ANOS", "9": "ACIMA DE 80 ANOS",
};

/** Corrige texto UTF-8 que foi lido como Latin-1 ("ContribuiÃ§Ãµes" -> "Contribuições"). Texto normal passa intacto. */
export function corrigirTexto(s: string): string {
  if (!/[\u00C3\u00C2][\u0080-\u00BF]/.test(s)) return s;
  const r = Buffer.from(s, "latin1").toString("utf8");
  return r.includes("\uFFFD") ? s : r;
}

const str = (v: unknown): string => (typeof v === "string" ? corrigirTexto(v).trim() : typeof v === "number" ? String(v) : "");
const vazio = (v: unknown): string | null => str(v) || null;
const digitos = (s: string) => s.replace(/\D/g, "");

/** "20240131" -> "2024-01-31"; vazio/"00000000"/invalida -> null. */
export function dataAaaammdd(v: unknown): string | null {
  const s = digitos(str(v));
  if (s.length !== 8 || /^0+$/.test(s)) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** "31/01/2024" -> "2024-01-31"; invalida -> null. */
export function dataBr(v: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str(v));
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Valor com ponto decimal ("12345.6", "999") -> centavos. Invalido -> null. */
export function centavosPonto(v: unknown): number | null {
  const s = str(v).replace(/\s/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  return Number(i) * 100 + Number(f.padEnd(2, "0"));
}

/** Valor em reais BR ("R$ 1.234,56", "0,00") -> centavos; texto sem numero (ex.: sem divida) -> null. */
export function centavosBr(v: unknown): number | null {
  const s = str(v).replace(/R\$/i, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.replace(/\./g, "").split(",");
  return Number(i) * 100 + Number(f.padEnd(2, "0"));
}

/** Telefone da API (DDD e numero separados) -> so digitos, 10 ou 11; senao null. */
export function telefoneApi(ddd: unknown, tel: unknown): string | null {
  const d = digitos(str(ddd)) + digitos(str(tel));
  return d.length === 10 || d.length === 11 ? d : null;
}

export type SocioApi = {
  identificador: "PF" | "PJ" | "ESTRANGEIRO";
  nome: string;
  faixaEtaria: string | null;
  cpfCnpjMascarado: string | null;
  qualificacao: string | null;
  dataEntrada: string | null;
};

export type DividaApi = {
  numero: string;
  valorCentavos: number;
  data: string | null;
  receita: string | null;
  situacao: string | null;
  tipoDevedor: string | null;
  natureza: string | null; // campo "dividas_inscricao" da API (natureza/tipo da inscricao)
  indicador: string | null;
};

export type TrimestreApi = { trimestre: string; valorCentavos: number | null; rotulo: string | null };

export type DadosApi = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  endereco: { tipo: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; municipio: string | null; uf: string | null; cep: string | null };
  telefones: string[];
  email: string | null;
  site: string | null;
  cnaePrincipal: string | null;
  cnaePrincipalDescricao: string | null;
  cnaesSecundarios: string[];
  matriz: boolean | null;
  situacaoCadastral: string | null;
  dataSituacaoCadastral: string | null;
  naturezaJuridica: string | null;
  dataInicioAtividade: string | null;
  opcaoMei: boolean | null;
  dataEntradaMei: string | null;
  dataExclusaoMei: string | null;
  opcaoSimples: boolean | null;
  dataOpcaoSimples: string | null;
  dataExclusaoSimples: string | null;
  porte: string | null;
  capitalSocialCentavos: number | null;
  regimeTributario: string | null;
  faturamentoEstimado: string | null;
  quadroFuncionarios: string | null;
  programasEspeciais: string[];
  socios: SocioApi[];
  dividas: DividaApi[];
  totalDividasCentavos: number;
  historicoDividasTrimestral: TrimestreApi[];
  historicoRegime: unknown[]; // formato ainda nao observado (veio vazio nas sondas): guardado como veio
};

const simNao = (v: unknown): boolean | null => {
  const s = str(v).toUpperCase();
  return s === "S" || s === "SIM" ? true : s === "N" || s === "NAO" || s === "NÃO" ? false : null;
};
const cnae7 = (s: string): string | null => (digitos(s) ? digitos(s).padStart(7, "0").slice(0, 7) : null);

function identificadorSocio(mascara: string): SocioApi["identificador"] {
  const d = mascara.replace(/[^\d*]/g, "");
  if (d.length === 11) return "PF";
  if (d.length === 14) return "PJ";
  return mascara ? "ESTRANGEIRO" : "PF";
}

/** Le a resposta (ja em JSON). { Erro } -> NaoEncontradoError; sem cnpj/razao -> RespostaInvalidaError. */
export function parseRespostaApi(json: unknown): DadosApi {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new RespostaInvalidaError("resposta nao e um objeto");
  const o = json as Record<string, unknown>;
  if (typeof o.Erro === "string") throw new NaoEncontradoError("CNPJ não encontrado na EmpresAqui");
  const cnpj = digitos(str(o.cnpj)).padStart(14, "0");
  const razaoSocial = str(o.razao);
  if (cnpj.length !== 14 || !razaoSocial) throw new RespostaInvalidaError("resposta sem CNPJ ou razao social");

  const socios: SocioApi[] = [];
  const dividas: DividaApi[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (!/^\d+$/.test(k) || !v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    if ("socios_nome" in e) {
      const mascara = str(e.socios_cpf_cnpj);
      socios.push({
        identificador: identificadorSocio(mascara),
        nome: str(e.socios_nome),
        faixaEtaria: FAIXA_ETARIA[str(e.socios_faixa_etaria)] ?? vazio(e.socios_faixa_etaria),
        cpfCnpjMascarado: mascara || null,
        qualificacao: vazio(e.socios_qualificacao)?.toUpperCase() ?? null,
        dataEntrada: dataAaaammdd(e.socios_entrada),
      });
    } else if ("dividas_numero" in e) {
      const valor = centavosPonto(e.dividas_valor);
      if (valor === null) continue;
      dividas.push({
        numero: str(e.dividas_numero),
        valorCentavos: valor,
        data: dataBr(e.dividas_data),
        receita: vazio(e.dividas_receita),
        situacao: vazio(e.dividas_tipo_situacao),
        tipoDevedor: vazio(e.dividas_tipo_devedor),
        natureza: vazio(e.dividas_inscricao),
        indicador: vazio(e.dividas_indicador),
      });
    }
  }

  const cnaeP = str(o.cnae_principal);
  const mCnae = /^(\d+)\s*-\s*(.*)$/.exec(cnaeP);
  const telefones = [telefoneApi(o.ddd_1, o.tel_1), telefoneApi(o.ddd_2, o.tel_2)].filter((t, i, a): t is string => !!t && a.indexOf(t) === i);
  const historico = Array.isArray(o.historicoDividasPorTrimestre) ? o.historicoDividasPorTrimestre : [];
  const capital = str(o.capital_social);

  return {
    cnpj,
    razaoSocial,
    nomeFantasia: vazio(o.fantasia),
    endereco: {
      tipo: vazio(o.log_tipo), logradouro: vazio(o.log_nome), numero: vazio(o.log_num), complemento: vazio(o.log_comp)?.replace(/\s+/g, " ") ?? null,
      bairro: vazio(o.log_bairro), municipio: vazio(o.log_municipio), uf: vazio(o.log_uf)?.toUpperCase() ?? null,
      cep: digitos(str(o.log_cep)).length === 8 ? digitos(str(o.log_cep)) : null,
    },
    telefones,
    email: vazio(o.email)?.toLowerCase() ?? null,
    site: vazio(o.site),
    cnaePrincipal: mCnae ? cnae7(mCnae[1]) : cnae7(cnaeP),
    cnaePrincipalDescricao: mCnae ? mCnae[2].trim() || null : null,
    cnaesSecundarios: str(o.cnae_secundario).split(",").map(cnae7).filter((x): x is string => !!x),
    matriz: str(o.matriz) === "1" ? true : str(o.matriz) === "2" ? false : null,
    situacaoCadastral: SITUACAO_CADASTRAL[str(o.situacao_cadastral)] ?? vazio(o.situacao_cadastral),
    dataSituacaoCadastral: dataAaaammdd(o.data_sit_cad),
    naturezaJuridica: vazio(o.natureza_juridica),
    dataInicioAtividade: dataAaaammdd(o.data_abertura),
    opcaoMei: simNao(o.opcao_mei),
    dataEntradaMei: dataAaaammdd(o.data_mei),
    dataExclusaoMei: dataAaaammdd(o.data_exc_mei),
    opcaoSimples: simNao(o.opcao_simples),
    dataOpcaoSimples: dataAaaammdd(o.data_simples),
    dataExclusaoSimples: dataAaaammdd(o.data_exc_simples),
    porte: PORTE[str(o.porte)] ?? vazio(o.porte),
    capitalSocialCentavos: capital ? centavosPonto(capital) ?? centavosBr(capital) : null,
    regimeTributario: vazio(o.regime_tributario)?.toUpperCase() ?? null,
    faturamentoEstimado: vazio(o.faturamento),
    quadroFuncionarios: vazio(o.quadro_funcionarios),
    programasEspeciais: Array.isArray(o.programas_especiais) ? o.programas_especiais.map(str).filter(Boolean) : [],
    socios,
    dividas,
    totalDividasCentavos: dividas.reduce((s, d) => s + d.valorCentavos, 0),
    historicoDividasTrimestral: historico
      .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
      .map(h => {
        const valor = centavosBr(h.valor);
        return { trimestre: str(h.trimestreAno), valorCentavos: valor, rotulo: valor === null ? vazio(h.valor) : null };
      }),
    historicoRegime: Array.isArray(o.historicoRegimePorAno) ? o.historicoRegimePorAno : [],
  };
}
