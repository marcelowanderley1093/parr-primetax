// Eventos do Google Agenda exibidos no Calendario do PARR. Puro, sem I/O.
//
// Evento de dia inteiro vem do Google so com a data ("2026-10-05", sem hora). `new Date("2026-10-05")` le isso como
// meia-noite UTC, que no horario de Brasilia vira 21:00 do dia anterior — por isso o dia e lido pelos digitos.
// Eventos de "local de trabalho" (eventType workingLocation, ex.: "Escritorio") nao sao compromissos e ficam fora.

export type EventoAgenda = {
  id: string;
  title: string;
  start: string;
  end: string;
  description: string;
  diaInteiro: boolean;
};

const SO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Converte um item da API do Google Agenda; null para o que nao e compromisso. */
export function eventoDoGoogle(item: any): EventoAgenda | null {
  if (!item || item.eventType === "workingLocation") return null;
  const diaInteiro = !item.start?.dateTime && !!item.start?.date;
  return {
    id: item.id,
    title: item.summary || "Sem título",
    start: item.start?.dateTime || item.start?.date || "",
    end: item.end?.dateTime || item.end?.date || "",
    description: item.description || "",
    diaInteiro,
  };
}

/** Dia local (ano, mes 0-11, dia) em que o evento comeca; null se a data for invalida. */
export function diaDoEvento(start: string): { ano: number; mes: number; dia: number } | null {
  const m = SO_DATA.exec(start);
  if (m) return { ano: Number(m[1]), mes: Number(m[2]) - 1, dia: Number(m[3]) };
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return null;
  return { ano: d.getFullYear(), mes: d.getMonth(), dia: d.getDate() };
}

/** Rotulo de hora no calendario: vazio para dia inteiro, "HH:MM" para o resto. */
export function horaDoEvento(ev: { start: string; diaInteiro?: boolean }): string {
  if (!ev.start || ev.diaInteiro || SO_DATA.test(ev.start)) return "";
  const d = new Date(ev.start);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
