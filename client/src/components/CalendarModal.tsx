import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Calendar, X, AlertTriangle } from "lucide-react";

interface CalendarModalProps {
  leadId: number;
  mode?: "create" | "reschedule" | "cancel";
  existingEventId?: string;
  onClose: () => void;
}

export default function CalendarModal({ leadId, mode = "create", existingEventId, onClose }: CalendarModalProps) {
  const [title, setTitle] = useState("Reunião PARR - Primetax");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [duration, setDuration] = useState("60");
  const [description, setDescription] = useState("Reunião para análise do caso PARR e apresentação de estratégia de defesa.");
  const [attendeeEmail, setAttendeeEmail] = useState("");

  const utils = trpc.useUtils();

  const scheduleEvent = trpc.leads.scheduleEvent.useMutation({
    onSuccess: () => {
      toast.success("Reunião agendada com sucesso!");
      utils.leads.list.invalidate();
      utils.leads.getCalendarEvents.invalidate();
      if (leadId) utils.leads.getById.invalidate({ id: leadId });
      onClose();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao agendar reunião.");
    },
  });

  const rescheduleEvent = trpc.leads.rescheduleEvent.useMutation({
    onSuccess: () => {
      toast.success("Reunião remarcada com sucesso!");
      utils.leads.list.invalidate();
      utils.leads.getCalendarEvents.invalidate();
      if (leadId) utils.leads.getById.invalidate({ id: leadId });
      onClose();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao remarcar reunião.");
    },
  });

  const cancelEvent = trpc.leads.cancelEvent.useMutation({
    onSuccess: () => {
      toast.success("Reunião cancelada com sucesso!");
      utils.leads.list.invalidate();
      utils.leads.getCalendarEvents.invalidate();
      if (leadId) utils.leads.getById.invalidate({ id: leadId });
      onClose();
    },
    onError: (err) => {
      toast.error(err.message || "Erro ao cancelar reunião.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !startTime) {
      toast.error("Preencha a data e horário.");
      return;
    }
    const startDateTime = `${date}T${startTime}:00`;
    const durationMinutes = parseInt(duration) || 60;
    const endDate = new Date(`${date}T${startTime}:00`);
    endDate.setMinutes(endDate.getMinutes() + durationMinutes);
    // Format endTime as local datetime string (same format as start)
    const endYear = endDate.getFullYear();
    const endMonth = String(endDate.getMonth() + 1).padStart(2, "0");
    const endDay = String(endDate.getDate()).padStart(2, "0");
    const endHour = String(endDate.getHours()).padStart(2, "0");
    const endMin = String(endDate.getMinutes()).padStart(2, "0");
    const endSec = String(endDate.getSeconds()).padStart(2, "0");
    const endDateTime = `${endYear}-${endMonth}-${endDay}T${endHour}:${endMin}:${endSec}`;

    if (mode === "reschedule" && existingEventId) {
      rescheduleEvent.mutate({
        leadId,
        eventId: existingEventId,
        title,
        description,
        startTime: startDateTime,
        endTime: endDateTime,
        attendeeEmail: attendeeEmail || undefined,
      });
    } else {
      scheduleEvent.mutate({
        leadId,
        title,
        description,
        startTime: startDateTime,
        endTime: endDateTime,
        attendeeEmail: attendeeEmail || undefined,
      });
    }
  };

  const handleCancel = () => {
    if (existingEventId) {
      cancelEvent.mutate({ leadId, eventId: existingEventId });
    }
  };

  // Cancel confirmation mode
  if (mode === "cancel") {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h2 className="text-lg font-bold text-foreground">Cancelar Reunião</h2>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-muted rounded-md transition-colors">
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Tem certeza que deseja cancelar esta reunião? O evento será removido do Google Calendar e os participantes serão notificados.
          </p>
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Voltar
            </Button>
            <Button type="button" variant="destructive" onClick={handleCancel} className="flex-1" disabled={cancelEvent.isPending}>
              {cancelEvent.isPending ? "Cancelando..." : "Confirmar Cancelamento"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">
              {mode === "reschedule" ? "Remarcar Reunião" : "Agendar Reunião"}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-md transition-colors">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Título da Reunião</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Data</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Horário</label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Duração (minutos)</label>
            <Input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} min="15" step="15" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">E-mail do Participante</label>
            <Input type="email" placeholder="email@participante.com" value={attendeeEmail} onChange={(e) => setAttendeeEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Descrição</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={scheduleEvent.isPending || rescheduleEvent.isPending}>
              {(scheduleEvent.isPending || rescheduleEvent.isPending)
                ? (mode === "reschedule" ? "Remarcando..." : "Agendando...")
                : (mode === "reschedule" ? "Remarcar Reunião" : "Agendar Reunião")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
