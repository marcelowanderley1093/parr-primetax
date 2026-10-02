import { eq, desc, asc, inArray, sql, getTableColumns, and, isNull, isNotNull, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, leads, leadNotes, leadStatusHistory, siteSettings, leadImports, localUsers, leadContatos, empresas, leadProcedimentos, editais } from "../drizzle/schema";
import type { InsertLead, InsertLeadNote, InsertLeadStatusHistory, InsertLeadImport, InsertLocalUser, InsertLeadContato, InsertEmpresa } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ==================== LEADS ====================

export async function createLead(data: InsertLead) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(leads).values(data);
  const insertId = result[0].insertId;
  // Also create initial status history
  await db.insert(leadStatusHistory).values({
    leadId: insertId,
    fromStatus: null,
    toStatus: "novo_lead",
    userName: "Sistema",
  });
  return insertId;
}

// ==================== KANBAN PAGINADO (base de editais: ~340 mil leads) ====================

export const STATUS_LEAD = ["novo_lead", "contato_inicial", "reuniao_agendada", "proposta_enviada"] as const;
export type StatusLead = (typeof STATUS_LEAD)[number];

/** Escapa % e _ para LIKE. */
const escLike = (s: string) => s.replace(/[\\%_]/g, c => "\\" + c);

/**
 * Condicao de busca do Kanban. Numeros (6+ digitos, sem letras): prefixo do CNPJ ou numero exato do procedimento.
 * Texto: trecho do nome do socio intimado, da empresa (devedor principal) ou do e-mail.
 */
export function condicaoBusca(busca: string | undefined): SQL | undefined {
  const t = (busca ?? "").trim();
  if (!t) return undefined;
  const d = t.replace(/\D/g, "");
  if (!/[A-Za-zÀ-ÿ]/.test(t) && d.length >= 6) {
    return sql`(REPLACE(REPLACE(REPLACE(${leads.cnpj}, '.', ''), '/', ''), '-', '') LIKE ${`${d}%`}
      OR EXISTS (SELECT 1 FROM lead_procedimentos p WHERE p.leadId = ${leads.id} AND p.numeroProcedimento = ${d}))`;
  }
  const like = `%${escLike(t)}%`;
  return sql`(${leads.nome} LIKE ${like} OR ${leads.devedorPrincipal} LIKE ${like} OR ${leads.email} LIKE ${like})`;
}

const colunasCard = {
  id: leads.id,
  nome: leads.nome,
  email: leads.email,
  telefone: leads.telefone,
  cnpj: leads.cnpj,
  devedorPrincipal: leads.devedorPrincipal,
  valorDivida: leads.valorDivida,
  status: leads.status,
  createdAt: leads.createdAt,
  ultimaPublicacao: leads.ultimaPublicacao,
  empresaSituacao: empresas.situacaoCadastral,
  empresaDividaCentavos: empresas.totalDividasCentavos,
};

/** Visao do Kanban: de quem sao os leads e se mostra os ativos ou os arquivados. */
export type VisaoKanban = { responsavelId?: number; livres?: boolean; arquivados?: boolean };

function condicaoVisao(v: VisaoKanban = {}): SQL | undefined {
  return and(
    v.arquivados ? isNotNull(leads.arquivadoEm) : isNull(leads.arquivadoEm),
    v.responsavelId !== undefined ? eq(leads.responsavelId, v.responsavelId) : undefined,
    v.livres ? isNull(leads.responsavelId) : undefined,
  );
}

/** Uma pagina de uma coluna do Kanban (arquivados ficam de fora). */
export async function listarColuna(status: StatusLead, busca: string | undefined, offset: number, limite: number, visao?: VisaoKanban) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const where = and(eq(leads.status, status), condicaoVisao(visao), condicaoBusca(busca));
  // Novo Lead: edital mais recente primeiro (prazo de impugnacao correndo). Demais: ultima movimentacao primeiro.
  const ordem = status === "novo_lead" ? [desc(leads.ultimaPublicacao), desc(leads.id)] : [desc(leads.updatedAt), desc(leads.id)];
  const [itens, total] = await Promise.all([
    db.select(colunasCard).from(leads).leftJoin(empresas, eq(empresas.id, leads.empresaId)).where(where).orderBy(...ordem).limit(limite).offset(offset),
    db.select({ n: sql<number>`COUNT(*)` }).from(leads).where(where),
  ]);
  return { itens, total: Number(total[0]?.n ?? 0) };
}

/** Total por coluna (para o cabecalho do Kanban). */
export async function contarPorStatus(busca: string | undefined, visao?: VisaoKanban): Promise<Record<StatusLead, number>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({ status: leads.status, n: sql<number>`COUNT(*)` })
    .from(leads)
    .where(and(condicaoVisao(visao), condicaoBusca(busca)))
    .groupBy(leads.status);
  const out = Object.fromEntries(STATUS_LEAD.map(s => [s, 0])) as Record<StatusLead, number>;
  for (const r of rows) out[r.status as StatusLead] = Number(r.n);
  return out;
}

/** Dono do lead (para o controle de acesso). */
export async function getResponsavelDoLead(leadId: number): Promise<{ responsavelId: number | null } | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({ responsavelId: leads.responsavelId }).from(leads).where(eq(leads.id, leadId)).limit(1);
  return rows[0];
}

/** Ids de eventos do Google Calendar dos leads de um responsavel (agenda do parceiro). */
export async function getCalendarEventIdsDoResponsavel(responsavelId: number): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db
    .select({ id: leads.calendarEventId })
    .from(leads)
    .where(and(eq(leads.responsavelId, responsavelId), sql`${leads.calendarEventId} IS NOT NULL AND ${leads.calendarEventId} <> ''`));
  return new Set(rows.map(r => r.id).filter((x): x is string => !!x));
}

/** Procedimentos do lead com o edital de cada um, do mais recente para o mais antigo. */
export async function getProcedimentosDoLead(leadId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: leadProcedimentos.id,
      numeroProcedimento: leadProcedimentos.numeroProcedimento,
      cpfParcial: leadProcedimentos.cpfParcial,
      pagina: leadProcedimentos.pagina,
      editalAno: editais.ano,
      editalNumero: editais.numero,
      dataPublicacao: editais.dataPublicacao,
    })
    .from(leadProcedimentos)
    .innerJoin(editais, eq(editais.id, leadProcedimentos.editalId))
    .where(eq(leadProcedimentos.leadId, leadId))
    .orderBy(desc(editais.dataPublicacao), desc(leadProcedimentos.id));
}

export async function getLeadById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateLeadStatus(id: number, status: string, userId?: number, userName?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const lead = await getLeadById(id);
  if (!lead) throw new Error("Lead not found");
  const oldStatus = lead.status;
  await db.update(leads).set({ status: status as any }).where(eq(leads.id, id));
  await db.insert(leadStatusHistory).values({
    leadId: id,
    fromStatus: oldStatus,
    toStatus: status,
    userId,
    userName,
  });
  return { oldStatus, newStatus: status };
}

export async function updateLeadPipedrive(id: number, personId: string, dealId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(leads).set({ pipedrivePersonId: personId, pipedriveDealId: dealId }).where(eq(leads.id, id));
}

export async function updateLeadCalendarEvent(id: number, eventId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(leads).set({ calendarEventId: eventId }).where(eq(leads.id, id));
}

export async function updateLead(id: number, data: Partial<Pick<InsertLead, 'nome' | 'email' | 'telefone' | 'cnpj' | 'devedorPrincipal' | 'valorDivida' | 'cpf'>>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(leads).set(data as any).where(eq(leads.id, id));
  return { success: true };
}

export async function deleteLead(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(leadNotes).where(eq(leadNotes.leadId, id));
  await db.delete(leadStatusHistory).where(eq(leadStatusHistory.leadId, id));
  await db.delete(leadContatos).where(eq(leadContatos.leadId, id));
  await db.delete(leadProcedimentos).where(eq(leadProcedimentos.leadId, id));
  await db.delete(leads).where(eq(leads.id, id));
}

// ==================== LEAD NOTES ====================

export async function getLeadNotes(leadId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(leadNotes).where(eq(leadNotes.leadId, leadId)).orderBy(desc(leadNotes.createdAt));
}

export async function createLeadNote(data: InsertLeadNote) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(leadNotes).values(data);
  return result[0].insertId;
}

// ==================== LEAD CONTATOS ====================

export async function getLeadContatos(leadId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(leadContatos).where(eq(leadContatos.leadId, leadId)).orderBy(asc(leadContatos.id));
}

export async function getLeadContatoById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(leadContatos).where(eq(leadContatos.id, id)).limit(1);
  return result[0];
}

export async function createLeadContato(data: InsertLeadContato) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(leadContatos).values(data);
  return result[0].insertId;
}

export async function updateLeadContato(
  id: number,
  data: Partial<Pick<InsertLeadContato, "status" | "observacao" | "valor" | "pessoaNome" | "pessoaCpf" | "atualizadoPorUserId" | "atualizadoPorNome">>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(leadContatos).set(data).where(eq(leadContatos.id, id));
  return { success: true };
}

export async function deleteLeadContato(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(leadContatos).where(eq(leadContatos.id, id));
  return { success: true };
}

// ==================== EMPRESAS (EmpresAqui) ====================

export async function getCnpjsEmpresas(): Promise<Set<string>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({ cnpj: empresas.cnpj }).from(empresas);
  return new Set(rows.map(r => r.cnpj));
}

/** CNPJs dos leads AINDA SEM empresa vinculada (para a previa contar so o que a importacao vai ligar). */
export async function getCnpjsLeads(): Promise<{ cnpj: string | null }[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select({ cnpj: leads.cnpj }).from(leads).where(sql`${leads.cnpj} IS NOT NULL AND ${leads.cnpj} <> '' AND ${leads.empresaId} IS NULL`);
}

// Liga lead -> empresa pelo CNPJ (so digitos, completado a 14 com zeros, mesma regra de chaveCnpjLead).
// `updatedAt = updatedAt` impede o ON UPDATE CURRENT_TIMESTAMP: vincular nao e "editar o lead".
const SQL_VINCULAR = sql`
  UPDATE leads l
  JOIN empresas e ON e.cnpj = LPAD(REGEXP_REPLACE(l.cnpj, '[^0-9]', ''), 14, '0')
  SET l.empresaId = e.id, l.updatedAt = l.updatedAt
  WHERE l.cnpj IS NOT NULL AND (l.empresaId IS NULL OR l.empresaId <> e.id)`;

function linhasAfetadas(result: unknown): number {
  return Number((result as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}

/** Vincula leads a empresas ja gravadas. Com batchId, so os leads daquele lote de importacao. */
export async function vincularLeadsAEmpresas(batchId?: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const query = batchId === undefined ? SQL_VINCULAR : sql`${SQL_VINCULAR} AND l.importBatchId = ${batchId}`;
  return linhasAfetadas(await db.execute(query));
}

/**
 * Grava (insere ou atualiza) empresas vindas do CSV, em uma transacao, e vincula os leads.
 * No update, `dados` recebe so a chave "csv" (JSON_SET), preservando o que a API gravou em "api".
 */
export async function gravarEmpresasCsv(linhas: InsertEmpresa[], tamanhoLote = 200): Promise<{ gravadas: number; leadsVinculados: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const v = (coluna: string) => sql.raw(`VALUES(\`${coluna}\`)`);
  return db.transaction(async tx => {
    let gravadas = 0;
    for (let i = 0; i < linhas.length; i += tamanhoLote) {
      const lote = linhas.slice(i, i + tamanhoLote);
      await tx.insert(empresas).values(lote).onDuplicateKeyUpdate({
        set: {
          razaoSocial: v("razaoSocial"),
          nomeFantasia: v("nomeFantasia"),
          situacaoCadastral: v("situacaoCadastral"),
          regimeTributario: v("regimeTributario"),
          cnaePrincipal: v("cnaePrincipal"),
          uf: v("uf"),
          municipio: v("municipio"),
          totalDividasCentavos: v("totalDividasCentavos"),
          qtdInscricoes: v("qtdInscricoes"),
          brutoCsv: v("brutoCsv"),
          csvAtualizadoEm: v("csvAtualizadoEm"),
          dados: sql.raw("JSON_SET(COALESCE(`dados`, JSON_OBJECT()), '$.csv', JSON_EXTRACT(VALUES(`dados`), '$.csv'))"),
        },
      });
      gravadas += lote.length;
    }
    const leadsVinculados = linhasAfetadas(await tx.execute(SQL_VINCULAR));
    return { gravadas, leadsVinculados };
  });
}

/** Empresa ligada ao lead, sem os originais pesados (brutoCsv/brutoApi). */
export async function getEmpresaDoLead(leadId: number) {
  const db = await getDb();
  if (!db) return null;
  const { brutoCsv: _csv, brutoApi: _api, ...colunas } = getTableColumns(empresas);
  const rows = await db
    .select(colunas)
    .from(empresas)
    .innerJoin(leads, eq(leads.empresaId, empresas.id))
    .where(eq(leads.id, leadId))
    .limit(1);
  return rows[0] ?? null;
}

// ==================== STATUS HISTORY ====================

export async function getLeadStatusHistory(leadId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(leadStatusHistory).where(eq(leadStatusHistory.leadId, leadId)).orderBy(desc(leadStatusHistory.createdAt));
}

// ==================== SETTINGS ====================

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(siteSettings).where(eq(siteSettings.settingKey, key)).limit(1);
  return result.length > 0 ? result[0].settingValue : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(siteSettings).values({ settingKey: key, settingValue: value })
    .onDuplicateKeyUpdate({ set: { settingValue: value } });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db.select().from(siteSettings);
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.settingValue) result[row.settingKey] = row.settingValue;
  }
  return result;
}

// ==================== BULK IMPORT ====================

/** Grava os leads da planilha em UMA transacao: ou entram todos, ou nenhum (falha no meio nao deixa lixo). */
export async function bulkCreateLeads(data: InsertLead[], batchId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    let count = 0;
    for (const lead of data) {
      const result = await tx.insert(leads).values({ ...lead, importBatchId: batchId });
      const insertId = result[0].insertId;
      await tx.insert(leadStatusHistory).values({
        leadId: insertId,
        fromStatus: null,
        toStatus: lead.status || "novo_lead",
        userName: "Importação Excel",
      });
      count++;
    }
    return count;
  });
}

// ==================== LEAD IMPORTS ====================

export async function createImportBatch(data: InsertLeadImport): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(leadImports).values(data);
  return result[0].insertId;
}

export async function getAllImportBatches() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(leadImports).orderBy(desc(leadImports.createdAt));
}

export async function deleteImportBatch(batchId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Get leads in this batch
  const batchLeads = await db.select({ id: leads.id }).from(leads).where(eq(leads.importBatchId, batchId));
  const leadIds = batchLeads.map(l => l.id);
  let deletedCount = 0;
  if (leadIds.length > 0) {
    // Delete related notes and history
    for (const lid of leadIds) {
      await db.delete(leadNotes).where(eq(leadNotes.leadId, lid));
      await db.delete(leadStatusHistory).where(eq(leadStatusHistory.leadId, lid));
      await db.delete(leadContatos).where(eq(leadContatos.leadId, lid));
      await db.delete(leadProcedimentos).where(eq(leadProcedimentos.leadId, lid));
    }
    // Delete leads
    await db.delete(leads).where(eq(leads.importBatchId, batchId));
    deletedCount = leadIds.length;
  }
  // Delete the batch record
  await db.delete(leadImports).where(eq(leadImports.id, batchId));
  return deletedCount;
}

export async function updateImportBatchCount(batchId: number, count: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(leadImports).set({ leadsCount: count }).where(eq(leadImports.id, batchId));
}

// ==================== LOCAL USERS ====================

export async function createLocalUser(data: InsertLocalUser) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(localUsers).values(data);
  return result[0].insertId;
}

// Compara LOWER(TRIM()) no banco: registros legados podem ter maiusculas/espacos.
export async function getLocalUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const normalized = email.trim().toLowerCase();
  const result = await db
    .select()
    .from(localUsers)
    .where(sql`LOWER(TRIM(${localUsers.email})) = ${normalized}`)
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getLocalUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(localUsers).where(eq(localUsers.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllLocalUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: localUsers.id,
    nome: localUsers.nome,
    email: localUsers.email,
    role: localUsers.role,
    active: localUsers.active,
    mustChangePassword: localUsers.mustChangePassword,
    // Derivada no banco: o hash nunca sai do select. MySQL devolve 0/1; o router normaliza.
    activationPending: sql<number>`(${localUsers.passwordHash} IS NULL)`,
    createdAt: localUsers.createdAt,
    lastSignedIn: localUsers.lastSignedIn,
  }).from(localUsers).orderBy(desc(localUsers.createdAt));
}

/**
 * Grava a nova senha. mustChangePassword: 0 quando o proprio usuario trocou (changePassword),
 * 1 quando um admin redefiniu (resetPassword) — a senha definida por terceiro e temporaria.
 */
export async function updateLocalUserPassword(
  id: number,
  passwordHash: string,
  options: { mustChangePassword: 0 | 1 } = { mustChangePassword: 0 }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(localUsers)
    .set({ passwordHash, mustChangePassword: options.mustChangePassword })
    .where(eq(localUsers.id, id));
}

export async function setActivationToken(id: number, token: string, expiry: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(localUsers).set({ activationToken: token, activationTokenExpiry: expiry }).where(eq(localUsers.id, id));
}

export async function getLocalUserByActivationToken(token: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(localUsers).where(eq(localUsers.activationToken, token)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function activateLocalUser(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(localUsers)
    .set({ passwordHash, active: 1, mustChangePassword: 0, activationToken: null, activationTokenExpiry: null })
    .where(eq(localUsers.id, id));
}

export async function updateLocalUserAdmin(
  id: number,
  data: { nome: string; passwordHash: string; role: "admin"; active: number; mustChangePassword: number }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(localUsers).set(data).where(eq(localUsers.id, id));
}

export async function updateLocalUserLastSignedIn(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(localUsers).set({ lastSignedIn: new Date() }).where(eq(localUsers.id, id));
}

export async function deleteLocalUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(localUsers).where(eq(localUsers.id, id));
}

export async function toggleLocalUserActive(id: number, active: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(localUsers).set({ active: active ? 1 : 0 }).where(eq(localUsers.id, id));
}
