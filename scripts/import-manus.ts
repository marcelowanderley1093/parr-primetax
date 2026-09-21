// Import do export da Manus para o MySQL da VPS (staging/producao).
//
// Uso: pnpm tsx scripts/import-manus.ts --file <caminho.json> --mode <full|leads> (--dry-run | --apply) [--force]
//   DATABASE_URL vem do ambiente (nunca e impressa).
//   --mode full   as 7 tabelas (credenciais de local_users e tokens do Calendar zerados).
//   --mode leads  so lead_imports, leads (calendarEventId NULL), lead_status_history (userId NULL) e
//                 site_settings (apenas videoUrl). Decisao 21/09: usuarios, notas e Agenda do zero.
//   --dry-run     roda a transacao inteira (guardas, inserts, recontagem) e termina com ROLLBACK.
//   --apply       commita e, FORA da transacao, ajusta AUTO_INCREMENT = MAX(id)+1 nas tabelas do modo.
//   --force       pula a guarda "tabelas alvo vazias" (nao apaga nada; colisao de id causa rollback).
//
// Nunca imprime valores de linha: so nomes de tabelas/colunas e contagens.
// __drizzle_migrations NAO e importada (o banco alvo tem a propria contabilidade).
import "dotenv/config";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { getTableColumns, sql } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";
import {
  ImportAbort,
  countOrphans,
  idSet,
  parseArgs,
  planFor,
  prepareRows,
  type ColumnMeta,
  type Row,
} from "./lib/importManus";

const TABLES: Record<string, MySqlTable> = {
  lead_imports: schema.leadImports,
  users: schema.users,
  local_users: schema.localUsers,
  leads: schema.leads,
  lead_notes: schema.leadNotes,
  lead_status_history: schema.leadStatusHistory,
  site_settings: schema.siteSettings,
};

const BATCH_SIZE = 200;

type ExportFile = { exportedAt?: unknown; tables: Record<string, { count?: unknown; columns?: unknown; rows: unknown }> };

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

async function main(): Promise<number> {
  const { file, run, mode, force } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new ImportAbort("DATABASE_URL nao definida no ambiente");
  const plan = planFor(mode);

  log(`=== import-manus: modo ${mode.toUpperCase()} · ${run.toUpperCase()}${force ? " (--force)" : ""} ===`);

  // 1. Leitura e preparacao (sem banco)
  const exportFile = loadExport(file);
  const prepared = new Map<string, Row[]>();
  const readCounts = new Map<string, number>();
  const selectedCounts = new Map<string, number>();
  log("--- leitura do export");
  for (const name of plan.order) {
    const result = prepareRows(plan, name, rowsOf(exportFile, name), columnsOf(TABLES[name]));
    prepared.set(name, result.rows);
    readCounts.set(name, result.readCount);
    selectedCounts.set(name, result.selectedCount);
    for (const [col, n] of result.missing) log(`    aviso: ${name}.${col} ausente em ${n} linha(s) -> default da coluna`);
    const sel = result.selectedCount !== result.readCount ? ` (${result.selectedCount} selecionada(s) pelo filtro do modo)` : "";
    log(`  ${name}: ${result.readCount} linha(s) lidas${sel}`);
  }
  const ignored = Object.keys(exportFile.tables).filter(t => !plan.order.includes(t));
  if (ignored.length) log(`  ignoradas (nao importadas neste modo): ${ignored.join(", ")}`);

  // 2. Integridade referencial (abortar)
  log("--- integridade referencial");
  let violations = 0;
  for (const [child, key, parent] of plan.integrity) {
    const r = countOrphans(prepared.get(child)!, key, idSet(prepared.get(parent)!));
    log(`  ${child}.${key} -> ${parent}: ${r.orphans} orfao(s) de ${r.total}`);
    violations += r.orphans;
  }
  if (violations > 0) throw new ImportAbort("integridade referencial violada (ver contagens acima)");

  // 3. userId: alvo ambiguo por desenho / zerado no modo leads -> so relatar
  log("--- userId (sem FK; apenas diagnostico)");
  for (const [table, key] of plan.userIdDiagnostics) {
    const rows = prepared.get(table)!;
    const original = rowsOf(exportFile, table);
    const nonNullOriginal = original.filter(r => r[key] !== null && r[key] !== undefined).length;
    if (mode === "leads") {
      const nonNullNow = rows.filter(r => r[key] !== null && r[key] !== undefined).length;
      log(`  ${table}.${key}: ${nonNullOriginal} com autor no export -> ${nonNullNow} apos zerar (userName preservado)`);
    } else {
      const vsLocal = countOrphans(rows, key, idSet(prepared.get("local_users") ?? []));
      const vsUsers = countOrphans(rows, key, idSet(prepared.get("users") ?? []));
      log(`  ${table}.${key}: ${vsLocal.total} nao nulo(s); orfaos vs local_users: ${vsLocal.orphans}; orfaos vs users: ${vsUsers.orphans}`);
    }
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

    // Guarda: tabelas alvo vazias (no modo leads inclui lead_notes, que nao e importada)
    log("--- guarda: tabelas que precisam estar vazias");
    const nonEmpty: string[] = [];
    for (const name of plan.mustBeEmpty) {
      const [r] = await conn.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
      const n = Number((r as Array<{ n: number | string }>)[0]?.n ?? 0);
      log(`  ${name}: ${n} linha(s) existentes`);
      if (n > 0) nonEmpty.push(name);
    }
    if (nonEmpty.length && !force) throw new ImportAbort(`tabelas nao vazias: ${nonEmpty.join(", ")} (use --force para ignorar; nada e apagado)`);
    if (nonEmpty.length && force) log(`  --force: prosseguindo com tabelas nao vazias (${nonEmpty.join(", ")}); colisao de id causa rollback`);

    // 5. Transacao unica
    log(`--- transacao (${run})`);
    try {
      await db.transaction(async tx => {
        for (const name of plan.order) {
          const rows = prepared.get(name)!;
          let inserted = 0;
          for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            if (batch.length === 0) continue;
            await tx.insert(TABLES[name]).values(batch as any);
            inserted += batch.length;
          }
          insertedCounts.set(name, inserted);
          log(`  ${name}: ${inserted} inserida(s)`);
        }
        // Recontagem dentro da transacao (em dry-run e a unica leitura com as linhas presentes)
        for (const name of plan.order) {
          const r = await tx.execute(sql.raw(`SELECT COUNT(*) AS n FROM \`${name}\``));
          const first = (r as unknown as [Array<{ n: number | string }>])[0]?.[0];
          finalCounts.set(name, Number(first?.n ?? 0));
        }
        if (run === "dry-run") throw new DryRunRollback();
      });
      log("  COMMIT");
    } catch (error) {
      if (error instanceof DryRunRollback) {
        log("  ROLLBACK (dry-run)");
      } else {
        throw error;
      }
    }

    // 6. AUTO_INCREMENT: ALTER TABLE = commit implicito -> fora da transacao, so no --apply,
    //    e so nas tabelas importadas neste modo
    if (run === "apply") {
      log("--- AUTO_INCREMENT = MAX(id)+1 (tabelas do modo)");
      for (const name of plan.order) {
        const [r] = await conn.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM \`${name}\``);
        const next = Number((r as Array<{ next: number | string }>)[0]?.next ?? 1);
        await conn.query(`ALTER TABLE \`${name}\` AUTO_INCREMENT = ${next}`);
        log(`  ${name}: AUTO_INCREMENT=${next}`);
      }
      for (const name of plan.order) {
        const [r] = await conn.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
        finalCounts.set(name, Number((r as Array<{ n: number | string }>)[0]?.n ?? 0));
      }
    }
  } finally {
    await conn.end().catch(() => undefined);
  }

  // 7. Relatorio
  log("=== RELATORIO ===");
  log(`modo: ${mode} · time_zone: global=${tz.global} session=${tz.session}`);
  log(`contagem final ${run === "apply" ? "relida do banco apos COMMIT" : "relida dentro da transacao antes do ROLLBACK"}:`);
  const divergent: string[] = [];
  for (const name of plan.order) {
    const read = readCounts.get(name) ?? 0;
    const sel = selectedCounts.get(name) ?? 0;
    const ins = insertedCounts.get(name) ?? 0;
    const fin = finalCounts.get(name) ?? 0;
    const ref = plan.referenceCounts[name];
    const ok = fin === ref;
    if (!ok) divergent.push(name);
    const selTxt = sel !== read ? `selecionadas ${sel} / ` : "";
    log(`  ${name}: lidas ${read} / ${selTxt}inseridas ${ins} / banco ${fin} / referencia ${ref} -> ${ok ? "ok" : "DIVERGE"}`);
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
