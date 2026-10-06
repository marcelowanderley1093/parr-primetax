// Carteiras de parceiros (Fase B2): filtros, distribuicao por grupo, devolucao, transferencia, arquivamento.
// Regras de negocio em shared/carteira.ts; aqui so o acesso ao banco.
//
// "Livre" = sem responsavel e nao arquivado. Grupo = leads que compartilham pessoa ou empresa (leads.grupoId);
// lead sem grupo (ex.: veio da landing sem CNPJ) e um grupo de um so (chave = -id).
// Grupo que ja tem dono nunca e redistribuido pelo filtro: os leads livres dele vao para o mesmo dono ("completar").
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { carteiras, empresas, leadContatos, leadEventos, leadNotes, leads, leadStatusHistory, localUsers, type InsertLeadEvento } from "../drizzle/schema";
import { getDb } from "./db";
import { planoRedistribuicao, usaEmpresa, type FiltroCarteira, type GrupoNaCarteira } from "@shared/carteira";

export type Ator = { localUserId: number | null; nome: string };

const LOTE = 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

async function banco() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

const chaveGrupo = sql`COALESCE(${leads.grupoId}, -${leads.id})`;
const livre = and(isNull(leads.responsavelId), isNull(leads.arquivadoEm));
/** Grupo sem nenhum lead com dono (lead sem grupo: sempre verdadeiro). */
const grupoSemDono = sql`(${leads.grupoId} IS NULL OR NOT EXISTS (
  SELECT 1 FROM leads x WHERE x.grupoId = ${leads.grupoId} AND x.responsavelId IS NOT NULL))`;

/**
 * Condicao SQL do filtro (sobre leads LEFT JOIN empresas).
 * "Somente prazo aberto" = publicacao mais recente nos ultimos 30 dias corridos (conservador: nao considera a
 * prorrogacao de fim de semana/feriado, entao pode deixar de fora um lead com 1 a 3 dias a mais de prazo).
 */
export function condicaoFiltro(f: FiltroCarteira, hoje: string): SQL | undefined {
  const partes: (SQL | undefined)[] = [];
  if (usaEmpresa(f)) {
    const emp: SQL[] = [sql`${leads.empresaId} IS NOT NULL`];
    if (f.situacoes?.length) emp.push(inArray(empresas.situacaoCadastral, f.situacoes));
    if (f.dividaMin != null) emp.push(sql`${empresas.totalDividasCentavos} >= ${Math.round(f.dividaMin * 100)}`);
    if (f.dividaMax != null) emp.push(sql`${empresas.totalDividasCentavos} <= ${Math.round(f.dividaMax * 100)}`);
    if (f.ufs?.length) emp.push(inArray(empresas.uf, f.ufs));
    if (f.cnaeDivisoes?.length) emp.push(inArray(sql`LEFT(${empresas.cnaePrincipal}, 2)`, f.cnaeDivisoes));
    const condEmpresa = and(...emp)!;
    partes.push(f.incluirSemEmpresa ? sql`(${condEmpresa} OR ${leads.empresaId} IS NULL)` : condEmpresa);
  }
  if (f.publicacaoDe) partes.push(sql`${leads.ultimaPublicacao} >= ${f.publicacaoDe}`);
  if (f.publicacaoAte) partes.push(sql`${leads.ultimaPublicacao} <= ${f.publicacaoAte}`);
  if (f.somentePrazoAberto) {
    const t = Date.parse(`${hoje}T00:00:00Z`) - 30 * DIA_MS;
    partes.push(sql`${leads.ultimaPublicacao} >= ${new Date(t).toISOString().slice(0, 10)}`);
  }
  return and(...partes);
}

const n = (r: unknown) => Number((r as [Array<Record<string, number | string>>])[0]?.[0]?.n ?? 0);

/** Previa: leads livres que atendem ao filtro, grupos, e o total que iria junto (grupos inteiros). */
export async function previaDistribuicao(f: FiltroCarteira, hoje: string) {
  const db = await banco();
  const where = and(livre, grupoSemDono, condicaoFiltro(f, hoje));
  const [contagem] = await db
    .select({ leads: sql<number>`COUNT(*)`, grupos: sql<number>`COUNT(DISTINCT ${chaveGrupo})` })
    .from(leads).leftJoin(empresas, eq(empresas.id, leads.empresaId)).where(where);
  const sub = db.selectDistinct({ g: sql`${chaveGrupo}`.as("g") }).from(leads).leftJoin(empresas, eq(empresas.id, leads.empresaId)).where(where);
  const total = await db.execute(sql`SELECT COUNT(*) AS n FROM leads g
    WHERE g.responsavelId IS NULL AND g.arquivadoEm IS NULL AND COALESCE(g.grupoId, -g.id) IN (SELECT t.g FROM ${sub} t)`);
  return { leadsQueAtendem: Number(contagem?.leads ?? 0), grupos: Number(contagem?.grupos ?? 0), leadsNosGrupos: n(total) };
}

async function registrarEventos(eventos: InsertLeadEvento[]) {
  const db = await banco();
  for (let i = 0; i < eventos.length; i += LOTE) await db.insert(leadEventos).values(eventos.slice(i, i + LOTE));
}

/** Atribui ate `maxGrupos` grupos livres (mais recentes primeiro) ao parceiro; os grupos vao inteiros. */
export async function atribuir(f: FiltroCarteira, hoje: string, responsavelId: number, maxGrupos: number, ator: Ator) {
  const gs = await gruposLivresQueAtendem(f, hoje, maxGrupos);
  return atribuirGrupos(gs, responsavelId, ator, "atribuido");
}

/** Chaves dos grupos livres que atendem ao filtro, editais mais recentes primeiro (mesma ordem da distribuicao). */
async function gruposLivresQueAtendem(f: FiltroCarteira, hoje: string, limite: number): Promise<number[]> {
  if (limite <= 0) return [];
  const db = await banco();
  const where = and(livre, grupoSemDono, condicaoFiltro(f, hoje));
  const grupos = await db
    .select({ g: sql<number>`${chaveGrupo}`.as("g") })
    .from(leads).leftJoin(empresas, eq(empresas.id, leads.empresaId)).where(where)
    .groupBy(sql`g`).orderBy(sql`MAX(${leads.ultimaPublicacao}) DESC`).limit(limite);
  return grupos.map(r => Number(r.g));
}

/** Quantos leads livres ha nesses grupos (o que iria junto ao atribuir). */
async function livresNosGrupos(chaves: number[]): Promise<number> {
  const db = await banco();
  let total = 0;
  for (let i = 0; i < chaves.length; i += LOTE) {
    const [r] = await db.select({ n: sql<number>`COUNT(*)` }).from(leads)
      .where(and(livre, inArray(chaveGrupo, chaves.slice(i, i + LOTE))));
    total += Number(r?.n ?? 0);
  }
  return total;
}

/** Atribui todos os leads livres dos grupos (chave >0 = grupoId; <0 = lead sem grupo) ao responsavel. */
async function atribuirGrupos(chaves: number[], responsavelId: number, ator: Ator, tipo: "atribuido" | "transferido") {
  const db = await banco();
  const grupoIds = chaves.filter(c => c > 0);
  const avulsos = chaves.filter(c => c < 0).map(c => -c);
  const ids: number[] = [];
  for (let i = 0; i < grupoIds.length; i += LOTE) {
    const rows = await db.select({ id: leads.id }).from(leads).where(and(livre, inArray(leads.grupoId, grupoIds.slice(i, i + LOTE))));
    ids.push(...rows.map(r => r.id));
  }
  for (let i = 0; i < avulsos.length; i += LOTE) {
    const rows = await db.select({ id: leads.id }).from(leads).where(and(livre, inArray(leads.id, avulsos.slice(i, i + LOTE))));
    ids.push(...rows.map(r => r.id));
  }
  const agora = new Date();
  await db.transaction(async tx => {
    for (let i = 0; i < ids.length; i += LOTE) {
      await tx.update(leads)
        .set({ responsavelId, atribuidoEm: agora, updatedAt: sql`\`updatedAt\`` })
        .where(and(inArray(leads.id, ids.slice(i, i + LOTE)), isNull(leads.responsavelId)));
    }
  });
  await registrarEventos(ids.map(leadId => ({ leadId, tipo, deResponsavelId: null, paraResponsavelId: responsavelId, usuarioId: ator.localUserId, usuarioNome: ator.nome })));
  return { grupos: chaves.length, leads: ids.length };
}

/** Leads livres em grupos que ja tem dono (ex.: chegaram num edital novo): quantos e de quem. */
async function livresEmGruposComDono() {
  const db = await banco();
  const r = await db.execute(sql`SELECT l.id AS id, MIN(x.responsavelId) AS dono, COUNT(DISTINCT x.responsavelId) AS donos
    FROM leads l JOIN leads x ON x.grupoId = l.grupoId AND x.responsavelId IS NOT NULL
    WHERE l.responsavelId IS NULL AND l.arquivadoEm IS NULL AND l.grupoId IS NOT NULL
    GROUP BY l.id`);
  return (r as unknown as [Array<{ id: number; dono: number; donos: number }>])[0].map(x => ({ id: Number(x.id), dono: Number(x.dono), donos: Number(x.donos) }));
}

export async function previaCompletar() {
  const rows = await livresEmGruposComDono();
  return { leads: rows.filter(r => r.donos === 1).length, conflitos: rows.filter(r => r.donos > 1).length };
}

/** Entrega os leads livres de grupos que ja tem dono ao mesmo dono (grupo com mais de um dono fica de fora). */
export async function completarGrupos(ator: Ator) {
  const db = await banco();
  const rows = (await livresEmGruposComDono()).filter(r => r.donos === 1);
  const porDono = new Map<number, number[]>();
  for (const r of rows) porDono.set(r.dono, [...(porDono.get(r.dono) ?? []), r.id]);
  const agora = new Date();
  await db.transaction(async tx => {
    for (const [dono, ids] of Array.from(porDono.entries())) {
      for (let i = 0; i < ids.length; i += LOTE) {
        await tx.update(leads).set({ responsavelId: dono, atribuidoEm: agora, updatedAt: sql`\`updatedAt\`` })
          .where(and(inArray(leads.id, ids.slice(i, i + LOTE)), isNull(leads.responsavelId)));
      }
    }
  });
  await registrarEventos(rows.map(r => ({ leadId: r.id, tipo: "atribuido" as const, paraResponsavelId: r.dono, motivo: "grupo ja atribuido", usuarioId: ator.localUserId, usuarioNome: ator.nome })));
  return { leads: rows.length };
}

async function leadsDoGrupo(leadId: number) {
  const db = await banco();
  const [l] = await db.select({ id: leads.id, grupoId: leads.grupoId }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!l) return [];
  const where = l.grupoId === null ? eq(leads.id, l.id) : eq(leads.grupoId, l.grupoId);
  return db.select({ id: leads.id, responsavelId: leads.responsavelId }).from(leads).where(where);
}

/** Devolve o grupo inteiro a fila livre (so os leads do mesmo dono do lead informado). */
export async function devolver(leadId: number, ator: Ator, motivo: string | null) {
  const db = await banco();
  const grupo = await leadsDoGrupo(leadId);
  const dono = grupo.find(g => g.id === leadId)?.responsavelId ?? null;
  if (dono === null) return { leads: 0 };
  const ids = grupo.filter(g => g.responsavelId === dono).map(g => g.id);
  await db.update(leads).set({ responsavelId: null, atribuidoEm: null, updatedAt: sql`\`updatedAt\`` }).where(inArray(leads.id, ids));
  await registrarEventos(ids.map(id => ({ leadId: id, tipo: "devolvido" as const, deResponsavelId: dono, motivo, usuarioId: ator.localUserId, usuarioNome: ator.nome })));
  return { leads: ids.length };
}

/** Transfere o grupo inteiro (inclusive arquivados) para outro parceiro, ou devolve a fila (para = null). */
export async function transferir(leadId: number, para: number | null, ator: Ator) {
  const db = await banco();
  const grupo = await leadsDoGrupo(leadId);
  const mudam = grupo.filter(g => g.responsavelId !== para);
  if (!mudam.length) return { leads: 0 };
  await db.update(leads)
    .set({ responsavelId: para, atribuidoEm: para === null ? null : new Date(), updatedAt: sql`\`updatedAt\`` })
    .where(inArray(leads.id, mudam.map(g => g.id)));
  await registrarEventos(mudam.map(g => ({
    leadId: g.id, tipo: para === null ? ("devolvido" as const) : ("transferido" as const),
    deResponsavelId: g.responsavelId, paraResponsavelId: para, usuarioId: ator.localUserId, usuarioNome: ator.nome,
  })));
  return { leads: mudam.length };
}

export async function arquivar(leadId: number, motivo: string, detalhe: string | null, ator: Ator) {
  const db = await banco();
  await db.update(leads).set({ arquivadoEm: new Date(), arquivadoMotivo: motivo, arquivadoPorId: ator.localUserId, updatedAt: sql`\`updatedAt\`` })
    .where(eq(leads.id, leadId));
  await registrarEventos([{ leadId, tipo: "arquivado", motivo: detalhe ? `${motivo}: ${detalhe}` : motivo, usuarioId: ator.localUserId, usuarioNome: ator.nome }]);
}

export async function reabrir(leadId: number, ator: Ator) {
  const db = await banco();
  await db.update(leads).set({ arquivadoEm: null, arquivadoMotivo: null, arquivadoPorId: null, updatedAt: sql`\`updatedAt\`` })
    .where(eq(leads.id, leadId));
  await registrarEventos([{ leadId, tipo: "reaberto", usuarioId: ator.localUserId, usuarioNome: ator.nome }]);
}

/** Situacao do lead na carteira + historico de eventos (para o LeadDetail). */
export async function carteiraDoLead(leadId: number) {
  const db = await getDb();
  if (!db) return null;
  const [l] = await db
    .select({
      responsavelId: leads.responsavelId, responsavelNome: localUsers.nome, atribuidoEm: leads.atribuidoEm,
      arquivadoEm: leads.arquivadoEm, arquivadoMotivo: leads.arquivadoMotivo, grupoId: leads.grupoId,
    })
    .from(leads).leftJoin(localUsers, eq(localUsers.id, leads.responsavelId)).where(eq(leads.id, leadId)).limit(1);
  if (!l) return null;
  const noGrupo = l.grupoId === null ? 1 : n(await db.execute(sql`SELECT COUNT(*) AS n FROM leads WHERE grupoId = ${l.grupoId}`));
  const eventos = await db.select().from(leadEventos).where(eq(leadEventos.leadId, leadId)).orderBy(sql`${leadEventos.createdAt} DESC, ${leadEventos.id} DESC`).limit(50);
  return { ...l, leadsNoGrupo: noGrupo, eventos };
}

/** Parceiros (usuarios comerciais ativos) com o tamanho da carteira de cada um. */
export async function parceiros() {
  const db = await banco();
  const us = await db.select({ id: localUsers.id, nome: localUsers.nome, email: localUsers.email, active: localUsers.active })
    .from(localUsers).where(eq(localUsers.role, "comercial"));
  const cont = await db.select({ r: leads.responsavelId, total: sql<number>`COUNT(*)` })
    .from(leads).where(and(sql`${leads.responsavelId} IS NOT NULL`, isNull(leads.arquivadoEm))).groupBy(leads.responsavelId);
  const porId = new Map(cont.map(c => [Number(c.r), Number(c.total)]));
  return us.map(u => ({ ...u, leads: porId.get(u.id) ?? 0 }));
}

export async function getFiltroSalvo(responsavelId: number): Promise<FiltroCarteira | null> {
  const db = await banco();
  const [c] = await db.select({ filtros: carteiras.filtros }).from(carteiras).where(eq(carteiras.responsavelId, responsavelId)).limit(1);
  return (c?.filtros as FiltroCarteira) ?? null;
}

export async function salvarFiltro(responsavelId: number, filtros: FiltroCarteira, ator: Ator) {
  const db = await banco();
  await db.insert(carteiras).values({ responsavelId, filtros, atualizadoPorId: ator.localUserId })
    .onDuplicateKeyUpdate({ set: { filtros, atualizadoPorId: ator.localUserId } });
}

// --- Redistribuicao conforme o filtro salvo (decisao 06/10/2026; regras em shared/carteira.ts, planoRedistribuicao) ---

export const MOTIVO_REDISTRIBUICAO = "redistribuicao (filtro alterado)";

/**
 * O lead tem alguma marca de trabalho (criterio estrito): saiu de "Novo lead" ou tem historico de coluna, nota,
 * reuniao marcada, contato criado/editado a mao (lead_contatos.atualizadoPorUserId) ou arquivamento.
 */
export const leadTrabalhado = sql`(${leads.status} <> 'novo_lead' OR ${leads.arquivadoEm} IS NOT NULL
  OR (${leads.calendarEventId} IS NOT NULL AND ${leads.calendarEventId} <> '')
  OR EXISTS (SELECT 1 FROM ${leadNotes} WHERE ${leadNotes.leadId} = ${leads.id})
  OR EXISTS (SELECT 1 FROM ${leadStatusHistory} WHERE ${leadStatusHistory.leadId} = ${leads.id})
  OR EXISTS (SELECT 1 FROM ${leadContatos} WHERE ${leadContatos.leadId} = ${leads.id} AND ${leadContatos.atualizadoPorUserId} IS NOT NULL))`;

/** Grupos da carteira do parceiro, com marca de trabalho e se atendem ao filtro. */
async function gruposDaCarteira(responsavelId: number, f: FiltroCarteira, hoje: string): Promise<GrupoNaCarteira[]> {
  const db = await banco();
  const cond = condicaoFiltro(f, hoje) ?? sql`1 = 1`;
  const rows = await db
    .select({
      g: sql<number>`${chaveGrupo}`.as("g"),
      leads: sql<number>`COUNT(*)`,
      ativos: sql<number>`SUM(CASE WHEN ${leads.arquivadoEm} IS NULL THEN 1 ELSE 0 END)`,
      trabalhado: sql<number>`MAX(CASE WHEN ${leadTrabalhado} THEN 1 ELSE 0 END)`,
      atende: sql<number>`MAX(CASE WHEN ${cond} THEN 1 ELSE 0 END)`,
    })
    .from(leads).leftJoin(empresas, eq(empresas.id, leads.empresaId))
    .where(eq(leads.responsavelId, responsavelId)).groupBy(sql`g`);
  return rows.map(r => ({
    g: Number(r.g), leads: Number(r.leads), ativos: Number(r.ativos),
    trabalhado: Number(r.trabalhado) === 1, atende: Number(r.atende) === 1,
  }));
}

/** Previa: quantos grupos/leads saem, quantos ficam e quantos entram (sem gravar nada). */
export async function previaRedistribuicao(responsavelId: number, f: FiltroCarteira, hoje: string) {
  const plano = planoRedistribuicao(await gruposDaCarteira(responsavelId, f, hoje), f.tamanhoGrupos);
  const entram = await gruposLivresQueAtendem(f, hoje, plano.vagas);
  return {
    saemGrupos: plano.saem.length,
    saemLeads: plano.saem.reduce((s, x) => s + x.leads, 0),
    ficamGrupos: plano.ficam,
    tamanho: f.tamanhoGrupos ?? null,
    entramGrupos: entram.length,
    entramLeads: await livresNosGrupos(entram),
  };
}

/** Executa: devolve os grupos parados que nao atendem (com trilha) e completa a carteira ate o tamanho salvo. */
export async function redistribuir(responsavelId: number, f: FiltroCarteira, hoje: string, ator: Ator) {
  const db = await banco();
  const plano = planoRedistribuicao(await gruposDaCarteira(responsavelId, f, hoje), f.tamanhoGrupos);
  const chaves = plano.saem.map(x => x.g);
  const ids: number[] = [];
  for (let i = 0; i < chaves.length; i += LOTE) {
    const rows = await db.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.responsavelId, responsavelId), inArray(chaveGrupo, chaves.slice(i, i + LOTE))));
    ids.push(...rows.map(r => r.id));
  }
  await db.transaction(async tx => {
    for (let i = 0; i < ids.length; i += LOTE) {
      // Guarda: so sai o que continua com este parceiro, em "Novo lead" e nao arquivado.
      await tx.update(leads)
        .set({ responsavelId: null, atribuidoEm: null, updatedAt: sql`\`updatedAt\`` })
        .where(and(inArray(leads.id, ids.slice(i, i + LOTE)), eq(leads.responsavelId, responsavelId),
          eq(leads.status, "novo_lead"), isNull(leads.arquivadoEm)));
    }
  });
  await registrarEventos(ids.map(leadId => ({
    leadId, tipo: "devolvido" as const, deResponsavelId: responsavelId, motivo: MOTIVO_REDISTRIBUICAO,
    usuarioId: ator.localUserId, usuarioNome: ator.nome,
  })));
  const entram = await gruposLivresQueAtendem(f, hoje, plano.vagas);
  const entrou = entram.length ? await atribuirGrupos(entram, responsavelId, ator, "atribuido") : { grupos: 0, leads: 0 };
  return { saiu: { grupos: chaves.length, leads: ids.length }, entrou };
}

/** Conta leads de um parceiro (ativos) — usado para impedir atribuir a quem nao e parceiro. */
export async function ehParceiroAtivo(localUserId: number): Promise<boolean> {
  const db = await banco();
  const [u] = await db.select({ role: localUsers.role, active: localUsers.active }).from(localUsers).where(eq(localUsers.id, localUserId)).limit(1);
  return !!u && u.role === "comercial" && u.active === 1;
}
