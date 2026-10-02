// Atribui os leads JA EM ANDAMENTO (status diferente de "novo_lead") a quem os moveu, levando o grupo inteiro.
//
// Uso: pnpm tsx scripts/atribuir-andamento.ts (--dry-run | --apply)
//   DATABASE_URL vem do ambiente. Exige a migracao 0010 (leads.responsavelId, leads.grupoId).
//   --dry-run  imprime o plano (contagens + ids dos leads pendentes). NAO grava nada.
//   --apply    grava em uma transacao. Leads que ja tem responsavel nunca sao alterados; updatedAt preservado.
//
// Imprime so contagens e ids internos de lead (nunca nomes, CPF ou contatos). Logica pura em scripts/lib/atribuirAndamento.ts.
import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import { MigracaoAbort, parseArgsMigracao } from "./lib/migrarContatos";
import { planejarAtribuicao, type LeadAndamento, type LeadDoGrupo, type MudancaStatus, type UsuarioLocal } from "./lib/atribuirAndamento";

function safeErrorMessage(error: unknown): string {
  const e = error as { code?: string; errno?: number; sqlState?: string; message?: string };
  const message = String(e?.message ?? error).replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"');
  const parts = [e?.code, e?.errno, e?.sqlState].filter(v => v !== undefined && v !== null);
  return `${parts.length ? `[${parts.join(" ")}] ` : ""}${message}`;
}

async function main(): Promise<number> {
  const { run } = parseArgsMigracao(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new MigracaoAbort("DATABASE_URL nao definida no ambiente");
  console.log(`=== atribuir-andamento: ${run.toUpperCase()} ===`);

  const conn = await mysql.createConnection(databaseUrl);
  const db = drizzle(conn);
  try {
    const [a] = await conn.query("SELECT id, status, grupoId, responsavelId FROM leads WHERE status <> 'novo_lead'");
    const andamento = a as LeadAndamento[];
    const ids = andamento.map(l => l.id);
    const grupos = Array.from(new Set(andamento.map(l => l.grupoId).filter((g): g is number => g !== null)));
    const [h] = ids.length
      ? await conn.query("SELECT id, leadId, userName, createdAt FROM lead_status_history WHERE leadId IN (?)", [ids])
      : [[]];
    const [u] = await conn.query("SELECT id, nome FROM local_users");
    const [g] = grupos.length
      ? await conn.query("SELECT id, grupoId, responsavelId FROM leads WHERE grupoId IN (?)", [grupos])
      : [[]];

    const plano = planejarAtribuicao(andamento, h as MudancaStatus[], u as UsuarioLocal[], g as LeadDoGrupo[]);
    console.log("--- plano");
    for (const [k, v] of Object.entries(plano.resumo)) console.log(`  ${k}: ${v}`);
    if (plano.pendentes.length) {
      console.log("--- pendentes (id do lead: motivo) — decidir pelo painel na Fase B2");
      for (const p of plano.pendentes) console.log(`  ${p.leadId}: ${p.motivo}`);
    }

    if (run === "dry-run") {
      console.log("  (dry-run: nada gravado)");
      console.log("PASSOU");
      return 0;
    }

    let gravados = 0;
    const agora = new Date();
    await db.transaction(async tx => {
      for (const at of plano.atribuicoes) {
        const r = await tx
          .update(schema.leads)
          .set({ responsavelId: at.responsavelId, atribuidoEm: agora, updatedAt: sql`\`updatedAt\`` })
          .where(and(eq(schema.leads.id, at.leadId), isNull(schema.leads.responsavelId)));
        gravados += Number((r as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
      }
    });
    console.log(`=== CONFERENCIA: atribuidos ${gravados} / planejados ${plano.atribuicoes.length} ===`);
    if (gravados === plano.atribuicoes.length) {
      console.log("PASSOU");
      return 0;
    }
    console.log("PARAR: contagem divergente");
    return 1;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    if (error instanceof MigracaoAbort) console.error(`PARAR: ${error.message}`);
    else console.error(`PARAR: erro inesperado: ${safeErrorMessage(error)}`);
    process.exit(1);
  });
