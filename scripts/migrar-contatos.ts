// Copia leads.telefoneSocios (JSON legado, somente leitura) para lead_contatos (editavel pelo comercial).
//
// Uso: pnpm tsx scripts/migrar-contatos.ts (--dry-run | --apply)
//   DATABASE_URL vem do ambiente (nunca e impressa). Exige a migracao 0009 aplicada.
//   --dry-run  roda a transacao inteira (guarda, inserts, recontagem) e termina com ROLLBACK.
//   --apply    commita.
//   Guarda: lead_contatos precisa estar VAZIA (impede rodar duas vezes). Nada e apagado ou alterado:
//   leads.telefoneSocios fica intacto e leads.cpf nao e preenchido.
//
// Nunca imprime valores de linha: so contagens. Regras de validacao em scripts/lib/migrarContatos.ts.
import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import {
  MigracaoAbort,
  contatosDoLead,
  estatisticasVazias,
  parseArgsMigracao,
  type ContatoNovo,
} from "./lib/migrarContatos";

const BATCH_SIZE = 500;

class DryRunRollback extends Error {}

/** Mensagem de erro do driver sem trechos entre aspas (podem conter valores de linha). */
function safeErrorMessage(error: unknown): string {
  const e = error as { code?: string; errno?: number; sqlState?: string; message?: string };
  const message = String(e?.message ?? error).replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"');
  const parts = [e?.code, e?.errno, e?.sqlState].filter(v => v !== undefined && v !== null);
  return `${parts.length ? `[${parts.join(" ")}] ` : ""}${message}`;
}

async function count(conn: mysql.Connection, query: string): Promise<number> {
  const [r] = await conn.query(query);
  return Number((r as Array<{ n: number | string }>)[0]?.n ?? 0);
}

async function main(): Promise<number> {
  const { run } = parseArgsMigracao(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new MigracaoAbort("DATABASE_URL nao definida no ambiente");
  console.log(`=== migrar-contatos: ${run.toUpperCase()} ===`);

  const conn = await mysql.createConnection(databaseUrl);
  const db = drizzle(conn);
  let finalCount = 0;
  let inserted = 0;
  const stats = estatisticasVazias();
  let totalLeads = 0;

  try {
    // Guarda 1: migracao 0009 aplicada
    const tabela = await count(
      conn,
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'lead_contatos'",
    );
    if (tabela === 0) throw new MigracaoAbort("tabela lead_contatos nao existe: aplique a migracao 0009 antes");

    // Guarda 2: destino vazio
    const existentes = await count(conn, "SELECT COUNT(*) AS n FROM `lead_contatos`");
    console.log(`--- guarda: lead_contatos com ${existentes} linha(s)`);
    if (existentes > 0) throw new MigracaoAbort("lead_contatos nao esta vazia (a copia ja rodou?); nada foi feito");

    // Leitura (so as colunas necessarias)
    totalLeads = await count(conn, "SELECT COUNT(*) AS n FROM `leads`");
    const [rows] = await conn.query(
      "SELECT id, nome, telefoneSocios FROM `leads` WHERE telefoneSocios IS NOT NULL AND telefoneSocios <> '' ORDER BY id",
    );
    const leads = rows as Array<{ id: number; nome: string; telefoneSocios: string }>;
    const contatos: ContatoNovo[] = [];
    for (const lead of leads) contatos.push(...contatosDoLead(lead, stats));

    // Transacao unica
    console.log(`--- transacao (${run})`);
    try {
      await db.transaction(async tx => {
        for (let i = 0; i < contatos.length; i += BATCH_SIZE) {
          const batch = contatos.slice(i, i + BATCH_SIZE);
          await tx.insert(schema.leadContatos).values(batch);
          inserted += batch.length;
        }
        const r = await tx.execute(sql.raw("SELECT COUNT(*) AS n FROM `lead_contatos`"));
        finalCount = Number((r as unknown as [Array<{ n: number | string }>])[0]?.[0]?.n ?? 0);
        if (run === "dry-run") throw new DryRunRollback();
      });
      console.log("  COMMIT");
    } catch (error) {
      if (error instanceof DryRunRollback) console.log("  ROLLBACK (dry-run)");
      else throw error;
    }
    if (run === "apply") finalCount = await count(conn, "SELECT COUNT(*) AS n FROM `lead_contatos`");
  } finally {
    await conn.end().catch(() => undefined);
  }

  console.log("=== RELATORIO ===");
  console.log(`leads no banco: ${totalLeads} · com JSON de socios: ${stats.leadsComJson} · JSON invalido: ${stats.jsonInvalido}`);
  console.log(`socios lidos: ${stats.sociosLidos}`);
  console.log(`  descartados por nome invalido: ${stats.sociosNomeInvalido}`);
  console.log(`  descartados sem telefone e sem CPF: ${stats.sociosSemTelefoneESemCpf}`);
  console.log(`  so com CPF, sem telefone (nao viram contato; JSON preservado): ${stats.sociosSoComCpf}`);
  console.log(`  com o mesmo nome do lead (candidatos a intimado; informativo): ${stats.sociosMesmoNomeDoLead}`);
  console.log(`CPFs validos: ${stats.cpfsValidos} · CPFs invalidos ignorados: ${stats.cpfsInvalidosZerados}`);
  console.log(`telefones lidos: ${stats.telefonesLidos} · invalidos: ${stats.telefonesInvalidos} · duplicados: ${stats.telefonesDuplicados}`);
  console.log(`contatos gerados: ${stats.contatosGerados} · inseridos: ${inserted} · lead_contatos ${run === "apply" ? "apos COMMIT" : "antes do ROLLBACK"}: ${finalCount}`);
  if (finalCount === stats.contatosGerados && inserted === stats.contatosGerados) {
    console.log("PASSOU");
    return 0;
  }
  console.log("PARAR: contagem divergente");
  return 1;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    if (error instanceof MigracaoAbort) console.error(`PARAR: ${error.message}`);
    else console.error(`PARAR: erro inesperado: ${safeErrorMessage(error)}`);
    process.exit(1);
  });
