// Sincronizacao de uma empresa pela API EmpresAqui (Fase D, decisoes de 05/10/2026):
// - admin e parceiro podem sincronizar (o parceiro so leads da propria carteira; checado na rota);
// - cache: empresa consultada ha menos de `cacheDias` nao e consultada de novo (nem quando o CNPJ nao foi encontrado);
// - teto mensal de consultas (padrao 500), contado localmente em integracao_consultas (a API nao informa saldo);
// - grava em empresas.dados.api / brutoApi sem apagar o que veio do CSV (dados.csv / brutoCsv);
// - EmpresAqui nunca toca nome, telefone, e-mail, CPF ou contatos do lead.
// Token so na variavel de ambiente EMPRESAQUI_API_TOKEN; nunca no banco, no log ou na tela.
import { and, eq, gte, sql } from "drizzle-orm";
import { empresas, integracaoConsultas, leads } from "../../drizzle/schema";
import { getDb, getSetting, setSetting } from "../db";
import { consultarCnpj, type ResultadoConsulta } from "./clienteApi";

export const INTEGRACAO = "empresaqui";
export const PADRAO_CACHE_DIAS = 30;
export const PADRAO_TETO_MENSAL = 500;
const CHAVE_CACHE = "empresaqui.cacheDias";
const CHAVE_TETO = "empresaqui.tetoMensal";
const DIA_MS = 24 * 60 * 60 * 1000;

export class IntegracaoIndisponivelError extends Error {}
export class TetoAtingidoError extends Error {}

export const tokenConfigurado = (): boolean => !!process.env.EMPRESAQUI_API_TOKEN;

async function banco() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export async function getConfig(): Promise<{ cacheDias: number; tetoMensal: number }> {
  const [c, t] = await Promise.all([getSetting(CHAVE_CACHE), getSetting(CHAVE_TETO)]);
  const n = (v: string | null, padrao: number) => (v !== null && /^\d+$/.test(v) ? Number(v) : padrao);
  return { cacheDias: n(c, PADRAO_CACHE_DIAS), tetoMensal: n(t, PADRAO_TETO_MENSAL) };
}

export async function salvarConfig(cfg: { cacheDias: number; tetoMensal: number }) {
  await setSetting(CHAVE_CACHE, String(cfg.cacheDias));
  await setSetting(CHAVE_TETO, String(cfg.tetoMensal));
}

/** Primeiro instante do mes corrente no horario de Brasilia (UTC-3), em UTC. */
export function inicioDoMesBrasil(agora = new Date()): Date {
  const br = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), 1, 3));
}

/** Consultas feitas a API no mes (cache nao conta), por resultado. */
export async function consumoDoMes(agora = new Date()) {
  const db = await banco();
  const rows = await db
    .select({ resultado: integracaoConsultas.resultado, n: sql<number>`COUNT(*)` })
    .from(integracaoConsultas)
    .where(and(eq(integracaoConsultas.integracao, INTEGRACAO), gte(integracaoConsultas.createdAt, inicioDoMesBrasil(agora))))
    .groupBy(integracaoConsultas.resultado);
  const porResultado = Object.fromEntries(rows.map(r => [r.resultado, Number(r.n)])) as Record<string, number>;
  return { total: rows.reduce((s, r) => s + Number(r.n), 0), porResultado };
}

/** O cache ainda vale? (consulta anterior ha menos de `cacheDias`). */
export function cacheValido(apiAtualizadoEm: Date | null | undefined, cacheDias: number, agora = new Date()): boolean {
  return !!apiAtualizadoEm && agora.getTime() - new Date(apiAtualizadoEm).getTime() < cacheDias * DIA_MS;
}

const corta = (s: string | null, max: number) => (s === null ? null : s.slice(0, max));
const formatarCnpj = (d: string) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;

/** Liga a empresa aos leads com este CNPJ (formatado ou so digitos; usa o indice de leads.cnpj). */
async function vincularLeads(cnpj14: string, empresaId: number) {
  const db = await banco();
  await db.execute(sql`UPDATE leads SET empresaId = ${empresaId}, updatedAt = updatedAt
    WHERE cnpj IN (${formatarCnpj(cnpj14)}, ${cnpj14}) AND (empresaId IS NULL OR empresaId <> ${empresaId})`);
}

async function registrarConsulta(cnpj14: string, r: ResultadoConsulta, userId: number | null) {
  const db = await banco();
  const resultado = r.tipo === "ok" ? "ok" : r.tipo === "nao_encontrado" ? "nao_encontrado" : r.codigo === "limite" ? "limite" : "erro";
  await db.insert(integracaoConsultas).values({ integracao: INTEGRACAO, cnpj: cnpj14, resultado, httpStatus: r.http, userId });
}

async function gravarResultado(cnpj14: string, r: ResultadoConsulta, agora: Date): Promise<number | null> {
  const db = await banco();
  if (r.tipo === "ok") {
    const d = r.dados;
    const v = (c: string) => sql.raw(`VALUES(\`${c}\`)`);
    await db.insert(empresas).values({
      cnpj: cnpj14,
      razaoSocial: corta(d.razaoSocial, 255),
      nomeFantasia: corta(d.nomeFantasia, 255),
      situacaoCadastral: corta(d.situacaoCadastral, 20),
      regimeTributario: corta(d.regimeTributario, 60),
      porte: corta(d.porte, 40),
      cnaePrincipal: d.cnaePrincipal,
      uf: corta(d.endereco.uf, 2),
      municipio: corta(d.endereco.municipio, 120),
      totalDividasCentavos: d.totalDividasCentavos,
      qtdInscricoes: d.dividas.length,
      dados: { api: d },
      brutoApi: r.bruto,
      apiAtualizadoEm: agora,
      syncStatus: "ok",
      syncErro: null,
    }).onDuplicateKeyUpdate({
      set: {
        razaoSocial: v("razaoSocial"), nomeFantasia: v("nomeFantasia"), situacaoCadastral: v("situacaoCadastral"),
        regimeTributario: v("regimeTributario"), porte: v("porte"), cnaePrincipal: v("cnaePrincipal"), uf: v("uf"),
        municipio: v("municipio"), totalDividasCentavos: v("totalDividasCentavos"), qtdInscricoes: v("qtdInscricoes"),
        brutoApi: v("brutoApi"), apiAtualizadoEm: v("apiAtualizadoEm"), syncStatus: v("syncStatus"), syncErro: v("syncErro"),
        // so a parte "api" do JSON: o que veio do CSV fica
        dados: sql.raw("JSON_SET(COALESCE(`dados`, JSON_OBJECT()), '$.api', JSON_EXTRACT(VALUES(`dados`), '$.api'))"),
      },
    });
  } else {
    const status = r.tipo === "nao_encontrado" ? ("nao_encontrado" as const) : ("erro" as const);
    const erro = r.tipo === "erro" ? r.codigo : null;
    // nao encontrado entra no cache (apiAtualizadoEm), para nao gastar consulta de novo; erro nao.
    await db.insert(empresas).values({ cnpj: cnpj14, syncStatus: status, syncErro: erro, apiAtualizadoEm: status === "nao_encontrado" ? agora : null })
      .onDuplicateKeyUpdate({ set: status === "nao_encontrado"
        ? { syncStatus: status, syncErro: null, apiAtualizadoEm: agora }
        : { syncStatus: status, syncErro: erro } });
  }
  const [e] = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.cnpj, cnpj14)).limit(1);
  return e?.id ?? null;
}

export type ResultadoSincronizacao =
  | { status: "ok" | "cache"; empresaId: number; apiAtualizadoEm: Date }
  | { status: "nao_encontrado"; empresaId: number | null }
  | { status: "erro"; codigo: Extract<ResultadoConsulta, { tipo: "erro" }>["codigo"] };

/**
 * Sincroniza a empresa do CNPJ (14 digitos, DV ja validado). `forcar` ignora o cache (so admin, na rota).
 * Lanca IntegracaoIndisponivelError (sem token) e TetoAtingidoError (teto mensal).
 */
export async function sincronizarEmpresa(
  cnpj14: string,
  opts: { userId: number | null; forcar?: boolean; agora?: Date; consultar?: typeof consultarCnpj },
): Promise<ResultadoSincronizacao> {
  const db = await banco();
  const agora = opts.agora ?? new Date();
  const cfg = await getConfig();
  const [atual] = await db
    .select({ id: empresas.id, apiAtualizadoEm: empresas.apiAtualizadoEm, syncStatus: empresas.syncStatus })
    .from(empresas).where(eq(empresas.cnpj, cnpj14)).limit(1);
  if (!opts.forcar && atual && cacheValido(atual.apiAtualizadoEm, cfg.cacheDias, agora)) {
    if (atual.syncStatus === "nao_encontrado") return { status: "nao_encontrado", empresaId: atual.id };
    await vincularLeads(cnpj14, atual.id);
    return { status: "cache", empresaId: atual.id, apiAtualizadoEm: atual.apiAtualizadoEm! };
  }

  const token = process.env.EMPRESAQUI_API_TOKEN;
  if (!token) throw new IntegracaoIndisponivelError("Integração EmpresAqui não configurada (falta o token no servidor).");
  const consumo = await consumoDoMes(agora);
  if (consumo.total >= cfg.tetoMensal) {
    throw new TetoAtingidoError(`Teto mensal de ${cfg.tetoMensal} consultas atingido. Ajuste em Configurações > Integrações.`);
  }

  const r = await (opts.consultar ?? consultarCnpj)(cnpj14, token);
  await registrarConsulta(cnpj14, r, opts.userId);
  const empresaId = await gravarResultado(cnpj14, r, agora);
  if (r.tipo === "ok" && empresaId !== null) {
    await vincularLeads(cnpj14, empresaId);
    return { status: "ok", empresaId, apiAtualizadoEm: agora };
  }
  if (r.tipo === "nao_encontrado") return { status: "nao_encontrado", empresaId };
  return { status: "erro", codigo: (r as Extract<ResultadoConsulta, { tipo: "erro" }>).codigo };
}
