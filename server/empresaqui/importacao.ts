// Logica pura da importacao do CSV EmpresAqui para a tabela `empresas`. Sem banco.
//
// Decisoes (02/10/2026, Marcelo):
// - grava TODAS as empresas do arquivo (toda empresa importada tem lead, antes ou depois do CSV);
// - EmpresAqui sobrescreve os dados oficiais da empresa; NUNCA toca nome/telefone/e-mail/CPF/contatos do lead;
// - o lead e ligado a empresa pelo CNPJ (so digitos), nos dois sentidos: ao importar o CSV e ao importar o edital.
//
// `empresas.dados` guarda um objeto por fonte: { csv: {...} } agora; a sincronizacao pela API acrescenta { api: {...} }
// sem apagar o csv (e vice-versa).
import type { InsertEmpresa } from "../../drizzle/schema";
import { DESCRICAO_ALERTA, type CodigoAlerta, type EmpresaCsv, type ResultadoCsv } from "./parserCsv";

/** Tamanho maximo do arquivo aceito (o export do site com 5.000 CNPJs tem ~6 MB). */
export const MAX_BYTES_ARQUIVO = 20 * 1024 * 1024;

export class ArquivoInvalidoError extends Error {}

/** Base64 (com ou sem prefixo data:) -> bytes, com limite de tamanho. */
export function decodificarArquivo(base64: string): Uint8Array {
  const limpo = base64.replace(/^data:[^,]*,/, "");
  if (!/^[A-Za-z0-9+/=\s]*$/.test(limpo)) throw new ArquivoInvalidoError("Arquivo corrompido no envio.");
  const bytes = Buffer.from(limpo, "base64");
  if (bytes.length === 0) throw new ArquivoInvalidoError("Arquivo vazio.");
  if (bytes.length > MAX_BYTES_ARQUIVO) throw new ArquivoInvalidoError("Arquivo maior que 20 MB: exporte em partes de até 5.000 CNPJs.");
  return new Uint8Array(bytes);
}

/**
 * CNPJ do lead -> chave de comparacao com empresas.cnpj (14 digitos).
 * Planilhas de edital as vezes perdem o zero a esquerda (Excel trata como numero): completa ate 14.
 * Mesma regra do SQL de vinculo em db.vincularLeadsAEmpresas (LPAD(REGEXP_REPLACE(cnpj,'[^0-9]',''),14,'0')).
 */
export function chaveCnpjLead(cnpj: string | null | undefined): string | null {
  if (!cnpj) return null;
  const d = cnpj.replace(/\D/g, "");
  if (d.length === 0 || d.length > 14) return null;
  return d.padStart(14, "0");
}

export type DadosCsv = Omit<EmpresaCsv, "bruto" | "linha">;

const corta = (s: string | null, max: number): string | null => (s === null ? null : s.slice(0, max));

/** EmpresaCsv -> linha de `empresas`. `dados` leva so a parte csv; o upsert preserva a parte api. */
export function linhaEmpresa(e: EmpresaCsv, agora: Date): InsertEmpresa & { dados: { csv: DadosCsv } } {
  const { bruto, linha: _linha, ...dadosCsv } = e;
  return {
    cnpj: e.cnpj,
    razaoSocial: corta(e.razaoSocial || null, 255),
    nomeFantasia: corta(e.nomeFantasia, 255),
    situacaoCadastral: corta(e.situacaoCadastral, 20),
    regimeTributario: corta(e.regimeTributario, 60),
    cnaePrincipal: e.cnaePrincipal,
    uf: corta(e.endereco.uf, 2),
    municipio: corta(e.endereco.municipio, 120),
    totalDividasCentavos: e.totalDividasCentavos,
    qtdInscricoes: e.dividas.length,
    dados: { csv: dadosCsv },
    brutoCsv: bruto,
    csvAtualizadoEm: agora,
  };
}

export type ResumoImportacao = {
  linhasLidas: number;
  empresasNoArquivo: number;
  novas: number;
  atualizadas: number;
  leadsAVincular: number; // leads (existentes hoje) cujo CNPJ esta no arquivo
  empresasComLead: number;
  empresasSemLeadAinda: number; // informativo: o lead chega com o edital
  alertas: { codigo: CodigoAlerta; descricao: string; total: number }[];
};

/** Prevista a partir do arquivo ja lido, dos CNPJs ja gravados e dos CNPJs dos leads (chave -> quantos leads). */
export function resumirImportacao(
  resultado: ResultadoCsv,
  cnpjsExistentes: ReadonlySet<string>,
  leadsPorCnpj: ReadonlyMap<string, number>,
): ResumoImportacao {
  let novas = 0;
  let leadsAVincular = 0;
  let empresasComLead = 0;
  for (const e of resultado.empresas) {
    if (!cnpjsExistentes.has(e.cnpj)) novas++;
    const n = leadsPorCnpj.get(e.cnpj) ?? 0;
    if (n > 0) {
      empresasComLead++;
      leadsAVincular += n;
    }
  }
  const alertas = (Object.entries(resultado.alertas) as [CodigoAlerta, { total: number }][])
    .map(([codigo, a]) => ({ codigo, descricao: DESCRICAO_ALERTA[codigo], total: a.total }))
    .sort((a, b) => b.total - a.total);
  return {
    linhasLidas: resultado.linhasLidas,
    empresasNoArquivo: resultado.empresas.length,
    novas,
    atualizadas: resultado.empresas.length - novas,
    leadsAVincular,
    empresasComLead,
    empresasSemLeadAinda: resultado.empresas.length - empresasComLead,
    alertas,
  };
}

/** CNPJs dos leads -> mapa chave(14 digitos) -> quantidade de leads. */
export function contarLeadsPorCnpj(leads: { cnpj: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of leads) {
    const k = chaveCnpjLead(l.cnpj);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}
