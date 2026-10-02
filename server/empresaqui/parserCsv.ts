// Parser PURO do CSV exportado pelo site da EmpresAqui ("minhalista-empresaqui-*.csv").
// Sem I/O, sem banco: recebe os bytes do arquivo e devolve empresas normalizadas + alertas agregados.
//
// Formato observado (sondagem de 02/10/2026, 6.072 linhas reais):
// - separador ";", sem aspas, CRLF, sem BOM, 58 colunas fixas (ordem em COLUNAS);
// - corpo em cp1252; a coluna "Grupo" (texto digitado no site) vem em UTF-8; o cabecalho traz o
//   caractere de substituicao (U+FFFD) gravado no lugar dos acentos. Por isso cada campo e decodificado
//   isoladamente (UTF-8 estrito, senao cp1252) e as colunas sao reconhecidas pela POSICAO, com conferencia
//   do cabecalho ignorando tudo que nao e ASCII;
// - "Telefone 1" sai do site em notacao cientifica ("5,51139E+11") ou so com o DDI ("55"): os digitos
//   finais ja foram perdidos na geracao do arquivo. Esses valores sao descartados, nunca "consertados";
// - campos de socios sao listas separadas por "-" com "-" final; a qualificacao "SOCIO-ADMINISTRADOR"
//   contem hifen e e reconstruida pela contagem de socios (ver parseQualificacoes);
// - datas dd/mm/aaaa, vazio = "", "//", "//0" ou "00/00/0000"; valores "R$ 1.234,56" (guardados em centavos).
//
// Alertas nunca carregam valores do arquivo: so codigo, contagem e numeros de linha.

export const COLUNAS = [
  "Grupo", "Status", "CNPJ", "Razão", "Fantasia", "Tipo", "Endereço", "Número", "Complemento", "Bairro",
  "Cidade", "UF", "Cód. IBGE", "CEP", "Telefone 1", "Telefone 2", "E-mail", "Site", "CNAE Principal",
  "Texto CNAE Principal", "CNAE Secundário", "Matriz/Filial", "Ente Federativo", "Situação Cad.",
  "Data Situação Cad.", "Natureza Jurídica", "Data Início Atv.", "Opção pelo MEI", "Data entrada MEI",
  "Data exclusão MEI", "Programas Especiais", "Regime Tributário", "Data Opção Simples",
  "Data Exclusão Simples", "Capital Social da Empresa", "Identificador 1º Sócio", "Nome do Sócio",
  "Faixa Etária", "CPF/CNPJ do Sócio", "Qualificação", "Data da Entrada", "Faturamento Estimado",
  "Quadro de Funcionários", "Dívidas Federais Ativas", "Total Dívidas", "Site Verificado",
  "Domínio Verificado", "E-mails Verificados", "Telefones Verificados", "WhatsApps Verificados", "Instagram",
  "LinkedIn Empresa", "LinkedIn Sócios", "Facebook", "Google Maps", "Segmentos / Tags", "Classificação B2B",
  "Atualização dos Dados Verificados",
] as const;

/** Colunas obrigatorias: ate "Total Dívidas". As de "Verificados" em diante sao aceitas se vierem. */
export const COLUNAS_MINIMAS = COLUNAS.indexOf("Total Dívidas") + 1;

const C = Object.fromEntries(COLUNAS.map((nome, i) => [nome, i])) as Record<(typeof COLUNAS)[number], number>;

export type Socio = {
  identificador: string; // PF, PJ, ESTRANGEIRO
  nome: string;
  faixaEtaria: string | null;
  cpfCnpjMascarado: string | null;
  qualificacao: string | null;
  dataEntrada: string | null; // ISO aaaa-mm-dd
};

export type Divida = { numero: string; valorCentavos: number };

export type EmpresaCsv = {
  linha: number; // linha do arquivo (1 = cabecalho)
  cnpj: string; // 14 digitos
  razaoSocial: string;
  nomeFantasia: string | null;
  endereco: {
    tipo: string | null; logradouro: string | null; numero: string | null; complemento: string | null;
    bairro: string | null; municipio: string | null; uf: string | null; codigoIbge: string | null; cep: string | null;
  };
  telefones: string[]; // so digitos, sem DDI, 10 ou 11 digitos (DDD + numero)
  email: string | null;
  site: string | null;
  cnaePrincipal: string | null; // 7 digitos
  cnaePrincipalDescricao: string | null;
  cnaesSecundarios: string[];
  matriz: boolean | null;
  quantidadeFiliais: number | null;
  enteFederativo: string | null;
  situacaoCadastral: string | null;
  dataSituacaoCadastral: string | null;
  naturezaJuridica: string | null;
  dataInicioAtividade: string | null;
  opcaoMei: boolean | null;
  dataEntradaMei: string | null;
  dataExclusaoMei: string | null;
  dataOpcaoSimples: string | null;
  dataExclusaoSimples: string | null;
  programasEspeciais: string[];
  regimeTributario: string | null; // regime atual (ano mais recente, quando vier historico)
  historicoRegime: { ano: number; regime: string }[];
  capitalSocialCentavos: number | null;
  socios: Socio[];
  faturamentoEstimado: string | null;
  quadroFuncionarios: string | null;
  dividas: Divida[];
  totalDividasCentavos: number | null;
  /** Todas as colunas do arquivo, pelo nome canonico (com acentos), ja decodificadas. */
  bruto: Record<string, string>;
};

export type CodigoAlerta =
  | "linha_colunas_divergentes"
  | "cnpj_invalido"
  | "cnpj_duplicado"
  | "telefone_corrompido_no_export"
  | "telefone_invalido"
  | "data_invalida"
  | "valor_invalido"
  | "socios_ambiguos"
  | "qualificacao_ambigua"
  | "dividas_total_divergente";

export const DESCRICAO_ALERTA: Record<CodigoAlerta, string> = {
  linha_colunas_divergentes: "Linha com número de colunas diferente do cabeçalho (descartada)",
  cnpj_invalido: "CNPJ ausente ou com dígito verificador inválido (linha descartada)",
  cnpj_duplicado: "CNPJ repetido no arquivo (mantida a última ocorrência)",
  telefone_corrompido_no_export: "Telefone em notação científica ou só com DDI no arquivo do site (descartado)",
  telefone_invalido: "Telefone com quantidade de dígitos inválida (descartado)",
  data_invalida: "Data fora do formato dd/mm/aaaa (gravada vazia)",
  valor_invalido: "Valor monetário ilegível (gravado vazio)",
  socios_ambiguos: "Listas de sócios com tamanhos diferentes (sócios não importados; revisar)",
  qualificacao_ambigua: "Qualificação dos sócios não pôde ser separada (gravada vazia)",
  dividas_total_divergente: "Soma das inscrições difere do Total Dívidas em mais de 1%",
};

export type Alertas = Partial<Record<CodigoAlerta, { total: number; linhas: number[] }>>;

export type ResultadoCsv = {
  empresas: EmpresaCsv[];
  alertas: Alertas;
  linhasLidas: number; // sem o cabecalho
  colunasNoArquivo: number;
};

export class LayoutInvalidoError extends Error {}

const MAX_LINHAS_POR_ALERTA = 50;

// ---------------------------------------------------------------- decodificacao

const utf8 = new TextDecoder("utf-8", { fatal: true });
const cp1252 = new TextDecoder("windows-1252");

/** Decodifica um campo: UTF-8 estrito quando valido, senao cp1252. ASCII puro e igual nos dois. */
export function decodeCampo(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return cp1252.decode(bytes);
  }
}

/** Chave de comparacao de cabecalho: so ASCII alfanumerico, minusculo (tolera acento perdido ou trocado). */
export function chaveCabecalho(s: string): string {
  return s.replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitBytes(buf: Uint8Array, sep: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === sep) {
      out.push(buf.subarray(start, i));
      start = i + 1;
    }
  }
  out.push(buf.subarray(start));
  return out;
}

function linhasDoArquivo(buf: Uint8Array): Uint8Array[] {
  let b = buf;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  return splitBytes(b, 0x0a)
    .map(l => (l.length && l[l.length - 1] === 0x0d ? l.subarray(0, l.length - 1) : l))
    .filter((l, i, arr) => !(l.length === 0 && i === arr.length - 1));
}

// ---------------------------------------------------------------- normalizadores de campo

const vazio = (s: string): string | null => {
  const t = s.trim();
  return t === "" ? null : t;
};

const digitos = (s: string): string => s.replace(/\D/g, "");

/** Valida CNPJ pelo digito verificador (modulo 11, pesos 5..2,9..2 e 6..2,9..2). */
export function cnpjValido(cnpj: string): boolean {
  const d = digitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number): number => {
    let soma = 0;
    let peso = len - 7;
    for (let i = 0; i < len; i++) {
      soma += Number(d[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** "dd/mm/aaaa" -> "aaaa-mm-dd". Vazio, "//", "//0" e "00/00/0000" -> null. Formato estranho -> "invalida". */
export function parseData(s: string): string | null | "invalida" {
  const t = s.trim();
  if (t === "" || /^\/\/0*$/.test(t) || /^00\/00\/0000$/.test(t)) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!m) return "invalida";
  const [, dd, mm, aaaa] = m;
  const dt = new Date(Date.UTC(Number(aaaa), Number(mm) - 1, Number(dd)));
  if (dt.getUTCFullYear() !== Number(aaaa) || dt.getUTCMonth() !== Number(mm) - 1 || dt.getUTCDate() !== Number(dd)) return "invalida";
  return `${aaaa}-${mm}-${dd}`;
}

/** "R$ 1.234,56" ou "1234,56" -> centavos. Vazio -> null. Ilegivel -> "invalido". */
export function parseValorBr(s: string): number | null | "invalido" {
  const t = s.replace(/R\$/i, "").replace(/\s/g, "");
  if (t === "") return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return "invalido";
  const [inteiro, frac = ""] = t.replace(/\./g, "").split(",");
  return Number(inteiro) * 100 + Number(frac.padEnd(2, "0"));
}

/**
 * Normaliza telefone do export: so digitos, sem DDI 55, com 10 (fixo) ou 11 (celular) digitos.
 * Notacao cientifica ("5,51139E+11") e "55" isolado sao perda de dados na origem -> "corrompido".
 */
export function parseTelefone(s: string): string | null | "corrompido" | "invalido" {
  const t = s.trim();
  if (t === "") return null;
  if (/e\+?\d/i.test(t)) return "corrompido";
  let d = digitos(t);
  if (d === "55") return "corrompido";
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return d;
  return "invalido";
}

/** Separa lista "A-B-C-" em ["A","B","C"] (hifen final e o terminador). */
export function splitLista(s: string): string[] {
  const t = s.trim();
  if (t === "") return [];
  const partes = t.split("-");
  if (partes[partes.length - 1].trim() === "") partes.pop();
  return partes.map(p => p.trim());
}

/**
 * Reconstroi as qualificacoes de n socios a partir da lista separada por hifen.
 * Unico composto com hifen observado na tabela de qualificacoes da RFB: "SÓCIO-ADMINISTRADOR"
 * (inclusive "SÓCIO-ADMINISTRADOR RESIDENTE OU DOMICILIADO NO EXTERIOR"). Um par ("SÓCIO", "ADMINISTRADOR...")
 * pode ser um socio-administrador ou dois socios distintos; a contagem de socios decide:
 * faltam m = tokens - n fusoes; se m = 0 nada se funde, se m = pares candidatos todos se fundem,
 * qualquer outro caso e ambiguo -> null.
 */
export function parseQualificacoes(s: string, n: number): string[] | null {
  const tokens = splitLista(s);
  const fusoes = tokens.length - n;
  if (fusoes === 0) return tokens;
  const candidatos: number[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === "SÓCIO" && tokens[i + 1].startsWith("ADMINISTRADOR")) {
      candidatos.push(i);
      i++; // pares nao se sobrepoem
    }
  }
  if (fusoes < 0 || fusoes !== candidatos.length) return null;
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (candidatos.includes(i)) {
      out.push(`${tokens[i]}-${tokens[i + 1]}`);
      i++;
    } else out.push(tokens[i]);
  }
  return out;
}

/** "Num: 123 Valor: 1575420,00 - Num: FGSP1 Valor: 10,00" -> dividas. */
export function parseDividas(s: string): Divida[] | "invalido" {
  const out: Divida[] = [];
  const re = /Num:\s*(\S+)\s+Valor:\s*([\d.,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const v = parseValorBr(m[2]);
    if (v === null || v === "invalido") return "invalido";
    out.push({ numero: m[1], valorCentavos: v });
  }
  return out;
}

/** "PRESUMIDO OU LUCRO REAL" ou "ANO 2020 LUCRO PRESUMIDO, ANO 2021 SIMPLES NACIONAL, " */
export function parseRegime(s: string): { atual: string | null; historico: { ano: number; regime: string }[] } {
  const t = s.trim();
  const historico = Array.from(t.matchAll(/ANO\s+(\d{4})\s+([^,]+)/g), m => ({ ano: Number(m[1]), regime: m[2].trim() }));
  if (historico.length === 0) return { atual: vazio(t), historico };
  historico.sort((a, b) => a.ano - b.ano);
  return { atual: historico[historico.length - 1].regime, historico };
}

// ---------------------------------------------------------------- parser

export function parseEmpresaquiCsv(arquivo: Uint8Array): ResultadoCsv {
  const linhas = linhasDoArquivo(arquivo);
  if (linhas.length === 0) throw new LayoutInvalidoError("Arquivo vazio.");

  const cabecalho = splitBytes(linhas[0], 0x3b).map(decodeCampo);
  if (cabecalho.length < COLUNAS_MINIMAS || cabecalho.length > COLUNAS.length) {
    throw new LayoutInvalidoError(
      `Esperadas entre ${COLUNAS_MINIMAS} e ${COLUNAS.length} colunas separadas por ";"; o arquivo tem ${cabecalho.length}.`,
    );
  }
  const divergentes = cabecalho
    .map((h, i) => (chaveCabecalho(h) === chaveCabecalho(COLUNAS[i]) ? null : `${i + 1} (esperado "${COLUNAS[i]}")`))
    .filter((x): x is string => x !== null);
  if (divergentes.length) {
    throw new LayoutInvalidoError(`Cabeçalho fora do layout EmpresAqui nas colunas: ${divergentes.join(", ")}.`);
  }

  const alertas: Alertas = {};
  const alerta = (codigo: CodigoAlerta, linha: number): void => {
    const a = (alertas[codigo] ??= { total: 0, linhas: [] });
    a.total++;
    if (a.linhas.length < MAX_LINHAS_POR_ALERTA) a.linhas.push(linha);
  };

  const porCnpj = new Map<string, EmpresaCsv>();
  let linhasLidas = 0;

  for (let li = 1; li < linhas.length; li++) {
    const linha = li + 1;
    if (linhas[li].length === 0) continue;
    linhasLidas++;
    const f = splitBytes(linhas[li], 0x3b).map(decodeCampo);
    if (f.length !== cabecalho.length) {
      alerta("linha_colunas_divergentes", linha);
      continue;
    }
    const v = (col: (typeof COLUNAS)[number]): string => f[C[col]] ?? "";

    const cnpj = digitos(v("CNPJ"));
    if (!cnpjValido(cnpj)) {
      alerta("cnpj_invalido", linha);
      continue;
    }

    const data = (col: (typeof COLUNAS)[number]): string | null => {
      const d = parseData(v(col));
      if (d === "invalida") {
        alerta("data_invalida", linha);
        return null;
      }
      return d;
    };
    const valor = (s: string): number | null => {
      const x = parseValorBr(s);
      if (x === "invalido") {
        alerta("valor_invalido", linha);
        return null;
      }
      return x;
    };

    const telefones: string[] = [];
    for (const col of ["Telefone 1", "Telefone 2"] as const) {
      const t = parseTelefone(v(col));
      if (t === "corrompido") alerta("telefone_corrompido_no_export", linha);
      else if (t === "invalido") alerta("telefone_invalido", linha);
      else if (t && !telefones.includes(t)) telefones.push(t);
    }

    const matrizFilial = v("Matriz/Filial").trim();
    const mMatriz = /^Matriz(?:\s+com\s+(\d+)\s+Filia)?/i.exec(matrizFilial);

    // Socios: o Identificador define quantos sao.
    let socios: Socio[] = [];
    const ids = splitLista(v("Identificador 1º Sócio"));
    if (ids.length) {
      const nomes = splitLista(v("Nome do Sócio"));
      const faixas = splitLista(v("Faixa Etária"));
      const docs = splitLista(v("CPF/CNPJ do Sócio"));
      const datas = splitLista(v("Data da Entrada"));
      if ([nomes, faixas, docs, datas].some(l => l.length !== ids.length)) {
        alerta("socios_ambiguos", linha);
      } else {
        const quals = parseQualificacoes(v("Qualificação"), ids.length);
        if (!quals) alerta("qualificacao_ambigua", linha);
        socios = ids.map((identificador, i) => {
          const dt = parseData(datas[i]);
          if (dt === "invalida") alerta("data_invalida", linha);
          return {
            identificador,
            nome: nomes[i],
            faixaEtaria: vazio(faixas[i]),
            cpfCnpjMascarado: vazio(docs[i]),
            qualificacao: quals ? quals[i] : null,
            dataEntrada: dt === "invalida" ? null : dt,
          };
        });
      }
    }

    let dividas: Divida[] = [];
    const parsedDividas = parseDividas(v("Dívidas Federais Ativas"));
    if (parsedDividas === "invalido") alerta("valor_invalido", linha);
    else dividas = parsedDividas;
    const totalDividasCentavos = valor(v("Total Dívidas"));
    if (totalDividasCentavos !== null && dividas.length) {
      const soma = dividas.reduce((s, d) => s + d.valorCentavos, 0);
      if (Math.abs(soma - totalDividasCentavos) > Math.max(100, totalDividasCentavos * 0.01)) {
        alerta("dividas_total_divergente", linha);
      }
    }

    const regime = parseRegime(v("Regime Tributário"));
    const mei = v("Opção pelo MEI").trim().toUpperCase();
    const programas = v("Programas Especiais").trim();
    const cnae = (s: string): string | null => (digitos(s) ? digitos(s).padStart(7, "0") : null);

    const bruto: Record<string, string> = {};
    cabecalho.forEach((_, i) => {
      bruto[COLUNAS[i]] = f[i];
    });

    if (porCnpj.has(cnpj)) alerta("cnpj_duplicado", linha);
    porCnpj.set(cnpj, {
      linha,
      cnpj,
      razaoSocial: v("Razão").trim(),
      nomeFantasia: vazio(v("Fantasia")),
      endereco: {
        tipo: vazio(v("Tipo")),
        logradouro: vazio(v("Endereço")),
        numero: vazio(v("Número")),
        complemento: vazio(v("Complemento")),
        bairro: vazio(v("Bairro")),
        municipio: vazio(v("Cidade")),
        uf: vazio(v("UF"))?.toUpperCase() ?? null,
        codigoIbge: vazio(digitos(v("Cód. IBGE"))),
        cep: digitos(v("CEP")).length === 8 ? digitos(v("CEP")) : null,
      },
      telefones,
      email: vazio(v("E-mail"))?.toLowerCase() ?? null,
      site: vazio(v("Site")),
      cnaePrincipal: cnae(v("CNAE Principal")),
      cnaePrincipalDescricao: vazio(v("Texto CNAE Principal")),
      cnaesSecundarios: v("CNAE Secundário").split(",").map(cnae).filter((x): x is string => x !== null),
      matriz: mMatriz ? true : /^Filial/i.test(matrizFilial) ? false : null,
      quantidadeFiliais: mMatriz?.[1] !== undefined ? Number(mMatriz[1]) : null,
      enteFederativo: vazio(v("Ente Federativo")),
      situacaoCadastral: vazio(v("Situação Cad."))?.toUpperCase() ?? null,
      dataSituacaoCadastral: data("Data Situação Cad."),
      naturezaJuridica: vazio(v("Natureza Jurídica")),
      dataInicioAtividade: data("Data Início Atv."),
      opcaoMei: mei === "S" ? true : mei === "N" ? false : null,
      dataEntradaMei: data("Data entrada MEI"),
      dataExclusaoMei: data("Data exclusão MEI"),
      dataOpcaoSimples: data("Data Opção Simples"),
      dataExclusaoSimples: data("Data Exclusão Simples"),
      programasEspeciais: programas.toUpperCase() === "NAO" ? [] : programas.split(/\s+-(?:\s+|$)/).map(p => p.trim()).filter(Boolean),
      regimeTributario: regime.atual,
      historicoRegime: regime.historico,
      capitalSocialCentavos: valor(v("Capital Social da Empresa")),
      socios,
      faturamentoEstimado: vazio(v("Faturamento Estimado")),
      quadroFuncionarios: vazio(v("Quadro de Funcionários")),
      dividas,
      totalDividasCentavos,
      bruto,
    });
  }

  return { empresas: Array.from(porCnpj.values()), alertas, linhasLidas, colunasNoArquivo: cabecalho.length };
}
