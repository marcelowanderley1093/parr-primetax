import { eq, desc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, leads, leadNotes, leadStatusHistory, siteSettings, leadImports, localUsers } from "../drizzle/schema";
import type { InsertLead, InsertLeadNote, InsertLeadStatusHistory, InsertLeadImport, InsertLocalUser } from "../drizzle/schema";

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

export async function getAllLeads() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(leads).orderBy(desc(leads.createdAt));
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

export async function updateLead(id: number, data: Partial<Pick<InsertLead, 'nome' | 'email' | 'telefone' | 'cnpj' | 'devedorPrincipal' | 'valorDivida'>>) {
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

export async function bulkCreateLeads(data: InsertLead[], batchId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let count = 0;
  for (const lead of data) {
    const result = await db.insert(leads).values({ ...lead, importBatchId: batchId });
    const insertId = result[0].insertId;
    await db.insert(leadStatusHistory).values({
      leadId: insertId,
      fromStatus: null,
      toStatus: lead.status || "novo_lead",
      userName: "Importação Excel",
    });
    count++;
  }
  return count;
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

export async function getLocalUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(localUsers).where(eq(localUsers.email, email)).limit(1);
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
    createdAt: localUsers.createdAt,
    lastSignedIn: localUsers.lastSignedIn,
  }).from(localUsers).orderBy(desc(localUsers.createdAt));
}

export async function updateLocalUserPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(localUsers).set({ passwordHash, mustChangePassword: 0 }).where(eq(localUsers.id, id));
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
