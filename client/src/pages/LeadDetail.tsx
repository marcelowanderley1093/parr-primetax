import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  DollarSign,
  Calendar,
  Clock,
  MessageSquare,
  Send,
  User,
  FileText,
  ArrowRight,
  RefreshCw,
  Pencil,
  Save,
  X,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import CalendarModal from "@/components/CalendarModal";
import { parseSocios, whatsappDigits } from "@/lib/socios";

function formatCurrency(value: string | null): string {
  if (!value) return "";
  if (value.includes("R$")) return value;
  const num = parseFloat(value.replace(/[^\d.,\-]/g, "").replace(/\./g, "").replace(",", "."));
  if (isNaN(num)) return value;
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_LABELS: Record<string, string> = {
  novo_lead: "Novo Lead",
  contato_inicial: "Contato Inicial",
  reuniao_agendada: "Reunião Agendada",
  proposta_enviada: "Proposta Enviada",
};

const STATUS_COLORS: Record<string, string> = {
  novo_lead: "bg-blue-100 text-blue-700",
  contato_inicial: "bg-amber-100 text-amber-700",
  reuniao_agendada: "bg-purple-100 text-purple-700",
  proposta_enviada: "bg-green-100 text-green-700",
};

export default function LeadDetail() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const leadId = parseInt(params.id || "0");
  const [noteContent, setNoteContent] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState<"create" | "reschedule" | "cancel">("create");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ nome: "", email: "", telefone: "", cnpj: "", devedorPrincipal: "", valorDivida: "" });

  const utils = trpc.useUtils();
  const { data: lead, isLoading: leadLoading } = trpc.leads.getById.useQuery({ id: leadId }, { enabled: !!user && leadId > 0 });
  // telefoneSocios e somente-leitura: nenhuma rota grava; parser puro em @/lib/socios
  const socios = parseSocios(lead?.telefoneSocios);
  const { data: notes = [], isLoading: notesLoading } = trpc.leads.getNotes.useQuery({ leadId }, { enabled: !!user && leadId > 0 });
  const { data: history = [], isLoading: historyLoading } = trpc.leads.getHistory.useQuery({ leadId }, { enabled: !!user && leadId > 0 });

  const addNote = trpc.leads.addNote.useMutation({
    onSuccess: () => {
      setNoteContent("");
      utils.leads.getNotes.invalidate({ leadId });
      toast.success("Nota adicionada!");
    },
    onError: () => toast.error("Erro ao adicionar nota."),
  });

  const updateStatus = trpc.leads.updateStatus.useMutation({
    onSuccess: () => {
      utils.leads.getById.invalidate({ id: leadId });
      utils.leads.getHistory.invalidate({ leadId });
      toast.success("Status atualizado!");
    },
  });

  const updateLead = trpc.leads.update.useMutation({
    onSuccess: () => {
      utils.leads.getById.invalidate({ id: leadId });
      setEditing(false);
      toast.success("Lead atualizado!");
    },
    onError: () => toast.error("Erro ao atualizar lead."),
  });

  const deleteLeadMutation = trpc.leads.delete.useMutation({
    onSuccess: () => {
      toast.success("Lead excluído!");
      setLocation("/dashboard");
    },
    onError: () => toast.error("Erro ao excluir lead."),
  });

  const startEditing = () => {
    if (!lead) return;
    setEditForm({
      nome: lead.nome || "",
      email: lead.email || "",
      telefone: lead.telefone || "",
      cnpj: lead.cnpj || "",
      devedorPrincipal: (lead as any).devedorPrincipal || "",
      valorDivida: lead.valorDivida || "",
    });
    setEditing(true);
  };

  const saveEdit = () => {
    updateLead.mutate({
      id: leadId,
      nome: editForm.nome,
      email: editForm.email,
      telefone: editForm.telefone,
      cnpj: editForm.cnpj || undefined,
      devedorPrincipal: editForm.devedorPrincipal || undefined,
      valorDivida: editForm.valorDivida || undefined,
    });
  };

  if (loading || leadLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Button onClick={() => { window.location.href = "/login"; }}>Entrar</Button>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-muted-foreground">Lead não encontrado.</p>
        <Button variant="outline" onClick={() => setLocation("/dashboard")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar ao Painel
        </Button>
      </div>
    );
  }

  const statuses = ["novo_lead", "contato_inicial", "reuniao_agendada", "proposta_enviada"] as const;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-border">
        <div className="flex items-center h-16 px-4 md:px-6 gap-4">
          <button onClick={() => setLocation("/dashboard")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Voltar ao Painel</span>
          </button>
          <div className="h-6 w-px bg-border"></div>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">{lead.nome}</span>
          </div>
        </div>
      </header>

      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Lead Info */}
          <div className="lg:col-span-1 space-y-6">
            {/* Contact Card */}
            <div className="bg-white rounded-xl border border-border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" /> Dados do Lead
                </h2>
                <div className="flex items-center gap-1">
                  {editing ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
                      <Button size="sm" onClick={saveEdit} disabled={updateLead.isPending}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={startEditing}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => { if (confirm('Excluir este lead permanentemente?')) deleteLeadMutation.mutate({ id: leadId }); }}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  )}
                </div>
              </div>
              {editing ? (
                <div className="space-y-3">
                  <div><label className="text-xs text-muted-foreground">Nome (Dev. Solidário)</label><Input value={editForm.nome} onChange={e => setEditForm(f => ({...f, nome: e.target.value}))} className="h-8 text-sm" /></div>
                  <div><label className="text-xs text-muted-foreground">E-mail</label><Input value={editForm.email} onChange={e => setEditForm(f => ({...f, email: e.target.value}))} className="h-8 text-sm" /></div>
                  <div><label className="text-xs text-muted-foreground">Telefone</label><Input value={editForm.telefone} onChange={e => setEditForm(f => ({...f, telefone: e.target.value}))} className="h-8 text-sm" /></div>
                  <div><label className="text-xs text-muted-foreground">CNPJ</label><Input value={editForm.cnpj} onChange={e => setEditForm(f => ({...f, cnpj: e.target.value}))} className="h-8 text-sm" /></div>
                  <div><label className="text-xs text-muted-foreground">Devedor Principal</label><Input value={editForm.devedorPrincipal} onChange={e => setEditForm(f => ({...f, devedorPrincipal: e.target.value}))} className="h-8 text-sm" /></div>
                  <div><label className="text-xs text-muted-foreground">Valor da Dívida</label><Input value={editForm.valorDivida} onChange={e => setEditForm(f => ({...f, valorDivida: e.target.value}))} className="h-8 text-sm" /></div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <div className="text-xs text-muted-foreground">Nome (Dev. Solidário)</div>
                      <div className="font-medium text-sm">{lead.nome}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <div className="text-xs text-muted-foreground">E-mail</div>
                      <div className="font-medium text-sm">{lead.email}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <div className="text-xs text-muted-foreground">Telefone</div>
                      <div className="font-medium text-sm">{lead.telefone}</div>
                    </div>
                  </div>
                  {lead.cnpj && (
                    <div className="flex items-start gap-3">
                      <Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <div className="text-xs text-muted-foreground">CNPJ</div>
                        <div className="font-medium text-sm">{lead.cnpj}</div>
                      </div>
                    </div>
                  )}
                  {(lead as any).devedorPrincipal && (
                    <div className="flex items-start gap-3">
                      <Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <div className="text-xs text-muted-foreground">Devedor Principal</div>
                        <div className="font-medium text-sm">{(lead as any).devedorPrincipal}</div>
                      </div>
                    </div>
                  )}
                  {lead.valorDivida && (
                    <div className="flex items-start gap-3">
                      <DollarSign className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <div className="text-xs text-muted-foreground">Valor da Dívida</div>
                        <div className="font-medium text-sm text-[oklch(0.62_0.12_185)]">{formatCurrency(lead.valorDivida)}</div>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <div className="text-xs text-muted-foreground">Data de Entrada</div>
                      <div className="font-medium text-sm">{new Date(lead.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Socios Card (oculto quando nao ha socios validos) */}
            {socios.length > 0 && (
              <div className="bg-white rounded-xl border border-border p-6">
                <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" /> Sócios
                </h2>
                <div className="space-y-4">
                  {socios.map((socio, index) => (
                    <div key={`${socio.nome}-${index}`} className="border-l-2 border-primary/30 pl-3">
                      <div className="text-xs text-muted-foreground">Sócio {index + 1}</div>
                      <div className="font-medium text-sm flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" /> {socio.nome}
                      </div>
                      {socio.cpf && (
                        <div className="text-xs text-muted-foreground mt-0.5">CPF: {socio.cpf}</div>
                      )}
                      {socio.telefones.length > 0 && (
                        <div className="mt-1 space-y-1">
                          {socio.telefones.map((tel) => (
                            <a
                              key={tel}
                              href={`https://wa.me/${whatsappDigits(tel)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm text-primary hover:underline"
                            >
                              <Phone className="h-3.5 w-3.5" /> {tel}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status Card */}
            <div className="bg-white rounded-xl border border-border p-6">
              <h2 className="font-bold text-lg mb-4">Status Atual</h2>
              <div className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium ${STATUS_COLORS[lead.status] || ""}`}>
                {STATUS_LABELS[lead.status] || lead.status}
              </div>
              <div className="mt-4 space-y-2">
                <p className="text-xs text-muted-foreground mb-2">Alterar status:</p>
                {statuses.filter(s => s !== lead.status).map(s => (
                  <button
                    key={s}
                    onClick={() => {
                      if (s === "reuniao_agendada") {
                        setCalendarOpen(true);
                      }
                      updateStatus.mutate({ id: leadId, status: s });
                    }}
                    className={`block w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-muted transition-colors ${STATUS_COLORS[s]?.replace("bg-", "hover:bg-")}`}
                  >
                    Mover para: {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl border border-border p-6">
              <h2 className="font-bold text-lg mb-4">Ações Rápidas</h2>
              <div className="space-y-2">
                <a href={`https://wa.me/${lead.telefone?.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Phone className="h-4 w-4 mr-2" /> WhatsApp
                  </Button>
                </a>
                <a href={`mailto:${lead.email}`}>
                  <Button variant="outline" size="sm" className="w-full justify-start mt-2">
                    <Mail className="h-4 w-4 mr-2" /> Enviar E-mail
                  </Button>
                </a>
                <Button variant="outline" size="sm" className="w-full justify-start mt-2" onClick={() => { setCalendarMode("create"); setCalendarOpen(true); }}>
                  <Calendar className="h-4 w-4 mr-2" /> Agendar Reunião
                </Button>
                {lead.calendarEventId && lead.calendarEventId !== "" && (
                  <>
                    <Button variant="outline" size="sm" className="w-full justify-start mt-2" onClick={() => { setCalendarMode("reschedule"); setCalendarOpen(true); }}>
                      <RefreshCw className="h-4 w-4 mr-2" /> Remarcar Reunião
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start mt-2 text-destructive hover:text-destructive" onClick={() => { setCalendarMode("cancel"); setCalendarOpen(true); }}>
                      <Calendar className="h-4 w-4 mr-2" /> Cancelar Reunião
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Notes & History */}
          <div className="lg:col-span-2 space-y-6">
            {/* Add Note */}
            <div className="bg-white rounded-xl border border-border p-6">
              <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" /> Notas Internas
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!noteContent.trim()) return;
                  addNote.mutate({ leadId, content: noteContent });
                }}
                className="flex gap-3"
              >
                <Textarea
                  placeholder="Adicionar uma nota sobre este lead..."
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  rows={2}
                  className="flex-1"
                />
                <Button type="submit" disabled={addNote.isPending || !noteContent.trim()} className="self-end">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>

            {/* Notes List */}
            {notes.length > 0 && (
              <div className="space-y-3">
                {notes.map((note: any) => (
                  <div key={note.id} className="bg-white rounded-xl border border-border p-5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-xs font-bold text-primary">{(note.userName || "A")[0]}</span>
                        </div>
                        <span className="text-sm font-medium">{note.userName || "Admin"}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(note.createdAt).toLocaleDateString("pt-BR")} às {new Date(note.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Timeline */}
            <div className="bg-white rounded-xl border border-border p-6">
              <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" /> Timeline de Status
              </h2>
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum histórico ainda.</p>
              ) : (
                <div className="space-y-0">
                  {history.map((entry: any, i: number) => (
                    <div key={entry.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className={`w-3 h-3 rounded-full ${i === 0 ? "bg-primary" : "bg-muted-foreground/30"}`}></div>
                        {i < history.length - 1 && <div className="w-0.5 flex-1 bg-border my-1"></div>}
                      </div>
                      <div className="pb-6">
                        <div className="flex items-center gap-2 mb-1">
                          {entry.fromStatus && (
                            <>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[entry.fromStatus] || "bg-muted text-muted-foreground"}`}>
                                {STATUS_LABELS[entry.fromStatus] || entry.fromStatus}
                              </span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            </>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[entry.toStatus] || "bg-muted text-muted-foreground"}`}>
                            {STATUS_LABELS[entry.toStatus] || entry.toStatus}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {entry.userName || "Sistema"} — {new Date(entry.createdAt).toLocaleDateString("pt-BR")} às {new Date(entry.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Modal */}
      {calendarOpen && (
        <CalendarModal
          leadId={leadId}
          mode={calendarMode}
          existingEventId={lead.calendarEventId || undefined}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </div>
  );
}
