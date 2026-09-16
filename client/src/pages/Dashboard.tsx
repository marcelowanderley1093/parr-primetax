import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Users,
  Phone,
  Mail,
  Calendar as CalendarIcon,
  GripVertical,
  Eye,
  Search,
  RefreshCw,
  Upload,
  Settings,
  Link2,
  Unlink,
  FileSpreadsheet,
  Video,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Pencil,
  Building2,
  Save,
} from "lucide-react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import CalendarModal from "@/components/CalendarModal";

type LeadStatus = "novo_lead" | "contato_inicial" | "reuniao_agendada" | "proposta_enviada";

interface Lead {
  id: number;
  nome: string;
  email: string;
  telefone: string;
  cnpj: string | null;
  devedorPrincipal: string | null;
  valorDivida: string | null;
  mensagem: string | null;
  calendarEventId: string | null;
  status: LeadStatus;
  createdAt: Date;
}

function formatCurrency(value: string | null): string {
  if (!value) return "";
  // If already formatted with R$, return as-is
  if (value.includes("R$")) return value;
  // Try to parse as number
  const num = parseFloat(value.replace(/[^\d.,\-]/g, "").replace(/\./g, "").replace(",", "."));
  if (isNaN(num)) return value;
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bgColor: string; borderColor: string }> = {
  novo_lead: { label: "Novo Lead", color: "text-blue-700", bgColor: "bg-blue-50", borderColor: "border-blue-200" },
  contato_inicial: { label: "Contato Inicial", color: "text-amber-700", bgColor: "bg-amber-50", borderColor: "border-amber-200" },
  reuniao_agendada: { label: "Reunião Agendada", color: "text-purple-700", bgColor: "bg-purple-50", borderColor: "border-purple-200" },
  proposta_enviada: { label: "Proposta Enviada", color: "text-green-700", bgColor: "bg-green-50", borderColor: "border-green-200" },
};

const COLUMN_ORDER: LeadStatus[] = ["novo_lead", "contato_inicial", "reuniao_agendada", "proposta_enviada"];

type DashboardTab = "kanban" | "calendar" | "import" | "settings";

function KanbanCard({ lead, onDragStart, onClick, onDelete }: { lead: Lead; onDragStart: (e: React.DragEvent, lead: Lead) => void; onClick: () => void; onDelete: (id: number) => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead)}
      onClick={onClick}
      className="bg-white rounded-lg border border-border p-4 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
          <h4 className="font-semibold text-sm text-foreground truncate max-w-[140px]">{lead.nome}</h4>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); onClick(); }} className="p-1 rounded hover:bg-muted transition-colors" title="Editar">
            <Pencil className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); if (confirm('Excluir este cliente?')) onDelete(lead.id); }} className="p-1 rounded hover:bg-red-50 transition-colors" title="Excluir">
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-red-500 transition-colors" />
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mail className="h-3 w-3 shrink-0" />
          <span className="truncate">{lead.email}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Phone className="h-3 w-3 shrink-0" />
          <span>{lead.telefone}</span>
        </div>
        {lead.cnpj && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">CNPJ:</span>
            <span>{lead.cnpj}</span>
          </div>
        )}
        {lead.devedorPrincipal && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3 shrink-0" />
            <span className="truncate" title={lead.devedorPrincipal}>{lead.devedorPrincipal}</span>
          </div>
        )}
        {lead.valorDivida && (
          <div className="text-xs font-medium text-[oklch(0.62_0.12_185)]">
            Dívida: {formatCurrency(lead.valorDivida)}
          </div>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {new Date(lead.createdAt).toLocaleDateString("pt-BR")}
        </span>
      </div>
    </div>
  );
}

function KanbanColumn({ status, leads, onDragStart, onDrop, onDragOver, onCardClick, onDeleteLead, isDragOver }: {
  status: LeadStatus; leads: Lead[];
  onDragStart: (e: React.DragEvent, lead: Lead) => void;
  onDrop: (e: React.DragEvent, status: LeadStatus) => void;
  onDragOver: (e: React.DragEvent, status: LeadStatus) => void;
  onCardClick: (lead: Lead) => void;
  onDeleteLead: (id: number) => void;
  isDragOver: boolean;
}) {
  const config = STATUS_CONFIG[status];
  return (
    <div
      className={`flex flex-col min-w-[260px] max-w-[320px] flex-1 rounded-xl ${isDragOver ? "ring-2 ring-primary/30" : ""} transition-all`}
      onDragOver={(e) => onDragOver(e, status)}
      onDrop={(e) => onDrop(e, status)}
    >
      <div className={`flex items-center justify-between px-4 py-3 rounded-t-xl ${config.bgColor} border ${config.borderColor}`}>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${config.color.replace("text-", "bg-")}`}></div>
          <h3 className={`font-semibold text-sm ${config.color}`}>{config.label}</h3>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${config.bgColor} ${config.color} border ${config.borderColor}`}>
          {leads.length}
        </span>
      </div>
      <div className={`flex-1 p-2 space-y-2 bg-muted/30 rounded-b-xl border border-t-0 ${config.borderColor} min-h-[200px] ${isDragOver ? "bg-primary/5" : ""}`}>
        {leads.map((lead) => (
          <KanbanCard key={lead.id} lead={lead} onDragStart={onDragStart} onClick={() => onCardClick(lead)} onDelete={onDeleteLead} />
        ))}
        {leads.length === 0 && (
          <div className="flex items-center justify-center h-24 text-xs text-muted-foreground/60">
            Arraste clientes para cá
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== KANBAN TAB ====================
function KanbanTab() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [dragOverColumn, setDragOverColumn] = useState<LeadStatus | null>(null);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [calendarLeadId, setCalendarLeadId] = useState<number | null>(null);
  const draggedLead = useRef<Lead | null>(null);

  const utils = trpc.useUtils();
  const { data: leads = [], isLoading } = trpc.leads.list.useQuery();

  const updateStatus = trpc.leads.updateStatus.useMutation({
    onSuccess: () => utils.leads.list.invalidate(),
  });

  const deleteLeadMutation = trpc.leads.delete.useMutation({
    onSuccess: () => {
      utils.leads.list.invalidate();
      toast.success("Lead excluído com sucesso");
    },
    onError: () => toast.error("Erro ao excluir lead"),
  });

  const handleDeleteLead = useCallback((id: number) => {
    deleteLeadMutation.mutate({ id });
  }, [deleteLeadMutation]);

  const handleDragStart = useCallback((e: React.DragEvent, lead: Lead) => {
    draggedLead.current = lead;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(status);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, newStatus: LeadStatus) => {
    e.preventDefault();
    setDragOverColumn(null);
    const lead = draggedLead.current;
    if (!lead || lead.status === newStatus) return;
    if (newStatus === "reuniao_agendada") {
      setCalendarLeadId(lead.id);
      setCalendarModalOpen(true);
    }
    updateStatus.mutate({ id: lead.id, status: newStatus });
    draggedLead.current = null;
  }, [updateStatus]);

  const filteredLeads = leads.filter((l: Lead) =>
    !search || l.nome.toLowerCase().includes(search.toLowerCase()) || l.email.toLowerCase().includes(search.toLowerCase())
  );

  const getLeadsByStatus = (status: LeadStatus) =>
    filteredLeads.filter((l: Lead) => l.status === status);

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar clientes..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => utils.leads.list.invalidate()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
          </Button>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">{leads.length}</span> clientes
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMN_ORDER.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              leads={getLeadsByStatus(status)}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onCardClick={(lead) => setLocation(`/dashboard/lead/${lead.id}`)}
              onDeleteLead={handleDeleteLead}
              isDragOver={dragOverColumn === status}
            />
          ))}
        </div>
      )}

      {calendarModalOpen && calendarLeadId && (
        <CalendarModal leadId={calendarLeadId} onClose={() => { setCalendarModalOpen(false); setCalendarLeadId(null); }} />
      )}
    </div>
  );
}

// ==================== CALENDAR TAB ====================
function CalendarTab() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const { data: calendarData, isLoading } = trpc.leads.getCalendarEvents.useQuery();
  const { data: authUrl } = trpc.googleCalendar.getAuthUrl.useQuery();
  const disconnect = trpc.googleCalendar.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Google Calendar desconectado.");
      window.location.reload();
    },
  });

  const daysInMonth = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    // Previous month padding
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month - 1, prevMonthDays - i), isCurrentMonth: false });
    }
    // Current month
    for (let d = 1; d <= totalDays; d++) {
      days.push({ date: new Date(year, month, d), isCurrentMonth: true });
    }
    // Next month padding
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      days.push({ date: new Date(year, month + 1, d), isCurrentMonth: false });
    }
    return days;
  }, [currentMonth]);

  const getEventsForDate = (date: Date) => {
    if (!calendarData?.events) return [];
    return calendarData.events.filter((ev: any) => {
      const evDate = new Date(ev.start);
      return evDate.getFullYear() === date.getFullYear() && evDate.getMonth() === date.getMonth() && evDate.getDate() === date.getDate();
    });
  };

  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const today = new Date();

  if (!calendarData?.connected) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <CalendarIcon className="h-16 w-16 text-muted-foreground/30" />
        <div className="text-center max-w-md">
          <h3 className="text-xl font-semibold mb-2">Conecte seu Google Calendar</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Conecte sua conta Google para visualizar e criar eventos diretamente no painel. Os agendamentos de reuniões com clientes serão sincronizados automaticamente.
          </p>
          {authUrl?.url ? (
            <Button onClick={() => window.location.href = authUrl.url!} className="gap-2">
              <Link2 className="h-4 w-4" /> Conectar Google Calendar
            </Button>
          ) : (
            <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg">
              <p className="font-medium mb-1">Configuração necessária</p>
              <p>As variáveis <code className="bg-background px-1 rounded">GOOGLE_CALENDAR_CLIENT_ID</code> e <code className="bg-background px-1 rounded">GOOGLE_CALENDAR_CLIENT_SECRET</code> precisam ser configuradas nas variáveis de ambiente.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-lg font-semibold min-w-[200px] text-center">
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </h3>
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-200">
            <Check className="h-3.5 w-3.5" /> Conectado
          </div>
          <Button variant="outline" size="sm" onClick={() => disconnect.mutate()} className="text-destructive hover:text-destructive">
            <Unlink className="h-4 w-4 mr-1" /> Desconectar
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <div className="grid grid-cols-7 bg-muted/50">
            {dayNames.map(d => (
              <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-3 border-b">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {daysInMonth.map((day, i) => {
              const events = getEventsForDate(day.date);
              const isToday = day.date.toDateString() === today.toDateString();
              return (
                <div key={i} className={`min-h-[100px] border-b border-r p-1.5 ${!day.isCurrentMonth ? "bg-muted/20" : ""} ${isToday ? "bg-primary/5" : ""}`}>
                  <div className={`text-xs font-medium mb-1 ${isToday ? "bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center" : day.isCurrentMonth ? "text-foreground" : "text-muted-foreground/40"}`}>
                    {day.date.getDate()}
                  </div>
                  {events.slice(0, 3).map((ev: any, j: number) => {
                    // Color coding based on event title
                    const title = (ev.title || "").toLowerCase();
                    let tagColor = "bg-primary/10 text-primary"; // default teal
                    if (title.includes("parr") || title.includes("reunião") || title.includes("reuniao")) {
                      tagColor = "bg-purple-100 text-purple-700";
                    } else if (title.includes("proposta") || title.includes("contrato")) {
                      tagColor = "bg-green-100 text-green-700";
                    } else if (title.includes("prazo") || title.includes("urgente") || title.includes("deadline")) {
                      tagColor = "bg-red-100 text-red-700";
                    } else if (title.includes("ligação") || title.includes("ligacao") || title.includes("call") || title.includes("contato")) {
                      tagColor = "bg-amber-100 text-amber-700";
                    }
                    return (
                      <div key={j} className={`text-[10px] ${tagColor} rounded px-1 py-0.5 mb-0.5 truncate`} title={ev.title}>
                        {ev.start ? new Date(ev.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""} {ev.title}
                      </div>
                    );
                  })}
                  {events.length > 3 && (
                    <div className="text-[10px] text-muted-foreground">+{events.length - 3} mais</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legenda de cores */}
      <div className="flex flex-wrap items-center gap-4 mt-4 px-1">
        <span className="text-xs text-muted-foreground font-medium">Legenda:</span>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-purple-100 border border-purple-300"></div>
          <span className="text-xs text-muted-foreground">Reunião / PARR</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-100 border border-green-300"></div>
          <span className="text-xs text-muted-foreground">Proposta / Contrato</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-100 border border-red-300"></div>
          <span className="text-xs text-muted-foreground">Prazo / Urgente</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-amber-100 border border-amber-300"></div>
          <span className="text-xs text-muted-foreground">Ligação / Contato</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-primary/10 border border-primary/30"></div>
          <span className="text-xs text-muted-foreground">Outros</span>
        </div>
      </div>
    </div>
  );
}

// ==================== IMPORT TAB ====================
function ImportTab() {
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [workbookRef, setWorkbookRef] = useState<any>(null);
  const [xlsxModule, setXlsxModule] = useState<any>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const [fileName, setFileName] = useState("");

  const { data: importBatches = [], isLoading: batchesLoading } = trpc.leads.listImports.useQuery();
  const deleteBatch = trpc.leads.deleteImport.useMutation({
    onSuccess: (data) => {
      toast.success(`Importação excluída! ${data.deletedLeads} clientes removidos.`);
      utils.leads.listImports.invalidate();
      utils.leads.list.invalidate();
    },
    onError: (err) => toast.error(err.message || "Erro ao excluir importação."),
  });

  const importMutation = trpc.leads.importExcel.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.imported} clientes importados com sucesso!`);
      setParsedData([]);
      setHeaders([]);
      setSheetNames([]);
      setSelectedSheet("");
      setWorkbookRef(null);
      setMapping({});
      setFileName("");
      utils.leads.list.invalidate();
      utils.leads.listImports.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao importar clientes.");
    },
  });

  const parseSheet = useCallback((wb: any, XLSX: any, sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];

    if (data.length < 2) {
      toast.error("Sheet vazia ou sem dados.");
      setParsedData([]);
      setHeaders([]);
      return;
    }

    const hdrs = (data[0] as any[]).map((h: any) => String(h != null ? h : "").trim());
    // Filter out completely empty headers
    const validHeaders = hdrs.filter(h => h !== "");
    const validIndices = hdrs.map((h, i) => h !== "" ? i : -1).filter(i => i >= 0);

    setHeaders(validHeaders);
    const rows = data.slice(1)
      .filter((r: any[]) => r.some((c: any) => c != null && c !== ""))
      .map((r: any[]) => validIndices.map(i => r[i] != null ? r[i] : ""));
    setParsedData(rows);

    // Auto-map columns
    const autoMap: Record<string, string> = {};
    validHeaders.forEach((h, i) => {
      const hl = h.toLowerCase();
      // Priority: Devedor Solidário goes to nome (the person/lead contact)
      if (!autoMap["nome"] && (hl.includes("devedor solidário") || hl.includes("devedor solidario") || hl.includes("solidário") || hl.includes("solidario"))) autoMap["nome"] = String(i);
      else if (!autoMap["nome"] && (hl.includes("razão") || hl.includes("razao") || hl === "razão social" || hl.includes("contribuinte"))) autoMap["nome"] = String(i);
      else if (!autoMap["nome"] && hl.includes("nome") && !hl.includes("fantasia") && !hl.includes("principal") && !hl.includes("devedor")) autoMap["nome"] = String(i);
      if (!autoMap["email"] && (hl.includes("email") || hl.includes("e-mail"))) autoMap["email"] = String(i);
      if (!autoMap["telefone"] && (hl.includes("telefone") || hl.includes("fone") || hl.includes("celular"))) autoMap["telefone"] = String(i);
      if (!autoMap["cnpj"] && hl.includes("cnpj")) autoMap["cnpj"] = String(i);
      if (!autoMap["valorDivida"] && (hl.includes("total d\u00edvida") || hl.includes("total divida") || hl.includes("valor") || hl.includes("d\u00edvida") || hl.includes("divida") || hl.includes("d\u00e9bito") || hl.includes("debito") || hl.includes("saldo"))) autoMap["valorDivida"] = String(i);
      if (!autoMap["devedorPrincipal"] && (hl.includes("devedor principal") || hl.includes("nome do devedor principal"))) autoMap["devedorPrincipal"] = String(i);
      if (!autoMap["mensagem"] && (hl.includes("mensagem") || hl.includes("observ") || hl.includes("nota") || hl.includes("origem"))) autoMap["mensagem"] = String(i);
    });
    setMapping(autoMap);
    toast.success(`${rows.length} linhas encontradas na sheet "${sheetName}".`);
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setFileName(file.name);
      const XLSX = await import("xlsx");
      setXlsxModule(XLSX);
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      setWorkbookRef(wb);
      setSheetNames(wb.SheetNames);

      // Pick the best default sheet
      const preferredSheets = ["Lista Pipedrive", "Consolidado", "PARR", "Dados Originais"];
      const defaultSheet = preferredSheets.find(s => wb.SheetNames.includes(s)) || wb.SheetNames[0];
      setSelectedSheet(defaultSheet);
      parseSheet(wb, XLSX, defaultSheet);
    } catch (err) {
      toast.error("Erro ao ler o arquivo. Verifique se \u00e9 um Excel v\u00e1lido.");
    }
  };

  const handleSheetChange = (sheetName: string) => {
    setSelectedSheet(sheetName);
    if (workbookRef && xlsxModule) {
      parseSheet(workbookRef, xlsxModule, sheetName);
    }
  };

  const handleImport = () => {
    if (!mapping["nome"]) {
      toast.error("Mapeie pelo menos a coluna 'Nome'.");
      return;
    }
    setImporting(true);
    const leads = parsedData.map(row => ({
      nome: String(row[parseInt(mapping["nome"])] ?? "Sem nome"),
      email: mapping["email"] ? String(row[parseInt(mapping["email"])] ?? "") : "",
      telefone: mapping["telefone"] ? String(row[parseInt(mapping["telefone"])] ?? "") : "",
      cnpj: mapping["cnpj"] ? String(row[parseInt(mapping["cnpj"])] ?? "") : undefined,
      valorDivida: mapping["valorDivida"] ? String(row[parseInt(mapping["valorDivida"])] ?? "") : undefined,
      mensagem: mapping["mensagem"] ? String(row[parseInt(mapping["mensagem"])] ?? "") : undefined,
      devedorPrincipal: mapping["devedorPrincipal"] ? String(row[parseInt(mapping["devedorPrincipal"])] ?? "") : undefined,
    })).filter(l => l.nome && l.nome !== "Sem nome" && l.nome.trim() !== "");

    importMutation.mutate({ leads, fileName: fileName || "Importação Excel", sheetName: selectedSheet || undefined }, { onSettled: () => setImporting(false) });
  };

  const fieldLabels: Record<string, string> = {
    nome: "Nome do Devedor Solid\u00e1rio",
    devedorPrincipal: "Nome do Devedor Principal",
    email: "E-mail",
    telefone: "Telefone",
    cnpj: "CNPJ",
    valorDivida: "Valor da D\u00edvida",
    mensagem: "Observa\u00e7\u00e3o / Origem",
  };

  // Safe cell renderer - always returns a string
  const renderCell = (value: any): string => {
    if (value == null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  return (
    <div>
      {/* Import History Panel */}
      {importBatches.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-4">Importações Realizadas</h3>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Arquivo</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Sheet</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Leads</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Importado por</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {importBatches.map((batch: any) => (
                  <tr key={batch.id} className="border-t hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-green-600" />
                        <span className="font-medium">{batch.fileName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{batch.sheetName || "-"}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-medium">{batch.leadsCount}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{batch.importedBy || "-"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(batch.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                        onClick={() => {
                          if (confirm(`Tem certeza que deseja excluir esta importação? ${batch.leadsCount} clientes serão removidos permanentemente.`)) {
                            deleteBatch.mutate({ batchId: batch.id });
                          }
                        }}
                        disabled={deleteBatch.isPending}
                      >
                        <X className="h-3 w-3" /> Excluir
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="max-w-4xl">
        <h3 className="text-lg font-semibold mb-2">Importar Clientes via Excel</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Fa\u00e7a upload de uma planilha Excel (.xlsx, .xls) com os dados dos clientes. O sistema irá mapear automaticamente as colunas, mas você pode ajustar o mapeamento antes de importar.
        </p>

        <div className="border-2 border-dashed border-border rounded-xl p-8 text-center mb-6 hover:border-primary/50 transition-colors">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelect} className="hidden" />
          <FileSpreadsheet className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
            <Upload className="h-4 w-4" /> Selecionar Planilha
          </Button>
          <p className="text-xs text-muted-foreground mt-3">Formatos aceitos: .xlsx, .xls, .csv</p>
        </div>

        {sheetNames.length > 1 && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-foreground mb-2">Selecionar Sheet da Planilha</label>
            <div className="flex flex-wrap gap-2">
              {sheetNames.map(name => (
                <button
                  key={name}
                  onClick={() => handleSheetChange(name)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    selectedSheet === name
                      ? "bg-primary text-white shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {parsedData.length > 0 && (
          <>
            <div className="bg-muted/50 rounded-xl p-5 mb-6">
              <h4 className="font-semibold text-sm mb-4">Mapeamento de Colunas</h4>
              <div className="grid grid-cols-2 gap-4">
                {Object.keys(fieldLabels).map(field => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      {fieldLabels[field]} {field === "nome" && <span className="text-destructive">*</span>}
                    </label>
                    <select
                      value={mapping[field] || ""}
                      onChange={(e) => setMapping(prev => ({ ...prev, [field]: e.target.value }))}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">-- N\u00e3o mapear --</option>
                      {headers.map((h, i) => (
                        <option key={i} value={String(i)}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border overflow-hidden mb-6">
              <div className="px-4 py-3 bg-muted/50 border-b">
                <span className="text-sm font-medium">Pr\u00e9via dos dados ({parsedData.length} linhas)</span>
              </div>
              <div className="overflow-x-auto max-h-[300px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 sticky top-0">
                    <tr>
                      {headers.map((h, i) => (
                        <th key={i} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{h || `Col ${i + 1}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.slice(0, 10).map((row, i) => (
                      <tr key={i} className="border-t">
                        {headers.map((_, j) => (
                          <td key={j} className="px-3 py-2 whitespace-nowrap max-w-[200px] truncate">{renderCell(row[j])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedData.length > 10 && (
                <div className="px-4 py-2 bg-muted/30 border-t text-xs text-muted-foreground">
                  Mostrando 10 de {parsedData.length} linhas
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { setParsedData([]); setHeaders([]); setSheetNames([]); setSelectedSheet(""); setWorkbookRef(null); setMapping({}); }}>
                Cancelar
              </Button>
              <Button onClick={handleImport} disabled={importing || !mapping["nome"]} className="gap-2">
                {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {importing ? "Importando..." : `Importar ${parsedData.length} clientes`}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ==================== SETTINGS TAB ====================
function SettingsTab() {
  const { data: settings, isLoading } = trpc.settings.getAdmin.useQuery();
  const updateSetting = trpc.settings.update.useMutation({
    onSuccess: () => toast.success("Configuração salva!"),
    onError: (err) => toast.error(err.message),
  });

  const [videoUrl, setVideoUrl] = useState("");

  useEffect(() => {
    if (settings?.videoUrl) setVideoUrl(settings.videoUrl);
  }, [settings]);

  if (isLoading) return <div className="flex items-center justify-center h-32"><RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="max-w-2xl">
      <h3 className="text-lg font-semibold mb-6">Configurações do Site</h3>

      <div className="space-y-8">
        {/* Video URL */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-3 mb-4">
            <Video className="h-5 w-5 text-primary" />
            <h4 className="font-semibold">Vídeo Explicativo (Landing Page)</h4>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Cole a URL de um vídeo do YouTube ou Vimeo. Ele será exibido na seção "Entenda o PARR" da Landing Page. Deixe vazio para ocultar a seção.
          </p>
          <div className="flex gap-3">
            <Input
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={() => updateSetting.mutate({ key: "videoUrl", value: videoUrl })}
              disabled={updateSetting.isPending}
            >
              {updateSetting.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </div>

        {/* Google Calendar Status */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center gap-3 mb-4">
            <CalendarIcon className="h-5 w-5 text-primary" />
            <h4 className="font-semibold">Google Calendar</h4>
          </div>
          {settings?.googleCalendarRefreshToken ? (
            <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 px-4 py-3 rounded-lg border border-green-200">
              <Check className="h-4 w-4" />
              <span>Conectado {settings?.googleCalendarEmail ? `(${settings.googleCalendarEmail})` : ""}</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Não conectado. Acesse a aba "Calendário" para conectar sua conta Google.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== MAIN DASHBOARD ====================
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("kanban");
  const searchString = useSearch();

  useEffect(() => {
    if (searchString.includes("calendar=connected")) {
      toast.success("Google Calendar conectado com sucesso!");
      setActiveTab("calendar");
    } else if (searchString.includes("calendar=error")) {
      toast.error("Erro ao conectar Google Calendar. Tente novamente.");
    }
  }, [searchString]);

  const tabs: { id: DashboardTab; label: string; icon: React.ElementType }[] = [
    { id: "kanban", label: "Clientes", icon: Users },
    { id: "calendar", label: "Calendário", icon: CalendarIcon },
    { id: "import", label: "Importar", icon: FileSpreadsheet },
    { id: "settings", label: "Configurações", icon: Settings },
  ];

  return (
    <DashboardLayout>
      <div className="mb-6">
        <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-white shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {activeTab === "kanban" && <KanbanTab />}
      {activeTab === "calendar" && <CalendarTab />}
      {activeTab === "import" && <ImportTab />}
      {activeTab === "settings" && <SettingsTab />}
    </DashboardLayout>
  );
}
