import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertTriangle, Building2, CheckCircle2, RefreshCw, Upload } from "lucide-react";
import { useRef, useState } from "react";

type Arquivo = { fileName: string; conteudoBase64: string };

function lerComoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const n = (x: number) => x.toLocaleString("pt-BR");

/** Importacao do CSV exportado do site da EmpresAqui: previa (sem gravar) -> confirmar. So admin. */
export default function ImportEmpresaquiSection() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<Arquivo | null>(null);
  const utils = trpc.useUtils();

  const previa = trpc.empresas.previewCsv.useMutation({
    onError: e => {
      setArquivo(null);
      toast.error(e.message || "Não foi possível ler o arquivo.");
    },
  });
  const importar = trpc.empresas.importarCsv.useMutation({
    onSuccess: r => {
      toast.success(`${n(r.gravadas)} empresas gravadas · ${n(r.leadsVinculados)} leads vinculados.`);
      utils.empresas.doLead.invalidate();
    },
    onError: e => toast.error(e.message || "Erro ao importar."),
  });

  const selecionar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Arquivo maior que 20 MB: exporte em partes de até 5.000 CNPJs.");
      return;
    }
    importar.reset();
    const a = { fileName: file.name, conteudoBase64: await lerComoBase64(file) };
    setArquivo(a);
    previa.mutate(a);
  };

  const r = previa.data;
  const feito = importar.data;

  return (
    <div className="max-w-4xl mt-12 pt-8 border-t border-border">
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary" /> Atualizar empresas (EmpresAqui)
      </h3>
      <p className="text-sm text-muted-foreground mb-6">
        Envie o arquivo exportado do site da EmpresAqui (.csv, até 5.000 CNPJs). Primeiro aparece uma prévia; nada é
        gravado até você confirmar. Os dados do lead (nome, telefone, e-mail, CPF e contatos) nunca são alterados: a
        importação só atualiza os dados oficiais da empresa e liga cada lead à empresa pelo CNPJ.
      </p>

      <div className="border-2 border-dashed border-border rounded-xl p-6 text-center mb-6 hover:border-primary/50 transition-colors">
        <input ref={inputRef} type="file" accept=".csv,.txt" onChange={selecionar} className="hidden" />
        <Button variant="outline" onClick={() => inputRef.current?.click()} className="gap-2" disabled={previa.isPending || importar.isPending}>
          <Upload className="h-4 w-4" /> Selecionar arquivo da EmpresAqui
        </Button>
        {arquivo && <p className="text-xs text-muted-foreground mt-3">{arquivo.fileName}</p>}
      </div>

      {previa.isPending && (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Lendo o arquivo…</p>
      )}

      {r && arquivo && !feito && (
        <div className="bg-white rounded-xl border border-border p-6 space-y-4">
          <h4 className="font-semibold">Prévia (nada foi gravado)</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="rounded-lg bg-muted/50 p-3"><div className="text-xl font-bold">{n(r.empresasNoArquivo)}</div><div className="text-xs text-muted-foreground">empresas no arquivo</div></div>
            <div className="rounded-lg bg-muted/50 p-3"><div className="text-xl font-bold">{n(r.novas)}</div><div className="text-xs text-muted-foreground">novas</div></div>
            <div className="rounded-lg bg-muted/50 p-3"><div className="text-xl font-bold">{n(r.atualizadas)}</div><div className="text-xs text-muted-foreground">já existentes (atualizar)</div></div>
            <div className="rounded-lg bg-primary/10 p-3"><div className="text-xl font-bold text-primary">{n(r.leadsAVincular)}</div><div className="text-xs text-muted-foreground">leads serão vinculados</div></div>
          </div>
          {r.empresasSemLeadAinda > 0 && (
            <p className="text-xs text-muted-foreground">
              {n(r.empresasSemLeadAinda)} empresa(s) ainda sem lead no PARR: serão gravadas e ligadas automaticamente quando o edital for importado.
            </p>
          )}
          {r.alertas.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="text-sm font-medium text-amber-800 flex items-center gap-1.5 mb-1"><AlertTriangle className="h-4 w-4" /> Avisos do arquivo</div>
              <ul className="text-xs text-amber-900 space-y-0.5">
                {r.alertas.map(a => <li key={a.codigo}>{n(a.total)} × {a.descricao}</li>)}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setArquivo(null); previa.reset(); }} disabled={importar.isPending}>Cancelar</Button>
            <Button onClick={() => importar.mutate(arquivo)} disabled={importar.isPending}>
              {importar.isPending ? "Importando…" : `Importar ${n(r.empresasNoArquivo)} empresas`}
            </Button>
          </div>
        </div>
      )}

      {feito && (
        <div className="bg-white rounded-xl border border-green-200 p-6 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-700 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium">Importação concluída</div>
            <div className="text-muted-foreground">{n(feito.gravadas)} empresas gravadas · {n(feito.leadsVinculados)} leads vinculados nesta importação.</div>
          </div>
        </div>
      )}
    </div>
  );
}
