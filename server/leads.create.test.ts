import { beforeEach, describe, expect, it, vi } from "vitest";

// leads.create deve criar o lead mesmo quando a notificacao por e-mail falha ou nao esta configurada.
const created: any[] = [];
vi.mock("./db", () => ({
  createLead: vi.fn(async (data: any) => { created.push(data); return 123; }),
  updateLeadPipedrive: vi.fn(async () => undefined),
}));

const notifyOwner = vi.fn();
vi.mock("./_core/notification", () => ({
  notifyOwner: (...args: any[]) => notifyOwner(...args),
  isNotificationConfigured: () => true,
}));

const { appRouter } = await import("./routers");

const input = {
  nome: "Fulano de Tal",
  email: "fulano@cliente.com.br",
  telefone: "11999999999",
  cnpj: "12.345.678/0001-90",
  valorDivida: "R$ 150.000,00",
  mensagem: "Quero saber mais",
  lgpdConsent: 1,
};

function caller() {
  return appRouter.createCaller({ req: { ip: "1.1.1.1", headers: {} }, res: {}, user: null } as any);
}

beforeEach(() => {
  created.length = 0;
  notifyOwner.mockReset();
  delete process.env.PIPEDRIVE_API_TOKEN;
  delete process.env.PIPEDRIVE_DOMAIN;
});

describe("leads.create x notificacao", () => {
  it("cria o lead e envia e-mail com os dados do formulario em texto puro", async () => {
    notifyOwner.mockResolvedValue(true);
    const r = await caller().leads.create(input);
    expect(r).toEqual({ id: 123, success: true });
    expect(created).toHaveLength(1);
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    const payload = notifyOwner.mock.calls[0][0];
    expect(payload.title).toBe("Novo Lead PARR: Fulano de Tal");
    expect(payload.content).toContain("Email: fulano@cliente.com.br");
    expect(payload.content).toContain("Lead #123");
    expect(payload.content).not.toContain("**");
  });

  it("notificacao devolvendo false nao impede a criacao do lead", async () => {
    notifyOwner.mockResolvedValue(false);
    const r = await caller().leads.create(input);
    expect(r.success).toBe(true);
    expect(created).toHaveLength(1);
  });

  it("notificacao lancando erro nao impede a criacao do lead", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    notifyOwner.mockRejectedValue(new Error("SMTP caiu"));
    const r = await caller().leads.create(input);
    expect(r.success).toBe(true);
    expect(created).toHaveLength(1);
    errSpy.mockRestore();
  });
});

describe("system.testarEmail", () => {
  it("exige admin", async () => {
    const asUser = appRouter.createCaller({ req: {}, res: {}, user: { id: 1, role: "user", openId: "local-1", name: "U" } } as any);
    await expect(asUser.system.testarEmail()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin dispara o e-mail de teste", async () => {
    notifyOwner.mockResolvedValue(true);
    process.env.NOTIFY_EMAIL_TO = "dono@primetax.com.br";
    const asAdmin = appRouter.createCaller({ req: {}, res: {}, user: { id: 1, role: "admin", openId: "local-1", name: "Marcelo" } } as any);
    const r = await asAdmin.system.testarEmail();
    expect(r).toEqual({ success: true, configured: true, to: ["dono@primetax.com.br"] });
    expect(notifyOwner.mock.calls[0][0].title).toContain("teste de e-mail");
    delete process.env.NOTIFY_EMAIL_TO;
  });
});
