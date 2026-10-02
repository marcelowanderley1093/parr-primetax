import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Check, Mail, MessageCircle, Pencil, Phone, Plus, Star, Trash2, User, Users, X } from "lucide-react";
import { useState } from "react";
import {
  STATUS_CONTATO,
  STATUS_CONTATO_LABEL,
  STATUS_DESCARTADO,
  agruparContatos,
  cpfValido,
  emailValido,
  formatarCpf,
  formatarTelefone,
  linkWhatsapp,
  normalizarTelefone,
  type StatusContato,
} from "@shared/contatos";

const STATUS_COR: Record<StatusContato, string> = {
  nao_testado: "text-muted-foreground",
  atende: "text-green-700",
  whatsapp: "text-green-700",
  numero_errado: "text-destructive",
  nao_e_o_socio: "text-destructive",
};

function dataCurta(d: Date | string): string {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Valida no navegador para dar mensagem clara antes de ir ao servidor (que valida de novo). */
function validarValor(tipo: "telefone" | "email", valor: string): string | null {
  if (tipo === "telefone") return normalizarTelefone(valor) ? null : "Telefone inválido: informe DDD + número.";
  return emailValido(valor) ? null : "E-mail inválido.";
}

type Props = { leadId: number; nomeLead: string };

export default function ContatosCard({ leadId, nomeLead }: Props) {
  const utils = trpc.useUtils();
  const { data: contatos = [], isLoading } = trpc.contatos.list.useQuery({ leadId });
  const invalidar = () => utils.contatos.list.invalidate({ leadId });

  const criar = trpc.contatos.create.useMutation({
    onSuccess: () => { invalidar(); toast.success("Contato adicionado."); },
    onError: e => toast.error(e.message || "Erro ao adicionar contato."),
  });
  const atualizar = trpc.contatos.update.useMutation({
    onSuccess: () => invalidar(),
    onError: e => toast.error(e.message || "Erro ao salvar contato."),
  });
  const excluir = trpc.contatos.delete.useMutation({
    onSuccess: () => { invalidar(); toast.success("Contato excluído."); },
    onError: () => toast.error("Erro ao excluir contato."),
  });

  // Edicao de observacao (um contato por vez)
  const [obsEditando, setObsEditando] = useState<{ id: number; texto: string } | null>(null);
  // Novo telefone dentro de um grupo (chave do grupo -> texto)
  const [novoTelefone, setNovoTelefone] = useState<{ chave: string; valor: string } | null>(null);
  // Nova pessoa/contato
  const [novaPessoa, setNovaPessoa] = useState<{ nome: string; tipo: "telefone" | "email"; valor: string } | null>(null);

  const grupos = agruparContatos(contatos, nomeLead);
  const telefones = contatos.filter(c => c.tipo === "telefone");
  const atendem = telefones.filter(c => c.status === "atende" || c.status === "whatsapp").length;

  const adicionar = (pessoaNome: string | null, pessoaCpf: string | null, tipo: "telefone" | "email", valor: string, depois: () => void) => {
    const erro = validarValor(tipo, valor);
    if (erro) { toast.error(erro); return; }
    criar.mutate(
      { leadId, pessoaNome: pessoaNome ?? undefined, pessoaCpf: pessoaCpf ?? undefined, tipo, valor },
      { onSuccess: depois },
    );
  };

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="font-bold text-lg flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" /> Contatos
        </h2>
        {telefones.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {telefones.length} telefone{telefones.length === 1 ? "" : "s"} · {atendem} atende{atendem === 1 ? "" : "m"}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : grupos.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-4">Nenhum contato cadastrado.</p>
      ) : (
        <div className="space-y-5">
          {grupos.map(g => {
            const chave = `${g.pessoaNome ?? ""}|${g.pessoaCpf ?? ""}`;
            return (
              <div key={chave} className={`border-l-2 pl-3 ${g.intimado ? "border-primary" : "border-primary/30"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {g.intimado ? <Star className="h-4 w-4 text-primary fill-primary" /> : <User className="h-4 w-4 text-muted-foreground" />}
                    <span>{g.pessoaNome || "Sem nome"}</span>
                    {g.intimado && <span className="text-xs text-primary">(intimado)</span>}
                  </div>
                </div>
                {g.pessoaCpf && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    CPF: {formatarCpf(g.pessoaCpf)}
                    {!cpfValido(g.pessoaCpf) && <span className="ml-1 text-amber-700">(CPF inválido)</span>}
                  </div>
                )}

                <ul className="mt-2 space-y-2">
                  {g.contatos.map(c => {
                    const descartado = STATUS_DESCARTADO.has(c.status);
                    const editandoObs = obsEditando?.id === c.id;
                    return (
                      <li key={c.id} className="text-sm">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`flex items-center gap-1.5 min-w-[9.5rem] ${descartado ? "line-through text-muted-foreground" : ""}`}>
                            {c.tipo === "telefone" ? <Phone className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                            {c.tipo === "telefone" ? formatarTelefone(c.valor) : c.valor}
                          </span>
                          <Select
                            value={c.status}
                            onValueChange={v => atualizar.mutate({ id: c.id, status: v as StatusContato })}
                          >
                            <SelectTrigger size="sm" className={`h-7 w-[8.5rem] text-xs ${STATUS_COR[c.status]}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_CONTATO.map(s => (
                                <SelectItem key={s} value={s} className="text-xs">{STATUS_CONTATO_LABEL[s]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center">
                            {c.tipo === "telefone" ? (
                              <a href={linkWhatsapp(c.valor)} target="_blank" rel="noopener noreferrer" title="Abrir no WhatsApp">
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MessageCircle className="h-4 w-4 text-green-700" /></Button>
                              </a>
                            ) : (
                              <a href={`mailto:${c.valor}`} title="Enviar e-mail">
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Mail className="h-4 w-4" /></Button>
                              </a>
                            )}
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Observação"
                              onClick={() => setObsEditando({ id: c.id, texto: c.observacao ?? "" })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Excluir"
                              onClick={() => {
                                const rotulo = c.tipo === "telefone" ? formatarTelefone(c.valor) : c.valor;
                                if (confirm(`Excluir o contato ${rotulo}?`)) excluir.mutate({ id: c.id });
                              }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        {editandoObs ? (
                          <div className="flex items-center gap-1 mt-1">
                            <Input autoFocus value={obsEditando.texto} placeholder="Ex.: atende só à tarde; é a secretária"
                              onChange={e => setObsEditando({ id: c.id, texto: e.target.value })}
                              onKeyDown={e => {
                                if (e.key === "Enter") atualizar.mutate({ id: c.id, observacao: obsEditando.texto }, { onSuccess: () => setObsEditando(null) });
                                if (e.key === "Escape") setObsEditando(null);
                              }}
                              className="h-7 text-xs" />
                            <Button size="sm" className="h-7 w-7 p-0" disabled={atualizar.isPending}
                              onClick={() => atualizar.mutate({ id: c.id, observacao: obsEditando.texto }, { onSuccess: () => setObsEditando(null) })}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setObsEditando(null)}><X className="h-3.5 w-3.5" /></Button>
                          </div>
                        ) : c.observacao ? (
                          <div className="text-xs text-muted-foreground mt-0.5 ml-5 whitespace-pre-wrap">{c.observacao}</div>
                        ) : null}
                        {c.atualizadoPorNome && (
                          <div className="text-[11px] text-muted-foreground/80 ml-5">
                            {c.atualizadoPorNome}, {dataCurta(c.updatedAt)}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {novoTelefone?.chave === chave ? (
                  <div className="flex items-center gap-1 mt-2">
                    <Input autoFocus value={novoTelefone.valor} placeholder="(11) 91234-5678"
                      onChange={e => setNovoTelefone({ chave, valor: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === "Enter") adicionar(g.pessoaNome, g.pessoaCpf, "telefone", novoTelefone.valor, () => setNovoTelefone(null));
                        if (e.key === "Escape") setNovoTelefone(null);
                      }}
                      className="h-7 text-xs" />
                    <Button size="sm" className="h-7 w-7 p-0" disabled={criar.isPending}
                      onClick={() => adicionar(g.pessoaNome, g.pessoaCpf, "telefone", novoTelefone.valor, () => setNovoTelefone(null))}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setNovoTelefone(null)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <button className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
                    onClick={() => setNovoTelefone({ chave, valor: "" })}>
                    <Plus className="h-3 w-3" /> adicionar telefone
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-border">
        {novaPessoa ? (
          <div className="space-y-2">
            <Input value={novaPessoa.nome} placeholder="Nome da pessoa (opcional)"
              onChange={e => setNovaPessoa({ ...novaPessoa, nome: e.target.value })} className="h-8 text-sm" />
            <div className="flex gap-2">
              <Select value={novaPessoa.tipo} onValueChange={v => setNovaPessoa({ ...novaPessoa, tipo: v as "telefone" | "email" })}>
                <SelectTrigger size="sm" className="h-8 w-[7.5rem] text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="telefone">Telefone</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                </SelectContent>
              </Select>
              <Input value={novaPessoa.valor} placeholder={novaPessoa.tipo === "telefone" ? "(11) 91234-5678" : "nome@empresa.com.br"}
                onChange={e => setNovaPessoa({ ...novaPessoa, valor: e.target.value })} className="h-8 text-sm flex-1" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setNovaPessoa(null)}>Cancelar</Button>
              <Button size="sm" disabled={criar.isPending}
                onClick={() => adicionar(novaPessoa.nome.trim() || null, null, novaPessoa.tipo, novaPessoa.valor, () => setNovaPessoa(null))}>
                Adicionar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setNovaPessoa({ nome: "", tipo: "telefone", valor: "" })}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar contato
          </Button>
        )}
      </div>
    </div>
  );
}
