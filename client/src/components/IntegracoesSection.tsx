import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Building2, Check, Plug, X } from "lucide-react";
import { useEffect, useState } from "react";

const n = (x: number) => x.toLocaleString("pt-BR");

/**
 * Configuracoes > Integracoes (so admin). Hoje: EmpresAqui. O token mora so no servidor (variavel de ambiente):
 * a tela mostra apenas se esta configurado. Consumo do mes contado pelo PARR (a API nao informa saldo).
 */
export default function IntegracoesSection() {
  const utils = trpc.useUtils();
  const { data: ea, isLoading, error } = trpc.integracoes.empresaqui.useQuery();
  const [cacheDias, setCacheDias] = useState("");
  const [teto, setTeto] = useState("");
  const [cnpjTeste, setCnpjTeste] = useState("");

  useEffect(() => {
    if (ea) {
      setCacheDias(String(ea.cacheDias));
      setTeto(String(ea.tetoMensal));
    }
  }, [ea?.cacheDias, ea?.tetoMensal]);

  const salvar = trpc.integracoes.salvarEmpresaqui.useMutation({
    onSuccess: () => { toast.success("Configuração salva."); utils.integracoes.empresaqui.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const testar = trpc.integracoes.testarEmpresaqui.useMutation({
    onSuccess: r => {
      if (r.status === "ok") toast.success("Conexão OK: dados recebidos e gravados.");
      else if (r.status === "nao_encontrado") toast.warning("Conexão OK, mas o CNPJ não existe na EmpresAqui.");
      else toast.error("mensagem" in r ? r.mensagem : "Falha na consulta.");
      utils.integracoes.empresaqui.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  if (!ea) {
    // Nunca sumir em silencio: carregando ou erro aparecem no lugar do card.
    return (
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center gap-3 mb-1"><Plug className="h-5 w-5 text-primary" /><h4 className="font-semibold">Integrações</h4></div>
        <p className="text-sm text-muted-foreground">{isLoading ? "Carregando…" : `Não foi possível carregar as integrações${error ? `: ${error.message}` : "."}`}</p>
      </div>
    );
  }
  const pct = ea.tetoMensal > 0 ? Math.min(100, Math.round((ea.consumoMes / ea.tetoMensal) * 100)) : 100;

  return (
    <div className="bg-white rounded-xl border p-6">
      <div className="flex items-center gap-3 mb-1">
        <Plug className="h-5 w-5 text-primary" />
        <h4 className="font-semibold">Integrações</h4>
      </div>
      <p className="text-sm text-muted-foreground mb-4">Serviços externos conectados ao PARR.</p>

      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium"><Building2 className="h-4 w-4 text-primary" /> EmpresAqui (API)</div>
          {ea.tokenConfigurado ? (
            <span className="flex items-center gap-1 text-xs text-green-700"><Check className="h-3.5 w-3.5" /> Token configurado no servidor</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-amber-700"><X className="h-3.5 w-3.5" /> Token não configurado</span>
          )}
        </div>

        <div>
          <div className="flex justify-between text-sm">
            <span>Consultas neste mês</span>
            <span className="font-medium">{n(ea.consumoMes)} de {n(ea.tetoMensal)}</span>
          </div>
          <div className="h-2 rounded bg-muted mt-1 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded bg-[#008C95]" style={{ width: `${pct}%` }} />
          </div>
          {Object.keys(ea.consumoPorResultado).length > 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              {Object.entries(ea.consumoPorResultado).map(([k, v]) => `${n(v)} ${k.replace("_", " ")}`).join(" · ")}
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground mb-1">Validade do cache (dias)</span>
            <Input value={cacheDias} onChange={e => setCacheDias(e.target.value.replace(/\D/g, ""))} className="h-8" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground mb-1">Teto mensal de consultas</span>
            <Input value={teto} onChange={e => setTeto(e.target.value.replace(/\D/g, ""))} className="h-8" />
          </label>
        </div>
        <div className="flex justify-end">
          <Button size="sm" disabled={salvar.isPending || !cacheDias || !teto}
            onClick={() => salvar.mutate({ cacheDias: Number(cacheDias), tetoMensal: Number(teto) })}>
            Salvar
          </Button>
        </div>

        <div className="border-t border-border pt-3">
          <div className="text-xs text-muted-foreground mb-1">Testar conexão (gasta 1 consulta e grava os dados da empresa)</div>
          <div className="flex gap-2">
            <Input value={cnpjTeste} placeholder="CNPJ" onChange={e => setCnpjTeste(e.target.value)} className="h-8" />
            <Button size="sm" variant="outline" disabled={!ea.tokenConfigurado || testar.isPending || !cnpjTeste.trim()} onClick={() => testar.mutate({ cnpj: cnpjTeste })}>
              {testar.isPending ? "Testando…" : "Testar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
