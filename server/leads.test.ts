import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
      get: () => "localhost:3000",
    } as any,
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-admin",
    email: "marcelo@primetax.com.br",
    name: "Marcelo",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
      get: () => "localhost:3000",
    } as any,
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("leads.create", () => {
  it("validates required fields", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.create({
        nome: "",
        email: "invalid",
        telefone: "",
        lgpdConsent: 0,
      })
    ).rejects.toThrow();
  });

  it("validates email format", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.create({
        nome: "Test User",
        email: "not-an-email",
        telefone: "11999999999",
        lgpdConsent: 1,
      })
    ).rejects.toThrow();
  });

  it("requires LGPD consent", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.create({
        nome: "Test User",
        email: "test@example.com",
        telefone: "11999999999",
        lgpdConsent: 0,
      })
    ).rejects.toThrow();
  });
});

describe("leads.list", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.leads.list()).rejects.toThrow();
  });
});

describe("leads.updateStatus", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.updateStatus({ id: 1, status: "contato_inicial" })
    ).rejects.toThrow();
  });

  it("validates status enum", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.updateStatus({ id: 1, status: "invalid_status" as any })
    ).rejects.toThrow();
  });
});

describe("leads.addNote", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.addNote({ leadId: 1, content: "Test note" })
    ).rejects.toThrow();
  });

  it("validates content is not empty", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.addNote({ leadId: 1, content: "" })
    ).rejects.toThrow();
  });
});

describe("leads.scheduleEvent", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.scheduleEvent({
        leadId: 1,
        title: "Test Meeting",
        startTime: "2026-04-01T10:00:00",
        endTime: "2026-04-01T11:00:00",
      })
    ).rejects.toThrow();
  });
});

describe("leads.importExcel", () => {
  it("requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.leads.importExcel({
        leads: [{ nome: "Test Lead" }],
      })
    ).rejects.toThrow();
  });
});

describe("settings", () => {
  it("get returns public settings", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.settings.get();
    expect(result).toHaveProperty("videoUrl");
    expect(result).toHaveProperty("googleCalendarConnected");
  });

  it("getAdmin requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.settings.getAdmin()).rejects.toThrow();
  });

  it("update requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.settings.update({ key: "videoUrl", value: "https://youtube.com/test" })
    ).rejects.toThrow();
  });
});

describe("googleCalendar", () => {
  it("getAuthUrl requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.googleCalendar.getAuthUrl()).rejects.toThrow();
  });

  it("disconnect requires authentication", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.googleCalendar.disconnect()).rejects.toThrow();
  });
});
