import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { countOrphans, idSet, parseArgs, planFor, prepareRows, toDate, type ColumnMeta, type Row } from "./importManus";

function cols(table: Parameters<typeof getTableColumns>[0]): ColumnMeta[] {
  const c = getTableColumns(table) as Record<string, { name: string; dataType: string; notNull: boolean; hasDefault: boolean }>;
  return Object.entries(c).map(([key, m]) => ({ key, dbName: m.name, isDate: m.dataType === "date", notNull: m.notNull, hasDefault: m.hasDefault }));
}

const ISO = "2026-03-27T12:00:00.000Z";
const leadRow = (id: number, extra: Row = {}): Row => ({
  id, nome: "Lead", email: "l@x.test", telefone: "(11) 90000-0000", cnpj: null, devedorPrincipal: null, valorDivida: null,
  mensagem: null, lgpdConsent: 1, status: "novo_lead", pipedrivePersonId: null, pipedriveDealId: null, telefoneSocios: null,
  calendarEventId: "evt-antigo", importBatchId: 1, createdAt: ISO, updatedAt: ISO, ...extra,
});
const historyRow = (id: number, leadId: number, userId: number | null): Row => ({
  id, leadId, fromStatus: null, toStatus: "novo_lead", userId, userName: userId ? "Fulana" : "Sistema", createdAt: ISO,
});

describe("planFor", () => {
  it("leads: ordem e guarda (5 tabelas, inclui lead_notes), sem users/local_users/lead_notes na insercao", () => {
    const p = planFor("leads");
    expect(p.order).toEqual(["lead_imports", "leads", "lead_status_history", "site_settings"]);
    expect(p.mustBeEmpty).toEqual(["lead_imports", "leads", "lead_notes", "lead_status_history", "site_settings"]);
    expect(p.referenceCounts).toEqual({ lead_imports: 1, leads: 888, lead_status_history: 896, site_settings: 1 });
    expect(p.order).not.toContain("lead_notes");
    expect(p.order).not.toContain("users");
    expect(p.order).not.toContain("local_users");
  });

  it("full: 7 tabelas, referencias originais", () => {
    const p = planFor("full");
    expect(p.order).toHaveLength(7);
    expect(p.mustBeEmpty).toHaveLength(7);
    expect(p.referenceCounts.leads).toBe(888);
    expect(p.referenceCounts.local_users).toBe(5);
  });
});

describe("prepareRows — modo leads", () => {
  it("leads: calendarEventId vira NULL; datas viram Date; demais colunas preservadas", () => {
    const r = prepareRows(planFor("leads"), "leads", [leadRow(7)], cols(schema.leads));
    expect(r.readCount).toBe(1);
    expect(r.selectedCount).toBe(1);
    expect(r.rows[0].calendarEventId).toBeNull();
    expect(r.rows[0].importBatchId).toBe(1);
    expect(r.rows[0].createdAt).toBeInstanceOf(Date);
    expect((r.rows[0].createdAt as Date).toISOString()).toBe(ISO);
  });

  it("lead_status_history: userId vira NULL e userName e preservado", () => {
    const r = prepareRows(planFor("leads"), "lead_status_history", [historyRow(1, 7, 42), historyRow(2, 7, null)], cols(schema.leadStatusHistory));
    expect(r.rows[0]).toMatchObject({ userId: null, userName: "Fulana", leadId: 7 });
    expect(r.rows[1]).toMatchObject({ userId: null, userName: "Sistema" });
  });

  it("site_settings: so a linha videoUrl e selecionada, com valor intacto", () => {
    const rows: Row[] = [
      { id: 1, settingKey: "googleCalendarRefreshToken", settingValue: "token", updatedAt: ISO },
      { id: 2, settingKey: "googleCalendarEmail", settingValue: "a@b.test", updatedAt: ISO },
      { id: 3, settingKey: "videoUrl", settingValue: "https://v.test/x", updatedAt: ISO },
    ];
    const r = prepareRows(planFor("leads"), "site_settings", rows, cols(schema.siteSettings));
    expect(r.readCount).toBe(3);
    expect(r.selectedCount).toBe(1);
    expect(r.rows[0]).toMatchObject({ id: 3, settingKey: "videoUrl", settingValue: "https://v.test/x" });
  });
});

describe("prepareRows — modo full (comportamento validado antes)", () => {
  it("local_users: passwordHash/activationToken/activationTokenExpiry viram NULL", () => {
    const row: Row = { id: 1, nome: "N", email: "n@x.test", passwordHash: "h", role: "admin", active: 1, mustChangePassword: 0,
      activationToken: "t", activationTokenExpiry: ISO, createdBy: null, createdAt: ISO, updatedAt: ISO, lastSignedIn: null };
    const r = prepareRows(planFor("full"), "local_users", [row], cols(schema.localUsers));
    expect(r.rows[0]).toMatchObject({ passwordHash: null, activationToken: null, activationTokenExpiry: null, role: "admin", active: 1 });
  });

  it("site_settings: tokens do Calendar viram NULL, videoUrl fica; leads mantem calendarEventId", () => {
    const rows: Row[] = [
      { id: 1, settingKey: "googleCalendarRefreshToken", settingValue: "token", updatedAt: ISO },
      { id: 3, settingKey: "videoUrl", settingValue: "https://v.test/x", updatedAt: ISO },
    ];
    const r = prepareRows(planFor("full"), "site_settings", rows, cols(schema.siteSettings));
    expect(r.rows[0].settingValue).toBeNull();
    expect(r.rows[1].settingValue).toBe("https://v.test/x");
    const l = prepareRows(planFor("full"), "leads", [leadRow(7)], cols(schema.leads));
    expect(l.rows[0].calendarEventId).toBe("evt-antigo");
  });
});

describe("validacoes", () => {
  it("coluna fora do schema aborta", () => {
    expect(() => prepareRows(planFor("leads"), "leads", [leadRow(1, { colunaEstranha: 1 })], cols(schema.leads))).toThrow(/colunas fora do schema: colunaEstranha/);
  });

  it("data fora do formato ISO-UTC aborta; null passa", () => {
    expect(() => toDate("2026-03-27 12:00:00", "x")).toThrow(/formato/);
    expect(() => toDate("2026-03-27T12:00:00.000-03:00", "x")).toThrow(/formato/);
    expect(toDate(null, "x")).toBeNull();
    expect(toDate(ISO, "x")?.toISOString()).toBe(ISO);
  });

  it("countOrphans/idSet: orfaos contra o pai", () => {
    const parents = idSet([{ id: 1 }, { id: 2 }]);
    expect(countOrphans([historyRow(1, 1, null), historyRow(2, 9, null), { id: 3, leadId: null }], "leadId", parents)).toEqual({ total: 2, orphans: 1 });
  });

  it("parseArgs: --mode obrigatorio e exatamente um de --dry-run/--apply", () => {
    expect(parseArgs(["--file", "x.json", "--mode", "leads", "--dry-run"])).toEqual({ file: "x.json", run: "dry-run", mode: "leads", force: false });
    expect(parseArgs(["--file", "x.json", "--mode", "full", "--apply", "--force"]).force).toBe(true);
    expect(() => parseArgs(["--file", "x.json", "--dry-run"])).toThrow(/--mode/);
    expect(() => parseArgs(["--file", "x.json", "--mode", "tudo", "--dry-run"])).toThrow(/--mode/);
    expect(() => parseArgs(["--file", "x.json", "--mode", "leads"])).toThrow(/dry-run ou --apply/);
    expect(() => parseArgs(["--file", "x.json", "--mode", "leads", "--dry-run", "--apply"])).toThrow(/dry-run ou --apply/);
  });
});
