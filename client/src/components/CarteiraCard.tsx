import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Archive, Briefcase, RotateCcw, Undo2 } from "lucide-react";
import { useState } from "react";
import { MOTIVOS_ARQUIVAMENTO, type MotivoArquivamento } from "@shared/carteira";

const ROTULO_EVENTO: Record<string, string> = {
  atribuido: "Atribuído",
  devolvido: "Devolvido à fila",
  transferido: "Transferido",
  arquivado: "Arquivado",
  reaberto: "Reaberto",
};

const dataHora = (d: Date | string) =>
  new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Carteira do lead: dono, acoes (devolver/arquivar; admin tambem transfere e reabre) e trilha de eventos. */
export default function CarteiraCard({ leadId, isAdmin, onSaiuDaCarteira }: { leadId: number; isAdmin: boolean; onSaiuDaCarteira: () => void }) {
  const utils = trpc.useUtils();
  const { data: c } = trpc.carteira.doLead.useQuery({ leadId });
  const { data: parceiros = [] } = trpc.carteira.parceiros.useQuery(undefined, { enabled: isAdmin });
  const [arquivando, setArquivando] = useState<{ motivo: MotivoArquivamento | ""; detalhe: string } | null>(null);
  const [para, setPara] = useState<string>("");

  const recarregar = () => {
    utils.carteira.doLead.invalidate({ leadId });
    utils.leads.coluna.invalidate();
    utils.leads.contagem.invalidate();
  };
  const devolver = trpc.carteira.devolver.useMutation({
    onSuccess: r => { toast.success(`${r.leads} lead(s) devolvido(s) à fila.`); recarregar(); if (!isAdmin) onSaiuDaCarteira(); },
    onError: e => toast.error(e.message),
  });
  const arquivar = trpc.carteira.arquivar.useMutation({
    onSuccess: () => { toast.success("Lead arquivado."); setArquivando(null); recarregar(); },
    onError: e => toast.error(e.message),
  });
  const reabrir = trpc.carteira.reabrir.useMutation({ onSuccess: () => { toast.success("Lead reaberto."); recarregar(); }, onError: e => toast.error(e.message) });
  const transferir = trpc.carteira.transferir.useMutation({
    onSuccess: r => { toast.success(`${r.leads} lead(s) transferido(s).`); setPara(""); recarregar(); },
    onError: e => toast.error(e.message),
  });

  if (!c) return null;
  const grupo = c.leadsNoGrupo > 1 ? ` (o grupo inteiro: ${c.leadsNoGrupo} leads da mesma pessoa ou empresa)` : "";

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
        <Briefcase className="h-5 w-5 text-primary" /> Carteira
      </h2>

      <div className="text-sm space-y-1">
        <div>
          <span className="text-muted-foreground">Responsável: </span>
          {c.responsavelId ? (isAdmin ? c.responsavelNome ?? `#${c.responsavelId}` : "Você") : <span className="text-muted-foreground">Fila livre</span>}
        </div>
        {c.atribuidoEm && <div className="text-xs text-muted-foreground">Atribuído em {dataHora(c.atribuidoEm)}</div>}
        {c.leadsNoGrupo > 1 && <div className="text-xs text-muted-foreground">Grupo com {c.leadsNoGrupo} leads (mesma pessoa ou empresa)</div>}
        {c.arquivadoEm && (
          <div className="text-xs rounded border border-amber-200 bg-amber-50 text-amber-800 px-2 py-1 mt-2">
            Arquivado em {dataHora(c.arquivadoEm)} · {MOTIVOS_ARQUIVAMENTO[c.arquivadoMotivo as MotivoArquivamento] ?? c.arquivadoMotivo}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {c.responsavelId && !c.arquivadoEm && (
          <Button variant="outline" size="sm" className="w-full justify-start" disabled={devolver.isPending}
            onClick={() => { if (confirm(`Devolver à fila livre${grupo}?`)) devolver.mutate({ leadId }); }}>
            <Undo2 className="h-4 w-4 mr-2" /> Devolver à fila
          </Button>
        )}

        {!c.arquivadoEm && (arquivando ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Select value={arquivando.motivo} onValueChange={v => setArquivando({ ...arquivando, motivo: v as MotivoArquivamento })}>
              <SelectTrigger size="sm" className="w-full text-sm"><SelectValue placeholder="Motivo do arquivamento" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(MOTIVOS_ARQUIVAMENTO) as MotivoArquivamento[]).map(m => <SelectItem key={m} value={m}>{MOTIVOS_ARQUIVAMENTO[m]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={arquivando.detalhe} placeholder={arquivando.motivo === "outro" ? "Descreva o motivo (obrigatório)" : "Detalhe (opcional)"}
              onChange={e => setArquivando({ ...arquivando, detalhe: e.target.value })} className="h-8 text-sm" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setArquivando(null)}>Cancelar</Button>
              <Button size="sm" disabled={!arquivando.motivo || arquivar.isPending}
                onClick={() => arquivar.mutate({ leadId, motivo: arquivando.motivo as MotivoArquivamento, detalhe: arquivando.detalhe || undefined })}>
                Arquivar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setArquivando({ motivo: "", detalhe: "" })}>
            <Archive className="h-4 w-4 mr-2" /> Arquivar (sai do Kanban)
          </Button>
        ))}

        {isAdmin && c.arquivadoEm && (
          <Button variant="outline" size="sm" className="w-full justify-start" disabled={reabrir.isPending} onClick={() => reabrir.mutate({ leadId })}>
            <RotateCcw className="h-4 w-4 mr-2" /> Reabrir
          </Button>
        )}

        {isAdmin && (
          <div className="flex gap-2 pt-1">
            <Select value={para} onValueChange={setPara}>
              <SelectTrigger size="sm" className="flex-1 text-sm"><SelectValue placeholder="Transferir para…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fila">Fila livre (sem dono)</SelectItem>
                {parceiros.filter(p => p.active === 1).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={!para || transferir.isPending}
              onClick={() => { if (confirm(`Transferir${grupo}?`)) transferir.mutate({ leadId, para: para === "fila" ? null : Number(para) }); }}>
              Transferir
            </Button>
          </div>
        )}
      </div>

      {c.eventos.length > 0 && (
        <ul className="mt-4 pt-3 border-t border-border space-y-1 text-xs text-muted-foreground">
          {c.eventos.map(e => (
            <li key={e.id}>
              {dataHora(e.createdAt)} · <span className="text-foreground">{ROTULO_EVENTO[e.tipo] ?? e.tipo}</span>
              {e.usuarioNome ? ` por ${e.usuarioNome}` : ""}
              {e.motivo ? ` · ${MOTIVOS_ARQUIVAMENTO[e.motivo.split(":")[0] as MotivoArquivamento] ?? e.motivo}${e.motivo.includes(":") ? ` (${e.motivo.split(":").slice(1).join(":").trim()})` : ""}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
