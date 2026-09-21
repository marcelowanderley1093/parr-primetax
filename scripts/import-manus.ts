// Import do export da Manus para o MySQL da VPS (staging/producao).
//
// Uso: pnpm tsx scripts/import-manus.ts --file <caminho.json> (--dry-run | --apply) [--force]
//   DATABASE_URL vem do ambiente (nunca e impressa).
//   --dry-run  roda a transacao inteira (guardas, inserts, recontagem) e termina com ROLLBACK.
//   --apply    commita e, FORA da transacao, ajusta AUTO_INCREMENT = MAX(id)+1 por tabela.
//   --force    pula a guarda "tabelas alvo vazias" (nao apaga nada; colisao de id causa rollback).
//
// Nunca imprime valores de linha: so nomes de tabelas/colunas e contagens.
// __drizzle_migrations NAO e importada (o banco alvo tem a propria contabilidade).
import "dotenv/config";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------

/** Ordem de insercao (integridade referencial e responsabilidade deste script: nao ha FKs). */
const IMPORT_ORDER: { name: string; table: MySqlTable }[] = [
  { name: "lead_imports", table: schema.leadImports },
  { name: "users", table: schema.users },
  { name: "local_users", table: schema.localUsers },
  { name: "leads", table: schema.leads },
  { name: "lead_notes", table: schema.leadNotes },
  { name: "lead_status_history", table: schema.leadStatusHistory },
  { name: "site_settings", table: schema.siteSettings },
];

const REFERENCE_COUNTS: Record<string, number> = {
  leads: 888,
  lead_status_history: 896,
  lead_notes: 25,
  local_users: 5,
  users: 3,
  site_settings: 3,
  lead_imports: 1,
};

const BATCH_SIZE = 200;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SETTING_KEYS_TO_NULL = new Set(["googleCalendarEmail", "googleCalendarRefreshToken"]);
const LOCAL_USER_COLUMNS_TO_NULL = ["passwordHash", "activationToken", "activationTokenExpiry"];

// ---------------------------------------------------------------------------
// Utilitarios (sem valores de linha na saida)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type ExportFile = { exportedAt?: unknown; tables: Record<string, { count?: unknown; columns?: unknown; rows: unknown }> };

class ImportAbort extends Error {}
class DryRunRollback extends Error {}

function log(msg: string) {
  console.log(msg);
}

/** Mensagem de erro do driver sem trechos entre aspas (podem conter valores de linha). */
function safeErrorMessage(error: unknown): string {
  const e = error as { code?: string; errno?: number; sqlState?: string; message?: string };
  const message = String(e?.message ?? error).replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"');
  const parts = [e?.code, e?.errno, e?.sqlState].filter(v => v !== undefined && v !== null);
  return `${parts.length ? `[${parts.join(" ")}] ` : ""}${message}`;
}

function parseArgs(argv: string[]): { file: string; mode: "dry-run" | "apply"; force: boolean } {
  let file: string | undefined;
  let dryRun = false;
  let apply = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") file = argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--apply") apply = true;
    else if (a === "--force") force = true;
    else throw new ImportAbort(`argumento desconhecido: ${a}`);
  }
  if (!file) throw new ImportAbort("informe --file <caminho.json>");
  if (dryRun === apply) throw new ImportAbort("informe exatamente um de --dry-run ou --apply");
  return { file, mode: dryRun ? "dry-run" : "apply", force };
}

function loadExport(path: string): ExportFile {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ImportAbort("JSON de topo nao e objeto");
  const tables = (parsed as { tables?: unknown }).tables;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) throw new ImportAbort('JSON sem chave "tables" (objeto)');
  return parsed as ExportFile;
}

function rowsOf(file: ExportFile, name: string): Row[] {
  const entry = file.tables[name];
  if (!entry) throw new ImportAbort(`tabela ausente no export: ${name}`);
  if (!Array.isArray(entry.rows)) throw new ImportAbort(`tabela ${name}: "rows" nao e array`);
  const rows = entry.rows as unknown[];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new ImportAbort(`tabela ${name}: linha #${i} nao e objeto`);
  }
  if (typeof entry.count === "number" && entry.count !== rows.length) {
    throw new ImportAbort(`tabela ${name}: count=${entry.count} difere de rows.length=${rows.length}`);
  }
  return rows as Row[];
}

type ColumnMeta = { key: string; dbName: string; isDate: boolean; notNull: boolean; hasDefault: boolean };

function columnsOf(table: MySqlTable): ColumnMeta[] {
  const cols = getTableColumns(table) as Record<string, { name: string; dataType: string; notNull: boolean; hasDefault: boolean }>;
  return Object.entries(cols).map(([key, c]) => ({
    key,
    dbName: c.name,
    isDate: c.dataType === "date",
    notNull: c.notNull,
    hasDefault: c.hasDefault,
  }));
}

/** Regra aprovada na Fase A: valida o regex ISO-UTC e faz new Date(iso); sem aritmetica de fuso. */
function toDate(value: unknown, where: string): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !ISO_UTC_RE.test(value)) {
    throw new ImportAbort(`${where}: data fora do formato AAAA-MM-DDTHH:MM:SS.sssZ`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ImportAbort(`${where}: data invalida`);
  return d;
}

/** Monta as linhas para o drizzle: so colunas do schema, datas convertidas, transformacoes por tabela. */
function prepareRows(name: string, exportRows: Row[], columns: ColumnMeta[]): Row[] {
  const byDbName = new Map(columns.map(c => [c.dbName, c]));
  const known = new Set(byDbName.keys());
  const prepared: Row[] = [];
  const missingCounts = new Map<string, number>();

  exportRows.forEach((row, i) => {
    const extra = Object.keys(row).filter(k => !known.has(k));
    if (extra.length > 0) throw new ImportAbort(`tabela ${name}, linha #${i}: colunas fora do schema: ${extra.join(", ")}`);

    const out: Row = {};
    for (const col of columns) {
      const has = Object.prototype.hasOwnProperty.call(row, col.dbName);
      if (!has) {
        missingCounts.set(col.dbName, (missingCounts.get(col.dbName) ?? 0) + 1);
        continue; // drizzle usa o default da coluna
      }
      const raw = row[col.dbName];
      out[col.key] = col.isDate ? toDate(raw, `tabela ${name}, linha #${i}, coluna ${col.dbName}`) : raw;
    }

    // Transformacoes obrigatorias
    if (name === "local_users") {
      for (const k of LOCAL_USER_COLUMNS_TO_NULL) out[k] = null;
    }
    if (name === "site_settings") {
      const key = out.settingKey;
      if (typeof key === "string" && SETTING_KEYS_TO_NULL.has(key)) out.settingValue = null;
    }
    prepared.push(out);
  });

  for (const [col, n] of missingCounts) log(`    aviso: ${name}.${col} ausente em ${n} linha(s) -> default da coluna`);
  return prepared;
}

function idSet(rows: Row[], key = "id"): Set<number> {
  const s = new Set<number>();
  for (const r of rows) if (typeof r[key] === "number") s.add(r[key] as number);
  return s;
}

function countOrphans(rows: Row[], key: string, parents: Set<number>): { total: number; orphans: number } {
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

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const { file, mode, force } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new ImportAbort("DATABASE_URL nao definida no ambiente");

  log(`=== import-manus: modo ${mode.toUpperCase()}${force ? " (--force)" : ""} ===`);

  // 1. Leitura e preparacao (sem banco)
  const exportFile = loadExport(file);
  const prepared = new Map<string, Row[]>();
  const readCounts = new Map<string, number>();
  log("--- leitura do export");
  for (const { name, table } of IMPORT_ORDER) {
    const rows = rowsOf(exportFile, name);
    readCounts.set(name, rows.length);
    prepared.set(name, prepareRows(name, rows, columnsOf(table)));
    log(`  ${name}: ${rows.length} linha(s) lidas`);
  }
  const ignored = Object.keys(exportFile.tables).filter(t => !IMPORT_ORDER.some(o => o.name === t));
  if (ignored.length) log(`  ignoradas (nao importadas): ${ignored.join(", ")}`);

  // 2. Integridade referencial (abortar)
  log("--- integridade referencial");
  const leadIds = idSet(prepared.get("leads")!);
  const importIds = idSet(prepared.get("lead_imports")!);
  const notesLead = countOrphans(prepared.get("lead_notes")!, "leadId", leadIds);
  const historyLead = countOrphans(prepared.get("lead_status_history")!, "leadId", leadIds);
  const leadsBatch = countOrphans(prepared.get("leads")!, "importBatchId", importIds);
  log(`  lead_notes.leadId -> leads: ${notesLead.orphans} orfao(s) de ${notesLead.total}`);
  log(`  lead_status_history.leadId -> leads: ${historyLead.orphans} orfao(s) de ${historyLead.total}`);
  log(`  leads.importBatchId (nao nulo) -> lead_imports: ${leadsBatch.orphans} orfao(s) de ${leadsBatch.total}`);
  if (notesLead.orphans || historyLead.orphans || leadsBatch.orphans) {
    throw new ImportAbort("integridade referencial violada (ver contagens acima)");
  }

  // 3. userId: alvo ambiguo por desenho -> so relatar
  log("--- userId (sem FK; apenas diagnostico)");
  const localUserIds = idSet(prepared.get("local_users")!);
  const userIds = idSet(prepared.get("users")!);
  for (const t of ["lead_notes", "lead_status_history"]) {
    const vsLocal = countOrphans(prepared.get(t)!, "userId", localUserIds);
    const vsUsers = countOrphans(prepared.get(t)!, "userId", userIds);
    log(`  ${t}.userId: ${vsLocal.total} nao nulo(s); orfaos vs local_users: ${vsLocal.orphans}; orfaos vs users: ${vsUsers.orphans}`);
  }

  // 4. Conexao
  const conn = await mysql.createConnection(databaseUrl);
  const db = drizzle(conn);
  const insertedCounts = new Map<string, number>();
  const finalCounts = new Map<string, number>();
  let tz = { global: "?", session: "?" };

  try {
    const [tzRows] = await conn.query("SELECT @@global.time_zone AS g, @@session.time_zone AS s");
    const tzRow = (tzRows as Array<{ g: string; s: string }>)[0];
    tz = { global: String(tzRow?.g), session: String(tzRow?.s) };

    // Guarda: tabelas alvo vazias
    log("--- guarda: tabelas alvo");
    const nonEmpty: string[] = [];
    for (const { name } of IMPORT_ORDER) {
      const [r] = await conn.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
      const n = Number((r as Array<{ n: number | string }>)[0]?.n ?? 0);
      log(`  ${name}: ${n} linha(s) existentes`);
      if (n > 0) nonEmpty.push(name);
    }
    if (nonEmpty.length && !force) throw new ImportAbort(`tabelas nao vazias: ${nonEmpty.join(", ")} (use --force para ignorar; nada e apagado)`);
    if (nonEmpty.length && force) log(`  --force: prosseguindo com tabelas nao vazias (${nonEmpty.join(", ")}); colisao de id causa rollback`);

    // 5. Transacao unica
    log(`--- transacao (${mode})`);
    try {
      await db.transaction(async tx => {
        for (const { name, table } of IMPORT_ORDER) {
          const rows = prepared.get(name)!;
          let inserted = 0;
          for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            if (batch.length === 0) continue;
            await tx.insert(table).values(batch as any);
            inserted += batch.length;
          }
          insertedCounts.set(name, inserted);
          log(`  ${name}: ${inserted} inserida(s)`);
        }
        // Recontagem dentro da transacao (em dry-run e a unica leitura com as linhas presentes)
        for (const { name } of IMPORT_ORDER) {
          const r = await tx.execute(sql.raw(`SELECT COUNT(*) AS n FROM \`${name}\``));
          const first = (r as unknown as [Array<{ n: number | string }>])[0]?.[0];
          finalCounts.set(name, Number(first?.n ?? 0));
        }
        if (mode === "dry-run") throw new DryRunRollback();
      });
      log("  COMMIT");
    } catch (error) {
      if (error instanceof DryRunRollback) {
        log("  ROLLBACK (dry-run)");
      } else {
        throw error;
      }
    }

    // 6. AUTO_INCREMENT: ALTER TABLE = commit implicito -> fora da transacao, so no --apply
    if (mode === "apply") {
      log("--- AUTO_INCREMENT = MAX(id)+1");
      for (const { name } of IMPORT_ORDER) {
        const [r] = await conn.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM \`${name}\``);
        const next = Number((r as Array<{ next: number | string }>)[0]?.next ?? 1);
        await conn.query(`ALTER TABLE \`${name}\` AUTO_INCREMENT = ${next}`);
        log(`  ${name}: AUTO_INCREMENT=${next}`);
      }
      // Contagem final relida do banco apos o commit
      for (const { name } of IMPORT_ORDER) {
        const [r] = await conn.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
        finalCounts.set(name, Number((r as Array<{ n: number | string }>)[0]?.n ?? 0));
      }
    }
  } finally {
    await conn.end().catch(() => undefined);
  }

  // 7. Relatorio
  log("=== RELATORIO ===");
  log(`time_zone: global=${tz.global} session=${tz.session}`);
  log(`contagem final ${mode === "apply" ? "relida do banco apos COMMIT" : "relida dentro da transacao antes do ROLLBACK"}:`);
  const divergent: string[] = [];
  for (const { name } of IMPORT_ORDER) {
    const read = readCounts.get(name) ?? 0;
    const ins = insertedCounts.get(name) ?? 0;
    const fin = finalCounts.get(name) ?? 0;
    const ref = REFERENCE_COUNTS[name];
    const ok = fin === ref;
    if (!ok) divergent.push(name);
    log(`  ${name}: lidas ${read} / inseridas ${ins} / banco ${fin} / referencia ${ref} -> ${ok ? "ok" : "DIVERGE"}`);
  }
  if (divergent.length === 0) {
    log("PASSOU");
    return 0;
  }
  log(`PARAR: contagem divergente em ${divergent.join(", ")}`);
  return 1;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    if (error instanceof ImportAbort) {
      console.error(`PARAR: ${error.message}`);
    } else {
      console.error(`PARAR: erro inesperado: ${safeErrorMessage(error)}`);
    }
    process.exit(1);
  });
