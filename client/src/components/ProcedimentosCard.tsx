import { trpc } from "@/lib/trpc";
import { FileText } from "lucide-react";
import { useState } from "react";
import { hojeIso, situacaoPrazo, type SituacaoPrazo } from "@shared/editais";

const COR_PRAZO: Record<SituacaoPrazo["nivel"], string> = {
  critico: "bg-red-50 text-red-700 border-red-200",
  atencao: "bg-amber-50 text-amber-800 border-amber-200",
  aberto: "bg-[oklch(0.95_0.03_185)] text-[oklch(0.45_0.1_185)] border-[oklch(0.85_0.05_185)]",
  encerrado: "bg-muted text-muted-foreground border-border",
};

const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const INICIAIS = 5;

/** Editais PGFN e procedimentos (PARR) do lead, com o prazo estimado de impugnacao do edital mais recente. */
export default function ProcedimentosCard({ leadId }: { leadId: number }) {
  const { data: procs = [] } = trpc.leads.procedimentos.useQuery({ leadId });
  const [todos, setTodos] = useState(false);
  if (procs.length === 0) return null;

  const prazo = situacaoPrazo(procs[0].dataPublicacao, hojeIso());
  const visiveis = todos ? procs : procs.slice(0, INICIAIS);

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="flex items-start justify-between gap-2 mb-3">
        <h2 className="font-bold text-lg flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" /> Editais
        </h2>
        <span className="text-xs text-muted-foreground mt-1">{procs.length} procedimento{procs.length === 1 ? "" : "s"}</span>
      </div>

      {prazo && (
        <div className={`text-xs px-2 py-1 rounded border mb-3 ${COR_PRAZO[prazo.nivel]}`}>
          {prazo.rotulo}
          <div className="text-[10px] opacity-80">Publicação do edital mais recente + 30 dias corridos, prorrogado para o 1º dia útil (fins de semana e feriados nacionais)</div>
        </div>
      )}

      <ul className="space-y-2 text-xs">
        {visiveis.map(p => (
          <li key={p.id} className="border-l-2 border-primary/20 pl-2">
            <div className="font-medium">Edital nº {p.editalNumero}/{p.editalAno} · {dataBr(p.dataPublicacao)}</div>
            <div className="text-muted-foreground">
              Procedimento {p.numeroProcedimento}
              {p.cpfParcial ? ` · ${p.cpfParcial}` : ""}
              {p.pagina ? ` · p. ${p.pagina}` : ""}
            </div>
          </li>
        ))}
      </ul>
      {procs.length > INICIAIS && (
        <button className="mt-2 text-xs text-primary hover:underline" onClick={() => setTodos(v => !v)}>
          {todos ? "mostrar menos" : `ver todos os ${procs.length}`}
        </button>
      )}
    </div>
  );
}
