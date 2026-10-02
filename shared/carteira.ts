// Carteiras de parceiros (Fase B2). Regras compartilhadas entre tela e servidor.
// Decisoes (02/10/2026, Marcelo): parceiros nao concorrem — cada lead tem um dono; a distribuicao e a devolucao
// andam por GRUPO (leads que compartilham pessoa ou empresa); o parceiro pode devolver o grupo ou arquivar um lead
// com motivo; o admin transfere e reabre. Divida para filtro = divida ativa da EmpresAqui.

export const SITUACOES_CADASTRAIS = ["ATIVA", "INAPTA", "SUSPENSA", "BAIXADA", "NULA"] as const;
export type SituacaoCadastral = (typeof SITUACOES_CADASTRAIS)[number];

export type FiltroCarteira = {
  situacoes?: SituacaoCadastral[]; // situacao cadastral da empresa (EmpresAqui): ATIVA, INAPTA, SUSPENSA, BAIXADA, NULA
  dividaMin?: number | null; // em reais
  dividaMax?: number | null; // em reais
  ufs?: string[];
  cnaeDivisoes?: string[]; // 2 primeiros digitos do CNAE principal
  publicacaoDe?: string | null; // ISO; publicacao mais recente do lead
  publicacaoAte?: string | null;
  somentePrazoAberto?: boolean;
  incluirSemEmpresa?: boolean; // leads ainda sem dados da EmpresAqui entram mesmo com filtros de empresa
};

export const REGIOES: Record<string, string[]> = {
  Norte: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
  Nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["DF", "GO", "MS", "MT"],
  Sudeste: ["ES", "MG", "RJ", "SP"],
  Sul: ["PR", "RS", "SC"],
};
export const UFS = Object.values(REGIOES).flat().sort();

export const MOTIVOS_ARQUIVAMENTO = {
  sem_interesse: "Sem interesse",
  ja_regularizou: "Já regularizou / pagou",
  nao_localizado: "Não localizado",
  falecido: "Falecido",
  outro: "Outro (descrever)",
} as const;
export type MotivoArquivamento = keyof typeof MOTIVOS_ARQUIVAMENTO;

/** "86, 47 ,8610" -> ["86","47"] (so os 2 primeiros digitos de cada item, sem repetir). */
export function parseCnaeDivisoes(texto: string): string[] {
  const out: string[] = [];
  for (const parte of texto.split(/[\s,;]+/)) {
    const d = parte.replace(/\D/g, "").slice(0, 2);
    if (d.length === 2 && !out.includes(d)) out.push(d);
  }
  return out;
}

/** Remove campos vazios (para salvar e comparar filtros). */
export function limparFiltro(f: FiltroCarteira): FiltroCarteira {
  const out: FiltroCarteira = {};
  if (f.situacoes?.length) out.situacoes = [...f.situacoes];
  if (f.dividaMin != null && !Number.isNaN(f.dividaMin)) out.dividaMin = f.dividaMin;
  if (f.dividaMax != null && !Number.isNaN(f.dividaMax)) out.dividaMax = f.dividaMax;
  if (f.ufs?.length) out.ufs = [...f.ufs];
  if (f.cnaeDivisoes?.length) out.cnaeDivisoes = [...f.cnaeDivisoes];
  if (f.publicacaoDe) out.publicacaoDe = f.publicacaoDe;
  if (f.publicacaoAte) out.publicacaoAte = f.publicacaoAte;
  if (f.somentePrazoAberto) out.somentePrazoAberto = true;
  if (f.incluirSemEmpresa) out.incluirSemEmpresa = true;
  return out;
}

/** O filtro usa dados da EmpresAqui (situacao, divida, UF ou CNAE)? */
export function usaEmpresa(f: FiltroCarteira): boolean {
  return !!(f.situacoes?.length || f.dividaMin != null || f.dividaMax != null || f.ufs?.length || f.cnaeDivisoes?.length);
}
