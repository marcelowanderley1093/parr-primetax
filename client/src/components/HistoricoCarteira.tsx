import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { History } from "lucide-react";
import { descreverFiltro, type FiltroCarteira } from "@shared/carteira";

const n = (x: number) => x.toLocaleString("pt-BR");

const ACAO: Record<string, string> = {
  filtro_salvo: "Filtro salvo",
  atribuicao: "Atribuição",
  redistribuicao: "Redistribuição",
};

function resultado(h: { saiuGrupos: number | null; saiuLeads: number | null; entrouGrupos: number | null; entrouLeads: number | null }) {
  const partes: string[] = [];
  if (h.saiuLeads != null) partes.push(`saíram ${n(h.saiuLeads)} leads (${n(h.saiuGrupos ?? 0)} grupos)`);
  if (h.entrouLeads != null) partes.push(`entraram ${n(h.entrouLeads)} leads (${n(h.entrouGrupos ?? 0)} grupos)`);
  return partes.length ? partes.join(" · ") : "—";
}

/** Historico dos criterios de distribuicao do parceiro (so admin). "Usar este filtro" carrega no formulario. */
export default function HistoricoCarteira({ responsavelId, onUsar }: { responsavelId: number; onUsar: (f: FiltroCarteira) => void }) {
  const { data = [], isLoading } = trpc.carteira.historico.useQuery({ responsavelId });

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="text-sm font-semibold flex items-center gap-2"><History className="h-4 w-4 text-primary" /> Histórico de critérios</div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Data</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Quem</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ação</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Critérios</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Resultado</th>
              <th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>
              {data.map((h, i) => (
                <tr key={h.id || `anterior-${i}`} className="border-t align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(h.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    {h.anterior && <div className="text-xs text-muted-foreground">antes do histórico</div>}
                  </td>
                  <td className="px-3 py-2">{h.usuarioNome ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{ACAO[h.acao] ?? h.acao}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {descreverFiltro(h.filtros as FiltroCarteira).map(c => (
                        <span key={c} className="text-xs bg-muted rounded px-1.5 py-0.5">{c}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{resultado(h)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onUsar(h.filtros as FiltroCarteira)}>Usar este filtro</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
