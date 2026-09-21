// Sonda ESTRUTURAL do export da Manus. Imprime somente metadados: formato do topo, nomes de
// tabelas, contagens, nomes de colunas, contagem de nulos e tipo JS predominante por coluna.
// NUNCA imprime valor de linha. O JSON contem dados pessoais e hashes de senha.
//
// Uso: pnpm tsx scripts/sonda-export.ts <caminho-do-json>
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../drizzle/schema";

type JsType = "string" | "number" | "boolean" | "null" | "object" | "array" | "undefined";

function jsType(v: unknown): JsType {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return t;
  return "object";
}

type ColumnStats = { nullOrMissing: number; types: Map<JsType, number> };

function describeRows(rows: unknown[]): Map<string, ColumnStats> {
  const cols = new Map<string, ColumnStats>();
  const allKeys = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      for (const k of Object.keys(row as object)) allKeys.add(k);
    }
  }
  for (const k of allKeys) cols.set(k, { nullOrMissing: 0, types: new Map() });
  for (const row of rows) {
    const obj = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
    for (const k of allKeys) {
      const stats = cols.get(k)!;
      const has = Object.prototype.hasOwnProperty.call(obj, k);
      const v = has ? obj[k] : undefined;
      if (!has || v === null || v === undefined) {
        stats.nullOrMissing += 1;
        continue;
      }
      const t = jsType(v);
      stats.types.set(t, (stats.types.get(t) ?? 0) + 1);
    }
  }
  return cols;
}

function predominant(types: Map<JsType, number>): string {
  if (types.size === 0) return "null";
  let best: JsType = "null";
  let bestCount = -1;
  for (const [t, c] of types) {
    if (c > bestCount) {
      best = t;
      bestCount = c;
    }
  }
  const others = [...types.entries()].filter(([t]) => t !== best).map(([t, c]) => `${t}:${c}`);
  return others.length > 0 ? `${best} (outros: ${others.join(", ")})` : best;
}

// Localiza "tabelas" = pares nome -> array de objetos, em varios formatos plausiveis de export.
type Table = { name: string; rows: unknown[]; wrapperKeys?: string[] };

const ROW_KEYS = ["rows", "data", "records", "items"];

function findTables(top: unknown): { layout: string; tables: Table[] } {
  if (Array.isArray(top)) {
    // Formato A: array de { table|name, rows|data }
    const tables: Table[] = [];
    for (const item of top) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        const name = typeof o.table === "string" ? o.table : typeof o.name === "string" ? o.name : null;
        const rows = Array.isArray(o.rows) ? o.rows : Array.isArray(o.data) ? o.data : null;
        if (name && rows) tables.push({ name, rows });
      }
    }
    return { layout: "array de objetos {table|name, rows|data}", tables };
  }
  if (top && typeof top === "object") {
    const o = top as Record<string, unknown>;
    // Formato B: { tabela: [...], tabela2: [...] } no topo
    const direct: Table[] = [];
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v)) direct.push({ name: k, rows: v });
    }
    if (direct.length > 0) return { layout: "objeto com arrays por tabela no topo", tables: direct };
    // Formato D: { tabela: { rows|data|records|items: [...], ...metadados } }
    const wrapped: Table[] = [];
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const inner = v as Record<string, unknown>;
        const rowKey = ROW_KEYS.find(rk => Array.isArray(inner[rk]));
        if (rowKey) wrapped.push({ name: k, rows: inner[rowKey] as unknown[], wrapperKeys: Object.keys(inner).map(key => (key === rowKey ? `${key}[]` : `${key}:${jsType(inner[key])}`)) });
      }
    }
    if (wrapped.length > 0) return { layout: "objeto com {rows|data|records|items, ...} por tabela", tables: wrapped };
    // Formato C: { tables|data: { tabela: [...] } } ou { tables: [ {name, rows} ] }
    for (const wrapper of ["tables", "data", "db", "database"]) {
      const inner = o[wrapper];
      if (inner && typeof inner === "object") {
        const r = findTables(inner);
        if (r.tables.length > 0) return { layout: `chave "${wrapper}" -> ${r.layout}`, tables: r.tables };
      }
    }
  }
  return { layout: "nao reconhecido", tables: [] };
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("PARAR: informe o caminho do JSON como argumento.");
    process.exit(1);
  }
  const raw = readFileSync(path, "utf-8");
  const top: unknown = JSON.parse(raw);

  console.log("=== 1. FORMATO DO TOPO ===");
  const topType = jsType(top);
  console.log(`tipo: ${topType}; bytes: ${Buffer.byteLength(raw, "utf-8")}`);
  if (topType === "array") {
    console.log(`array com ${(top as unknown[]).length} elemento(s)`);
  } else if (topType === "object") {
    const o = top as Record<string, unknown>;
    console.log("chaves de topo (nome: tipo[, tamanho se array]):");
    for (const [k, v] of Object.entries(o)) {
      const t = jsType(v);
      const extra = t === "array" ? ` [${(v as unknown[]).length}]` : t === "object" ? ` {${Object.keys(v as object).length} chaves}` : "";
      console.log(`  - ${k}: ${t}${extra}`);
    }
  }

  const { layout, tables } = findTables(top);
  console.log(`layout detectado: ${layout}`);

  console.log("\n=== 2. TABELAS E NUMERO DE LINHAS ===");
  for (const t of tables) console.log(`  ${t.name}: ${t.rows.length} linha(s)${t.wrapperKeys ? `  (objeto da tabela: ${t.wrapperKeys.join(", ")})` : ""}`);
  if (tables.length === 0) console.log("  (nenhuma tabela reconhecida)");

  console.log("\n=== 3. COLUNAS POR TABELA (nome | nulos/ausentes | tipo predominante) ===");
  for (const t of tables) {
    console.log(`  [${t.name}] ${t.rows.length} linha(s)`);
    const nonObject = t.rows.filter(r => !(r && typeof r === "object" && !Array.isArray(r))).length;
    if (nonObject > 0) console.log(`    (atencao: ${nonObject} linha(s) nao sao objetos)`);
    const cols = describeRows(t.rows);
    const names = [...cols.keys()].sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const s = cols.get(name)!;
      console.log(`    ${name} | nulos/ausentes: ${s.nullOrMissing}/${t.rows.length} | ${predominant(s.types)}`);
    }
  }

  console.log("\n=== 4. ORDEM DAS TABELAS NO ARQUIVO ===");
  console.log("  " + (tables.length ? tables.map((t, i) => `${i + 1}. ${t.name}`).join("  ") : "(nenhuma)"));

  console.log("\n=== 5. SCHEMA DO REPO (drizzle/schema.ts) ===");
  for (const exported of Object.values(schema)) {
    if (!is(exported, MySqlTable)) continue; // ignora enum/tipos exportados
    const name = getTableName(exported);
    const cols = getTableColumns(exported) as Record<string, { name: string; dataType: string; notNull: boolean; hasDefault: boolean }>;
    const list = Object.values(cols).map(c => `${c.name}:${c.dataType}${c.notNull ? "" : "?"}${c.hasDefault ? "=" : ""}`);
    console.log(`  ${name} (${list.length} colunas): ${list.join(", ")}`);
  }
  console.log("  legenda: ? = nullable, = tem default");

  // Secao 6: SOMENTE os nomes de chave (settingKey) de site_settings, em ordem alfabetica.
  // settingValue e qualquer outra coluna nunca sao lidos aqui.
  console.log("\n=== 6. CHAVES DE site_settings (settingKey, ordem alfabetica) ===");
  const siteSettings = tables.find(t => t.name === "site_settings");
  if (!siteSettings) {
    console.log("  (tabela site_settings nao encontrada)");
  } else {
    const keys = siteSettings.rows
      .map(r => (r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>).settingKey : undefined))
      .filter((k): k is string => typeof k === "string")
      .sort((a, b) => a.localeCompare(b));
    for (const k of keys) console.log(`  ${k}`);
    console.log(`  (${keys.length} chave(s) de ${siteSettings.rows.length} linha(s))`);
  }
}

main();
