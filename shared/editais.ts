// Prazo de impugnacao do PARR (Procedimento Administrativo de Reconhecimento de Responsabilidade).
//
// Fonte: texto dos proprios editais PGFN — "A impugnacao deve ser feita no prazo de 30 dias corridos contados da
// publicacao deste Edital no sitio da PGFN na internet" (base legal citada no edital: Lei 10.522/2002, art. 20-D, III;
// Portaria PGFN 948/2017).
// Contagem adotada: data de publicacao + 30 dias corridos, excluido o dia da publicacao (regra geral do art. 66 da
// Lei 9.784/1999). PENDENTE DE CONFIRMACAO (Marcelo): aplicacao subsidiaria dessa regra ao PARR e prorrogacao quando
// o vencimento cai em dia sem expediente. Enquanto nao confirmado, a tela mostra o prazo como "estimado".

export const PRAZO_IMPUGNACAO_DIAS = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

function isoParaUtc(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

const utcParaIso = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** "aaaa-mm-dd" da data local (o painel e usado no Brasil; evita virar o dia por causa do UTC). */
export function hojeIso(agora: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

/** Data final estimada da impugnacao: publicacao + 30 dias corridos. */
export function prazoImpugnacao(publicacaoIso: string): string | null {
  const t = isoParaUtc(publicacaoIso);
  return t === null ? null : utcParaIso(t + PRAZO_IMPUGNACAO_DIAS * DIA_MS);
}

export type SituacaoPrazo = {
  prazo: string; // ISO
  dias: number; // dias corridos ate o prazo (0 = vence hoje; negativo = encerrado)
  nivel: "aberto" | "atencao" | "critico" | "encerrado";
  rotulo: string;
};

/**
 * Situacao do prazo a partir da publicacao MAIS RECENTE do lead.
 * Niveis: critico (vence em ate 3 dias), atencao (ate 10), aberto (mais de 10), encerrado (passou).
 */
export function situacaoPrazo(ultimaPublicacao: string | null | undefined, hoje: string): SituacaoPrazo | null {
  if (!ultimaPublicacao) return null;
  const prazo = prazoImpugnacao(ultimaPublicacao);
  const tPrazo = prazo ? isoParaUtc(prazo) : null;
  const tHoje = isoParaUtc(hoje);
  if (!prazo || tPrazo === null || tHoje === null) return null;
  const dias = Math.round((tPrazo - tHoje) / DIA_MS);
  const data = prazo.split("-").reverse().join("/");
  if (dias < 0) return { prazo, dias, nivel: "encerrado", rotulo: `Prazo encerrado em ${data}` };
  const nivel = dias <= 3 ? "critico" : dias <= 10 ? "atencao" : "aberto";
  const quando = dias === 0 ? "vence hoje" : dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`;
  return { prazo, dias, nivel, rotulo: `Impugnação até ${data} · ${quando}` };
}
