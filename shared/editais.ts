// Prazo de impugnacao do PARR (Procedimento Administrativo de Reconhecimento de Responsabilidade).
//
// Fonte do prazo: texto dos proprios editais PGFN — "A impugnacao deve ser feita no prazo de 30 dias corridos contados
// da publicacao deste Edital no sitio da PGFN na internet" (base legal citada no edital: Lei 10.522/2002, art. 20-D, III;
// Portaria PGFN 948/2017).
// Contagem (confirmada por Marcelo em 02/10/2026): Lei 9.784/1999, art. 66 — exclui o dia do comeco e inclui o do
// vencimento; §1º — prorroga ate o primeiro dia util seguinte se o vencimento cair em dia sem expediente.
//
// "Dia sem expediente", criterio CONSERVADOR (decisao 02/10/2026): so sabado, domingo e feriado nacional fixado em lei
// federal. Nao prorrogam: pontos facultativos federais (Carnaval, Corpus Christi), a Sexta-feira da Paixao (feriado
// religioso declarado por lei municipal, Lei 9.093/1995, art. 2º) e feriados estaduais/municipais. Assim o PARR nunca
// mostra prazo MAIOR que o real; no maximo, um dia menor.

export const PRAZO_IMPUGNACAO_DIAS = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Feriados nacionais (mes-dia) por lei federal:
 * Lei 662/1949, com redacao da Lei 10.607/2002 (1/1, 21/4, 1/5, 7/9, 2/11, 15/11, 25/12); Lei 6.802/1980 (12/10);
 * Lei 14.759/2023 (20/11, a partir de 2024).
 */
const FERIADOS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];

export function feriadoNacional(iso: string): boolean {
  const md = iso.slice(5);
  if (FERIADOS_FIXOS.includes(md)) return true;
  return md === "11-20" && Number(iso.slice(0, 4)) >= 2024;
}

function isoParaUtc(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return utcParaIso(t) === iso ? t : null; // rejeita 2025-02-30 etc.
}

const utcParaIso = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** Sabado, domingo ou feriado nacional (criterio conservador acima). */
export function diaSemExpediente(iso: string): boolean {
  const t = isoParaUtc(iso);
  if (t === null) return false;
  const dow = new Date(t).getUTCDay();
  return dow === 0 || dow === 6 || feriadoNacional(iso);
}

/** "aaaa-mm-dd" da data local (o painel e usado no Brasil; evita virar o dia por causa do UTC). */
export function hojeIso(agora: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

/** Ultimo dia para impugnar: publicacao + 30 dias corridos, prorrogado ao primeiro dia util seguinte. */
export function prazoImpugnacao(publicacaoIso: string): string | null {
  const t = isoParaUtc(publicacaoIso);
  if (t === null) return null;
  let venc = t + PRAZO_IMPUGNACAO_DIAS * DIA_MS;
  while (diaSemExpediente(utcParaIso(venc))) venc += DIA_MS;
  return utcParaIso(venc);
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
