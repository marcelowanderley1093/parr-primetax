import { useState } from "react";

// Evolucao da divida ativa por trimestre (API EmpresAqui). Uma serie de magnitude: barras na cor da marca
// (#008C95), sem legenda (o titulo diz o que e), rotulo so no ultimo trimestre e no pico, dica no hover
// e tabela como alternativa acessivel.

export type Trimestre = { trimestre: string; valorCentavos: number | null; rotulo: string | null };

const COR = "#008C95";
const ALTURA = 96;
const BRL = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** "2º TRI/2020" -> 20202 (para ordenar); formato desconhecido mantem a ordem da API. */
function chave(t: string, i: number): number {
  const m = /(\d)\D*TRI\D*(\d{4})/i.exec(t);
  return m ? Number(m[2]) * 10 + Number(m[1]) : i;
}

/** Barra com os cantos de cima arredondados e a base reta. */
function barra(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export default function DividaTrimestralChart({ dados }: { dados: Trimestre[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);
  const serie = dados.map((d, i) => ({ ...d, k: chave(d.trimestre, i) })).sort((a, b) => a.k - b.k);
  if (serie.length === 0) return null;

  const max = Math.max(1, ...serie.map(s => s.valorCentavos ?? 0));
  const ultimo = serie[serie.length - 1];
  const iPico = serie.reduce((m, s, i) => ((s.valorCentavos ?? 0) > (serie[m].valorCentavos ?? 0) ? i : m), 0);
  const largura = 300;
  const slot = largura / serie.length;
  const w = Math.min(24, Math.max(2, slot - 2)); // barra fina; 2px de respiro entre barras
  const atual = hover !== null ? serie[hover] : null;

  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">Dívida ativa por trimestre</span>
        <button className="text-primary hover:underline" onClick={() => setTabela(v => !v)}>{tabela ? "ver gráfico" : "ver valores"}</button>
      </div>
      <div className="text-[11px] text-muted-foreground">
        Último ({ultimo.trimestre}): {ultimo.valorCentavos !== null ? BRL(ultimo.valorCentavos) : ultimo.rotulo ?? "—"}
        {serie[iPico].valorCentavos ? ` · pico ${BRL(serie[iPico].valorCentavos!)} (${serie[iPico].trimestre})` : ""}
      </div>

      {tabela ? (
        <table className="w-full mt-2 text-[11px]">
          <tbody>
            {serie.map(s => (
              <tr key={s.trimestre} className="border-t border-border/60">
                <td className="py-0.5 text-muted-foreground">{s.trimestre}</td>
                <td className="py-0.5 text-right">{s.valorCentavos !== null ? BRL(s.valorCentavos) : s.rotulo ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative mt-2">
          <svg viewBox={`0 0 ${largura} ${ALTURA + 14}`} className="w-full h-auto" role="img"
            aria-label={`Dívida ativa por trimestre, de ${serie[0].trimestre} a ${ultimo.trimestre}`}
            onMouseLeave={() => setHover(null)}>
            <line x1={0} x2={largura} y1={ALTURA} y2={ALTURA} stroke="currentColor" strokeOpacity={0.15} strokeWidth={1} />
            {serie.map((s, i) => {
              const h = s.valorCentavos ? Math.max(2, (s.valorCentavos / max) * (ALTURA - 4)) : 0;
              const x = i * slot + (slot - w) / 2;
              return (
                <g key={s.trimestre}>
                  {h > 0 && <path d={barra(x, ALTURA - h, w, h)} fill={COR} opacity={hover === null || hover === i ? 1 : 0.45} />}
                  {/* area de toque maior que a barra: a coluna inteira */}
                  <rect x={i * slot} y={0} width={slot} height={ALTURA} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
            <text x={0} y={ALTURA + 11} fontSize={9} fill="currentColor" fillOpacity={0.6}>{serie[0].trimestre}</text>
            <text x={largura} y={ALTURA + 11} fontSize={9} textAnchor="end" fill="currentColor" fillOpacity={0.6}>{ultimo.trimestre}</text>
          </svg>
          {atual && (
            <div className="pointer-events-none absolute -top-1 rounded border border-border bg-white px-2 py-1 text-[11px] shadow-sm"
              style={{ left: `${Math.min(70, Math.max(0, ((hover! + 0.5) / serie.length) * 100 - 15))}%` }}>
              <div className="text-muted-foreground">{atual.trimestre}</div>
              <div className="font-medium">{atual.valorCentavos !== null ? BRL(atual.valorCentavos) : atual.rotulo ?? "Sem dados"}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
