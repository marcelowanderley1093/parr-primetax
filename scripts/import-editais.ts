// Carga da base de editais PGFN (PARR) no MySQL da VPS: editais, leads (par pessoa + empresa) e lead_procedimentos.
//
// Uso: pnpm tsx scripts/import-editais.ts --file <editais-consolidado.csv> (--dry-run | --apply)
//   O CSV vem de scripts/converter-editais.ts (rodado na maquina local). DATABASE_URL vem do ambiente.
//   Exige a migracao 0010 aplicada.
//   --dry-run  le o arquivo e o banco e imprime o plano (contagens). NAO grava nada.
//   --apply    grava em lotes. Idempotente: o numero do procedimento e unico e o plano e recalculado a partir do
//              banco; se cair no meio, rodar de novo completa sem duplicar.
//   Leads existentes nunca perdem dados: so ganham CPF parcial, datas de publicacao, devedor (se vazio) e grupo;
//   updatedAt e preservado (updatedAt = updatedAt).
//
// Nunca imprime valores de linha: so contagens. Logica pura em scripts/lib/importEditais.ts.
import "dotenv/config";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import {
  ImportEditaisAbort, LayoutEditaisError, chaveEdital, chaveLead, cnpj14, lerCsvEditais, parseArgsEditais, planejarImportacao,
  type LeadExistente,
} from "./lib/importEditais";

const LOTE_LEADS = 1000;
const LOTE_PROCEDIMENTOS = 2000;

/** Mensagem de erro do driver sem trechos entre aspas (podem conter valores de linha). */
function safeErrorMessage(error: unknown): string {
  const e = error as { code?: string; errno?: number; sqlState?: string; message?: string };
  const message = String(e?.message ?? error).replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"');
  const parts = [e?.code, e?.errno, e?.sqlState].filter(v => v !== undefined && v !== null);
  return `${parts.length ? `[${parts.join(" ")}] ` : ""}${message}`;
}

async function contar(conn: mysql.Connection, query: string): Promise<number> {
  const [r] = await conn.query(query);
  return Number((r as Array<{ n: number | string }>)[0]?.n ?? 0);
}

async function carregarEditais(conn: mysql.Connection): Promise<Map<string, number>> {
  const [rows] = await conn.query("SELECT id, ano, numero FROM editais");
  return new Map((rows as Array<{ id: number; ano: number; numero: string }>).map(e => [chaveEdital(e.ano, e.numero), e.id]));
}

async function main(): Promise<number> {
  const { file, run } = parseArgsEditais(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new ImportEditaisAbort("DATABASE_URL nao definida no ambiente");
  console.log(`=== import-editais: ${run.toUpperCase()} ===`);

  // 1. Arquivo
  const { linhas, descartes, lidas } = lerCsvEditais(readFileSync(file, "utf-8"));
  console.log(`--- arquivo: ${lidas} linha(s) lidas · ${linhas.length} validas`);
  for (const [k, v] of Object.entries(descartes)) console.log(`    descartadas (${k}): ${v}`);

  // dateStrings: colunas DATE voltam como "aaaa-mm-dd" (sem conversao de fuso).
  const conn = await mysql.createConnection({ uri: databaseUrl, dateStrings: ["DATE"] });
  const db = drizzle(conn);
  try {
    // 2. Guarda: migracao 0010
    const tabelas = await contar(conn,
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('editais','lead_procedimentos')");
    const colunas = await contar(conn,
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'leads' AND column_name IN ('cpfParcial','grupoId','ultimaPublicacao')");
    if (tabelas !== 2 || colunas !== 3) throw new ImportEditaisAbort("migracao 0010 nao aplicada (tabelas/colunas ausentes)");

    // 3. Estado atual do banco
    const [leadRows] = await conn.query(
      "SELECT id, nome, cnpj, cpfParcial, grupoId, primeiraPublicacao, ultimaPublicacao, devedorPrincipal FROM leads");
    const leads = leadRows as LeadExistente[];
    const [procRows] = await conn.query("SELECT numeroProcedimento FROM lead_procedimentos");
    const procedimentos = new Set((procRows as Array<{ numeroProcedimento: string }>).map(r => r.numeroProcedimento));
    const editais = await carregarEditais(conn);
    const maxGrupoId = await contar(conn, "SELECT COALESCE(MAX(grupoId), 0) AS n FROM leads");
    const antes = {
      leads: leads.length,
      comCpfParcial: leads.filter(l => l.cpfParcial).length,
      procedimentos: procedimentos.size,
      editais: editais.size,
    };
    console.log(`--- banco antes: ${antes.leads} leads (${antes.comCpfParcial} com CPF parcial) · ${antes.procedimentos} procedimentos · ${antes.editais} editais`);

    // 4. Plano
    const plano = planejarImportacao(linhas, { leads, procedimentos, editais, maxGrupoId });
    const r = plano.resumo;
    console.log("--- plano");
    console.log(`  editais: ${r.editaisNoArquivo} no arquivo · ${r.editaisNovos} novos · data divergente entre linhas: ${r.editaisDataDivergente}`);
    console.log(`  leads (pessoa + empresa): ${r.leadsNoArquivo} no arquivo · ${r.leadsNovos} novos`);
    console.log(`  leads existentes casados: ${r.leadsCasadosPorChave} por chave · ${r.leadsCasadosPorNomeCnpj} por nome + CNPJ (antigos) · ambiguos: ${r.casamentosAmbiguos}`);
    console.log(`  leads existentes a atualizar: ${r.leadsExistentesAtualizados}`);
    console.log(`  procedimentos: ${r.procedimentosNoArquivo} no arquivo · ${r.procedimentosJaNoBanco} ja no banco · ${r.procedimentosNovos} novos`);
    console.log(`  grupos: ${r.grupos} · com mais de um lead: ${r.gruposComMaisDeUmLead} · maior: ${r.maiorGrupo}`);
    const coerente = r.procedimentosNovos + r.procedimentosJaNoBanco === r.linhasValidas;
    if (!coerente) throw new ImportEditaisAbort("plano incoerente: procedimentos novos + ja no banco != linhas validas");

    if (run === "dry-run") {
      console.log("  (dry-run: nada gravado)");
      console.log("PASSOU");
      return 0;
    }

    // 5. Gravacao (lotes; cada INSERT de varias linhas e atomico)
    console.log("--- gravacao");
    for (let i = 0; i < plano.editaisNovos.length; i += 500) {
      await db.insert(schema.editais).ignore().values(plano.editaisNovos.slice(i, i + 500));
    }
    const editaisIds = await carregarEditais(conn);
    console.log(`  editais gravados: ${plano.editaisNovos.length}`);

    let leadsInseridos = 0;
    for (let i = 0; i < plano.leadsNovos.length; i += LOTE_LEADS) {
      const lote = plano.leadsNovos.slice(i, i + LOTE_LEADS).map(l => ({
        nome: l.nome, email: "", telefone: "", cnpj: l.cnpj, devedorPrincipal: l.devedorPrincipal,
        lgpdConsent: 0, status: "novo_lead" as const, cpfParcial: l.cpfParcial, grupoId: l.grupoId,
        primeiraPublicacao: l.primeiraPublicacao, ultimaPublicacao: l.ultimaPublicacao,
      }));
      await db.insert(schema.leads).values(lote);
      leadsInseridos += lote.length;
      if ((i / LOTE_LEADS) % 50 === 0) console.log(`  leads: ${leadsInseridos}/${plano.leadsNovos.length}`);
    }
    console.log(`  leads inseridos: ${leadsInseridos}`);

    let leadsAtualizados = 0;
    await db.transaction(async tx => {
      for (const u of plano.leadsAtualizar) {
        await tx.update(schema.leads).set({
          cpfParcial: u.cpfParcial, primeiraPublicacao: u.primeiraPublicacao, ultimaPublicacao: u.ultimaPublicacao,
          devedorPrincipal: u.devedorPrincipal, grupoId: u.grupoId,
          updatedAt: sql`\`updatedAt\``, // atribuicao explicita impede o ON UPDATE CURRENT_TIMESTAMP
        }).where(eq(schema.leads.id, u.id));
        leadsAtualizados++;
      }
    });
    console.log(`  leads existentes atualizados: ${leadsAtualizados}`);

    // chave do lead -> id (todos os leads com CPF parcial, inclusive os recem-inseridos e os antigos casados)
    const [comChave] = await conn.query("SELECT id, nome, cnpj, cpfParcial FROM leads WHERE cpfParcial IS NOT NULL");
    const idPorChave = new Map<string, number>();
    for (const l of comChave as Array<{ id: number; nome: string; cnpj: string | null; cpfParcial: string }>) {
      const c = cnpj14(l.cnpj);
      if (c) idPorChave.set(chaveLead(l.nome, l.cpfParcial, c), l.id);
    }

    let procInseridos = 0;
    let semLead = 0;
    for (let i = 0; i < plano.procedimentosNovos.length; i += LOTE_PROCEDIMENTOS) {
      const lote = [];
      for (const p of plano.procedimentosNovos.slice(i, i + LOTE_PROCEDIMENTOS)) {
        const leadId = idPorChave.get(p.chaveLead);
        const editalId = editaisIds.get(p.chaveEdital);
        if (!leadId || !editalId) { semLead++; continue; }
        lote.push({ leadId, editalId, numeroProcedimento: p.numeroProcedimento, cpfParcial: p.cpfParcial, pagina: p.pagina });
      }
      if (lote.length) await db.insert(schema.leadProcedimentos).ignore().values(lote);
      procInseridos += lote.length;
      if ((i / LOTE_PROCEDIMENTOS) % 50 === 0) console.log(`  procedimentos: ${procInseridos}/${plano.procedimentosNovos.length}`);
    }
    console.log(`  procedimentos gravados: ${procInseridos} · sem lead/edital correspondente: ${semLead}`);

    // 6. Conferencia
    const depois = {
      leads: await contar(conn, "SELECT COUNT(*) AS n FROM leads"),
      comCpfParcial: await contar(conn, "SELECT COUNT(*) AS n FROM leads WHERE cpfParcial IS NOT NULL"),
      procedimentos: await contar(conn, "SELECT COUNT(*) AS n FROM lead_procedimentos"),
      editais: await contar(conn, "SELECT COUNT(*) AS n FROM editais"),
    };
    const tinhaCpf = new Set(leads.filter(l => l.cpfParcial).map(l => l.id));
    const ganhouCpf = plano.leadsAtualizar.filter(u => u.cpfParcial && !tinhaCpf.has(u.id)).length;
    const esperado = {
      leads: antes.leads + plano.leadsNovos.length,
      comCpfParcial: antes.comCpfParcial + plano.leadsNovos.length + ganhouCpf,
      procedimentos: antes.procedimentos + plano.procedimentosNovos.length,
      editais: antes.editais + plano.editaisNovos.length,
    };
    console.log("=== CONFERENCIA (banco depois / esperado) ===");
    let ok = semLead === 0;
    for (const k of Object.keys(esperado) as (keyof typeof esperado)[]) {
      const bate = depois[k] === esperado[k];
      ok &&= bate;
      console.log(`  ${k}: ${depois[k]} / ${esperado[k]} -> ${bate ? "ok" : "DIVERGE"}`);
    }
    if (ok) {
      console.log("PASSOU");
      return 0;
    }
    console.log("PARAR: contagem divergente (rodar de novo completa o que faltou; nada e duplicado)");
    return 1;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    if (error instanceof ImportEditaisAbort || error instanceof LayoutEditaisError) console.error(`PARAR: ${error.message}`);
    else console.error(`PARAR: erro inesperado: ${safeErrorMessage(error)}`);
    process.exit(1);
  });
