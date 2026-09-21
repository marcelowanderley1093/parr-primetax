// Logica pura do import da Manus (sem I/O, sem banco): modos, transformacoes, integridade.
// Nunca retorna mensagens com valores de linha — so nomes de tabela/coluna e contagens.

export type Row = Record<string, unknown>;
export type ImportMode = "full" | "leads";

export class ImportAbort extends Error {}

export type ColumnMeta = { key: string; dbName: string; isDate: boolean; notNull: boolean; hasDefault: boolean };

export type ModePlan = {
  mode: ImportMode;
  /** Ordem de insercao (integridade referencial e responsabilidade do script: nao ha FKs). */
  order: string[];
  /** Tabelas que precisam estar vazias antes de escrever. */
  mustBeEmpty: string[];
  referenceCounts: Record<string, number>;
  /** Filtro de linhas por tabela (aplicado antes das transformacoes). */
  rowFilter: Partial<Record<string, (row: Row) => boolean>>;
  /** Transformacao por tabela (linha ja preparada para o drizzle). */
  transform: Partial<Record<string, (row: Row) => void>>;
  /** Checagens que abortam: [tabela filha, coluna, tabela pai]. */
  integrity: Array<[string, string, string]>;
  /** Colunas de autor zeradas (so diagnostico). */
  userIdDiagnostics: Array<[string, string]>;
};

export const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const SETTING_KEYS_TO_NULL = new Set(["googleCalendarEmail", "googleCalendarRefreshToken"]);
const LOCAL_USER_COLUMNS_TO_NULL = ["passwordHash", "activationToken", "activationTokenExpiry"];

const FULL_REFERENCE: Record<string, number> = {
  leads: 888,
  lead_status_history: 896,
  lead_notes: 25,
  local_users: 5,
  users: 3,
  site_settings: 3,
  lead_imports: 1,
};

const LEADS_REFERENCE: Record<string, number> = {
  lead_imports: 1,
  leads: 888,
  lead_status_history: 896,
  site_settings: 1,
};

export function planFor(mode: ImportMode): ModePlan {
  if (mode === "full") {
    return {
      mode,
      order: ["lead_imports", "users", "local_users", "leads", "lead_notes", "lead_status_history", "site_settings"],
      mustBeEmpty: ["lead_imports", "users", "local_users", "leads", "lead_notes", "lead_status_history", "site_settings"],
      referenceCounts: FULL_REFERENCE,
      rowFilter: {},
      transform: {
        // Decisao B: contas existem, credenciais de producao nao sao replicadas
        local_users: row => {
          for (const k of LOCAL_USER_COLUMNS_TO_NULL) row[k] = null;
        },
        site_settings: row => {
          if (typeof row.settingKey === "string" && SETTING_KEYS_TO_NULL.has(row.settingKey)) row.settingValue = null;
        },
      },
      integrity: [
        ["lead_notes", "leadId", "leads"],
        ["lead_status_history", "leadId", "leads"],
        ["leads", "importBatchId", "lead_imports"],
      ],
      userIdDiagnostics: [
        ["lead_notes", "userId"],
        ["lead_status_history", "userId"],
      ],
    };
  }
  // Decisao 21/09: producao nasce do zero em usuarios, notas e Agenda. Migram so leads e lead_imports;
  // historico de status vem sem autor (userId NULL, userName mantido); site_settings so videoUrl.
  return {
    mode,
    order: ["lead_imports", "leads", "lead_status_history", "site_settings"],
    mustBeEmpty: ["lead_imports", "leads", "lead_notes", "lead_status_history", "site_settings"],
    referenceCounts: LEADS_REFERENCE,
    rowFilter: {
      site_settings: row => row.settingKey === "videoUrl",
    },
    transform: {
      leads: row => {
        row.calendarEventId = null; // Agenda do zero: eventos antigos nao existem
      },
      lead_status_history: row => {
        row.userId = null; // usuarios do zero: autor anonimo, userName (texto) preservado
      },
    },
    integrity: [
      ["lead_status_history", "leadId", "leads"],
      ["leads", "importBatchId", "lead_imports"],
    ],
    userIdDiagnostics: [["lead_status_history", "userId"]],
  };
}

/** Regra aprovada na Fase A: valida o regex ISO-UTC e faz new Date(iso); sem aritmetica de fuso. */
export function toDate(value: unknown, where: string): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !ISO_UTC_RE.test(value)) {
    throw new ImportAbort(`${where}: data fora do formato AAAA-MM-DDTHH:MM:SS.sssZ`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ImportAbort(`${where}: data invalida`);
  return d;
}

export type PrepareResult = { rows: Row[]; missing: Map<string, number>; readCount: number; selectedCount: number };

/**
 * Monta as linhas para o drizzle: filtro do modo, so colunas do schema, datas convertidas,
 * transformacao do modo. Aborta em coluna fora do schema.
 */
export function prepareRows(plan: ModePlan, name: string, exportRows: Row[], columns: ColumnMeta[]): PrepareResult {
  const known = new Set(columns.map(c => c.dbName));
  const filter = plan.rowFilter[name];
  const transform = plan.transform[name];
  const selected = filter ? exportRows.filter(filter) : exportRows;
  const missing = new Map<string, number>();
  const rows: Row[] = [];

  selected.forEach((row, i) => {
    const extra = Object.keys(row).filter(k => !known.has(k));
    if (extra.length > 0) throw new ImportAbort(`tabela ${name}, linha #${i}: colunas fora do schema: ${extra.join(", ")}`);
    const out: Row = {};
    for (const col of columns) {
      if (!Object.prototype.hasOwnProperty.call(row, col.dbName)) {
        missing.set(col.dbName, (missing.get(col.dbName) ?? 0) + 1);
        continue; // drizzle usa o default da coluna
      }
      const raw = row[col.dbName];
      out[col.key] = col.isDate ? toDate(raw, `tabela ${name}, linha #${i}, coluna ${col.dbName}`) : raw;
    }
    if (transform) transform(out);
    rows.push(out);
  });

  return { rows, missing, readCount: exportRows.length, selectedCount: rows.length };
}

export function idSet(rows: Row[], key = "id"): Set<number> {
  const s = new Set<number>();
  for (const r of rows) if (typeof r[key] === "number") s.add(r[key] as number);
  return s;
}

export function countOrphans(rows: Row[], key: string, parents: Set<number>): { total: number; orphans: number } {
  let total = 0;
  let orphans = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined) continue;
    total += 1;
    if (typeof v !== "number" || !parents.has(v)) orphans += 1;
  }
  return { total, orphans };
}

export function parseArgs(argv: string[]): { file: string; run: "dry-run" | "apply"; mode: ImportMode; force: boolean } {
  let file: string | undefined;
  let mode: ImportMode | undefined;
  let dryRun = false;
  let apply = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") file = argv[++i];
    else if (a === "--mode") {
      const m = argv[++i];
      if (m !== "full" && m !== "leads") throw new ImportAbort("--mode deve ser full ou leads");
      mode = m;
    } else if (a === "--dry-run") dryRun = true;
    else if (a === "--apply") apply = true;
    else if (a === "--force") force = true;
    else throw new ImportAbort(`argumento desconhecido: ${a}`);
  }
  if (!file) throw new ImportAbort("informe --file <caminho.json>");
  if (!mode) throw new ImportAbort("informe --mode full ou --mode leads");
  if (dryRun === apply) throw new ImportAbort("informe exatamente um de --dry-run ou --apply");
  return { file, run: dryRun ? "dry-run" : "apply", mode, force };
}
