import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Eye, RefreshCw, Save, Send, Users, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import HistoricoCarteira from "@/components/HistoricoCarteira";
import { REGIOES, SITUACOES_CADASTRAIS, TAMANHO_MAX_GRUPOS, UFS, limparFiltro, parseCnaeDivisoes, type FiltroCarteira, type SituacaoCadastral } from "@shared/carteira";

const n = (x: number) => x.toLocaleString("pt-BR");

type Form = {
  situacoes: SituacaoCadastral[];
  dividaMin: string;
  dividaMax: string;
  ufs: string[];
  cnae: string;
  publicacaoDe: string;
  publicacaoAte: string;
  somentePrazoAberto: boolean;
  incluirSemEmpresa: boolean;
  tamanho: string;
};

const FORM_VAZIO: Form = {
  situacoes: [], dividaMin: "", dividaMax: "", ufs: [], cnae: "", publicacaoDe: "", publicacaoAte: "",
  somentePrazoAberto: false, incluirSemEmpresa: false, tamanho: "",
};

const reais = (s: string) => {
  const v = Number(s.replace(/\./g, "").replace(",", "."));
  return s.trim() === "" || Number.isNaN(v) ? null : v;
};

function paraFiltro(f: Form): FiltroCarteira {
  return limparFiltro({
    situacoes: f.situacoes, dividaMin: reais(f.dividaMin), dividaMax: reais(f.dividaMax), ufs: f.ufs,
    cnaeDivisoes: parseCnaeDivisoes(f.cnae), publicacaoDe: f.publicacaoDe || null, publicacaoAte: f.publicacaoAte || null,
    somentePrazoAberto: f.somentePrazoAberto, incluirSemEmpresa: f.incluirSemEmpresa,
    tamanhoGrupos: f.tamanho.trim() === "" ? null : Math.min(TAMANHO_MAX_GRUPOS, Number(f.tamanho) || 0),
  });
}

function paraForm(f: FiltroCarteira | null | undefined): Form {
  if (!f) return FORM_VAZIO;
  return {
    situacoes: f.situacoes ?? [], dividaMin: f.dividaMin != null ? String(f.dividaMin) : "", dividaMax: f.dividaMax != null ? String(f.dividaMax) : "",
    ufs: f.ufs ?? [], cnae: (f.cnaeDivisoes ?? []).join(", "), publicacaoDe: f.publicacaoDe ?? "", publicacaoAte: f.publicacaoAte ?? "",
    somentePrazoAberto: !!f.somentePrazoAberto, incluirSemEmpresa: !!f.incluirSemEmpresa,
    tamanho: f.tamanhoGrupos != null ? String(f.tamanhoGrupos) : "",
  };
}

const alternar = <T extends string>(lista: T[], v: T): T[] => (lista.includes(v) ? lista.filter(x => x !== v) : [...lista, v]);

/** Distribuicao de leads livres para parceiros (so admin). O grupo (mesma pessoa ou empresa) vai inteiro. */
export default function DistribuicaoTab() {
  const utils = trpc.useUtils();
  const { data: parceiros = [] } = trpc.carteira.parceiros.useQuery();
  const [parceiroId, setParceiroId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(FORM_VAZIO);
  const [aplicado, setAplicado] = useState<FiltroCarteira | null>(null);
  const [maxGrupos, setMaxGrupos] = useState("500");

  const salvo = trpc.carteira.filtroSalvo.useQuery({ responsavelId: parceiroId ?? 0 }, { enabled: parceiroId !== null });
  useEffect(() => {
    if (parceiroId !== null && salvo.isSuccess) {
      setForm(paraForm(salvo.data));
      setAplicado(null);
    }
  }, [parceiroId, salvo.isSuccess, salvo.data]);

  const previa = trpc.carteira.previa.useQuery({ filtro: aplicado ?? {} }, { enabled: aplicado !== null });
  const completarPrevia = trpc.carteira.previaCompletar.useQuery();
  const [verRedistribuicao, setVerRedistribuicao] = useState(false);
  useEffect(() => setVerRedistribuicao(false), [parceiroId]);
  const redistPrevia = trpc.carteira.previaRedistribuicao.useQuery(
    { responsavelId: parceiroId ?? 0 }, { enabled: parceiroId !== null && verRedistribuicao },
  );
  const redistribuir = trpc.carteira.redistribuir.useMutation({
    onSuccess: r => {
      toast.success(`Redistribuição feita: saíram ${n(r.saiu.leads)} lead(s) (${n(r.saiu.grupos)} grupos); entraram ${n(r.entrou.leads)} lead(s) (${n(r.entrou.grupos)} grupos).`);
      setVerRedistribuicao(false);
      utils.carteira.parceiros.invalidate();
      utils.carteira.previa.invalidate();
      utils.carteira.previaRedistribuicao.invalidate();
      utils.carteira.previaCompletar.invalidate();
      utils.carteira.historico.invalidate();
      utils.leads.coluna.invalidate();
      utils.leads.contagem.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const salvar = trpc.carteira.salvarFiltro.useMutation({
    onSuccess: () => { toast.success("Filtro salvo para o parceiro."); utils.carteira.filtroSalvo.invalidate(); utils.carteira.previaRedistribuicao.invalidate(); utils.carteira.historico.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const atribuir = trpc.carteira.atribuir.useMutation({
    onSuccess: r => {
      toast.success(`${n(r.grupos)} grupo(s) atribuído(s): ${n(r.leads)} lead(s).`);
      utils.carteira.parceiros.invalidate();
      utils.carteira.previa.invalidate();
      utils.carteira.previaCompletar.invalidate();
      utils.carteira.historico.invalidate();
      utils.leads.coluna.invalidate();
      utils.leads.contagem.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const completar = trpc.carteira.completar.useMutation({
    onSuccess: r => { toast.success(`${n(r.leads)} lead(s) entregue(s) aos donos dos grupos.`); utils.carteira.previaCompletar.invalidate(); utils.carteira.parceiros.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const parceiro = parceiros.find(p => p.id === parceiroId);
  const max = Math.max(1, Math.min(20000, Number(maxGrupos) || 0));
  // A redistribuicao usa o filtro SALVO: com alteracoes na tela sem salvar, o botao fica bloqueado.
  const temSalvo = !!salvo.data;
  const alteradoSemSalvar = JSON.stringify(paraFiltro(form)) !== JSON.stringify(limparFiltro(salvo.data ?? {}));

  return (
    <div className="max-w-5xl space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-1 flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Parceiros</h3>
        <p className="text-sm text-muted-foreground mb-3">Usuários com perfil comercial. Cada lead tem um único dono; a distribuição leva o grupo inteiro (mesma pessoa ou empresa) para evitar concorrência.</p>
        {parceiros.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum usuário comercial cadastrado. Convide em Usuários.</p>
        ) : (
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50"><tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Parceiro</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">E-mail</th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground">Leads na carteira</th>
                <th className="px-4 py-2"></th>
              </tr></thead>
              <tbody>
                {parceiros.map(p => (
                  <tr key={p.id} className={`border-t ${p.id === parceiroId ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-2">{p.nome}{p.active !== 1 && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}</td>
                    <td className="px-4 py-2 text-muted-foreground">{p.email}</td>
                    <td className="px-4 py-2 text-right">{n(p.leads)}</td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant={p.id === parceiroId ? "default" : "outline"} disabled={p.active !== 1} onClick={() => setParceiroId(p.id)}>
                        {p.id === parceiroId ? "Selecionado" : "Distribuir"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {parceiro && (
        <section className="bg-white rounded-xl border border-border p-6 space-y-5">
          <h3 className="text-lg font-semibold">Filtro da carteira de {parceiro.nome}</h3>

          <div>
            <div className="text-sm font-medium mb-1">Situação cadastral da empresa (EmpresAqui)</div>
            <div className="flex flex-wrap gap-3 text-sm">
              {SITUACOES_CADASTRAIS.map(s => (
                <label key={s} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={form.situacoes.includes(s)} onChange={() => setForm({ ...form, situacoes: alternar(form.situacoes, s) })} /> {s}
                </label>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium mb-1">Dívida ativa (R$)</div>
              <div className="flex items-center gap-2">
                <Input placeholder="mínimo" value={form.dividaMin} onChange={e => setForm({ ...form, dividaMin: e.target.value })} className="h-8" />
                <span className="text-muted-foreground text-sm">a</span>
                <Input placeholder="máximo" value={form.dividaMax} onChange={e => setForm({ ...form, dividaMax: e.target.value })} className="h-8" />
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-1">CNAE (divisão, 2 dígitos)</div>
              <Input placeholder="ex.: 86, 47, 41" value={form.cnae} onChange={e => setForm({ ...form, cnae: e.target.value })} className="h-8" />
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Região / UF</div>
            <div className="flex flex-wrap gap-2 mb-2">
              {Object.entries(REGIOES).map(([reg, ufs]) => {
                const todas = ufs.every(u => form.ufs.includes(u));
                return (
                  <Button key={reg} type="button" size="sm" variant={todas ? "default" : "outline"} className="h-7 text-xs"
                    onClick={() => setForm({ ...form, ufs: todas ? form.ufs.filter(u => !ufs.includes(u)) : Array.from(new Set([...form.ufs, ...ufs])) })}>
                    {reg}
                  </Button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {UFS.map(u => (
                <label key={u} className="flex items-center gap-1">
                  <input type="checkbox" checked={form.ufs.includes(u)} onChange={() => setForm({ ...form, ufs: alternar(form.ufs, u) })} /> {u}
                </label>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium mb-1">Publicação do edital (mais recente do lead)</div>
              <div className="flex items-center gap-2">
                <Input type="date" value={form.publicacaoDe} onChange={e => setForm({ ...form, publicacaoDe: e.target.value })} className="h-8" />
                <span className="text-muted-foreground text-sm">a</span>
                <Input type="date" value={form.publicacaoAte} onChange={e => setForm({ ...form, publicacaoAte: e.target.value })} className="h-8" />
              </div>
            </div>
            <div className="space-y-1 text-sm pt-5">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.somentePrazoAberto} onChange={e => setForm({ ...form, somentePrazoAberto: e.target.checked })} />
                Só com prazo de impugnação aberto
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.incluirSemEmpresa} onChange={e => setForm({ ...form, incluirSemEmpresa: e.target.checked })} />
                Incluir leads ainda sem dados da EmpresAqui
              </label>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Tamanho da carteira (grupos)</div>
            <Input placeholder="ex.: 500" value={form.tamanho} onChange={e => setForm({ ...form, tamanho: e.target.value.replace(/\D/g, "") })} className="h-8 w-32" />
            <p className="text-xs text-muted-foreground mt-1">Usado pela redistribuição para completar a carteira até esse número de grupos.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setAplicado(paraFiltro(form))}><Eye className="h-4 w-4 mr-1" /> Pré-visualizar</Button>
            <Button variant="outline" disabled={salvar.isPending} onClick={() => salvar.mutate({ responsavelId: parceiro.id, filtro: paraFiltro(form) })}>
              <Save className="h-4 w-4 mr-1" /> Salvar filtro do parceiro
            </Button>
            <Button variant="ghost" onClick={() => { setForm(FORM_VAZIO); setAplicado(null); }}>Limpar</Button>
          </div>

          {aplicado && (
            <div className="rounded-lg border border-border p-4 space-y-3">
              {previa.isLoading ? (
                <p className="text-sm text-muted-foreground">Calculando…</p>
              ) : previa.data ? (
                <>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-muted/50 p-3"><div className="text-xl font-bold">{n(previa.data.leadsQueAtendem)}</div><div className="text-xs text-muted-foreground">leads livres atendem ao filtro</div></div>
                    <div className="rounded-lg bg-muted/50 p-3"><div className="text-xl font-bold">{n(previa.data.grupos)}</div><div className="text-xs text-muted-foreground">grupos</div></div>
                    <div className="rounded-lg bg-primary/10 p-3"><div className="text-xl font-bold text-primary">{n(previa.data.leadsNosGrupos)}</div><div className="text-xs text-muted-foreground">leads irão (grupos inteiros)</div></div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>Atribuir até</span>
                    <Input value={maxGrupos} onChange={e => setMaxGrupos(e.target.value.replace(/\D/g, ""))} className="h-8 w-24" />
                    <span>grupos (editais mais recentes primeiro) a <strong>{parceiro.nome}</strong></span>
                    <Button disabled={atribuir.isPending || previa.data.grupos === 0}
                      onClick={() => { if (confirm(`Atribuir até ${n(max)} grupo(s) a ${parceiro.nome}?`)) atribuir.mutate({ responsavelId: parceiro.id, filtro: aplicado, maxGrupos: max }); }}>
                      <Send className="h-4 w-4 mr-1" /> {atribuir.isPending ? "Atribuindo…" : "Atribuir"}
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          )}

          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="text-sm font-semibold flex items-center gap-2"><RefreshCw className="h-4 w-4 text-primary" /> Redistribuir conforme o filtro salvo</div>
            <p className="text-xs text-muted-foreground">
              Saem da carteira os grupos parados (todos em Novo lead, sem nota, mudança de coluna, reunião, contato editado ou arquivamento)
              que não atendem mais ao filtro salvo; eles voltam aos leads livres. Depois a carteira é completada até o tamanho salvo.
              Um lead trabalhado segura o grupo inteiro com o parceiro.
            </p>
            {!temSalvo ? (
              <p className="text-sm text-muted-foreground">Salve o filtro do parceiro para poder redistribuir.</p>
            ) : alteradoSemSalvar ? (
              <p className="text-sm text-amber-700">Há alterações no filtro que ainda não foram salvas. Salve antes de redistribuir.</p>
            ) : !verRedistribuicao ? (
              <Button variant="outline" size="sm" onClick={() => setVerRedistribuicao(true)}><Eye className="h-4 w-4 mr-1" /> Calcular redistribuição</Button>
            ) : redistPrevia.isLoading ? (
              <p className="text-sm text-muted-foreground">Calculando…</p>
            ) : redistPrevia.data ? (
              <>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-muted/50 p-3"><div className="text-xl font-bold">{n(redistPrevia.data.saemLeads)}</div><div className="text-xs text-muted-foreground">leads saem ({n(redistPrevia.data.saemGrupos)} grupos)</div></div>
                  <div className="rounded-lg bg-muted/50 p-3"><div className="text-xl font-bold">{n(redistPrevia.data.ficamGrupos)}</div><div className="text-xs text-muted-foreground">grupos ficam{redistPrevia.data.tamanho != null ? ` (tamanho salvo: ${n(redistPrevia.data.tamanho)})` : " (sem tamanho salvo)"}</div></div>
                  <div className="rounded-lg bg-primary/10 p-3"><div className="text-xl font-bold text-primary">{n(redistPrevia.data.entramLeads)}</div><div className="text-xs text-muted-foreground">leads entram ({n(redistPrevia.data.entramGrupos)} grupos)</div></div>
                </div>
                <Button disabled={redistribuir.isPending || (redistPrevia.data.saemGrupos === 0 && redistPrevia.data.entramGrupos === 0)}
                  onClick={() => {
                    const d = redistPrevia.data!;
                    if (confirm(`Redistribuir a carteira de ${parceiro.nome}?\n\nSaem ${n(d.saemLeads)} lead(s) (${n(d.saemGrupos)} grupos) e entram ${n(d.entramLeads)} lead(s) (${n(d.entramGrupos)} grupos).`)) {
                      redistribuir.mutate({ responsavelId: parceiro.id });
                    }
                  }}>
                  <RefreshCw className="h-4 w-4 mr-1" /> {redistribuir.isPending ? "Redistribuindo…" : "Redistribuir"}
                </Button>
              </>
            ) : null}
          </div>

          <HistoricoCarteira responsavelId={parceiro.id} onUsar={f => {
            setForm(paraForm(f));
            setAplicado(null);
            toast.info("Critérios carregados no formulário. Revise e clique em Salvar filtro do parceiro para valer.");
          }} />
        </section>
      )}

      <section className="bg-white rounded-xl border border-border p-6">
        <h3 className="text-base font-semibold mb-1 flex items-center gap-2"><Wand2 className="h-4 w-4 text-primary" /> Completar grupos já atribuídos</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Leads novos (por exemplo, de um edital recém-importado) que pertencem a um grupo que já tem dono vão para o mesmo parceiro.
        </p>
        <div className="flex items-center gap-3 text-sm">
          <span>{completarPrevia.data ? `${n(completarPrevia.data.leads)} lead(s) a entregar` : "…"}
            {completarPrevia.data && completarPrevia.data.conflitos > 0 ? ` · ${n(completarPrevia.data.conflitos)} em grupos com mais de um dono (ficam de fora)` : ""}</span>
          <Button size="sm" variant="outline" disabled={!completarPrevia.data?.leads || completar.isPending} onClick={() => completar.mutate()}>Completar</Button>
        </div>
      </section>
    </div>
  );
}
