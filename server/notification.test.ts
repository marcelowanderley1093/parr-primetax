import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

const { notifyOwner, isNotificationConfigured, resetTransporterForTests } = await import("./_core/notification");

const SMTP_VARS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "NOTIFY_EMAIL_TO"] as const;

function setSmtpEnv(to = "dono@primetax.com.br") {
  process.env.SMTP_HOST = "smtp.exemplo.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "usuario";
  process.env.SMTP_PASS = "senha";
  process.env.SMTP_FROM = "PARR <parr@primetax.com.br>";
  process.env.NOTIFY_EMAIL_TO = to;
}

const LEAD_EMAIL = "lead.secreto@cliente.com.br";
const payload = { title: "Novo Lead PARR: Fulano", content: `Nome: Fulano\nEmail: ${LEAD_EMAIL}\nTelefone: 11999999999` };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  for (const k of SMTP_VARS) delete process.env[k];
  sendMail.mockReset();
  createTransport.mockClear();
  resetTransporterForTests();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("notifyOwner (SMTP)", () => {
  it("sem SMTP configurado: devolve false, nao lanca, nao tenta enviar", async () => {
    expect(isNotificationConfigured()).toBe(false);
    await expect(notifyOwner(payload)).resolves.toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("com SMTP configurado: envia com from/to/subject/text/html e devolve true", async () => {
    setSmtpEnv();
    sendMail.mockResolvedValue({ messageId: "abc" });
    await expect(notifyOwner(payload)).resolves.toBe(true);
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.exemplo.com",
      port: 587,
      secure: false,
      auth: { user: "usuario", pass: "senha" },
    });
    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({
      from: "PARR <parr@primetax.com.br>",
      to: ["dono@primetax.com.br"],
      subject: "Novo Lead PARR: Fulano",
      text: payload.content,
    });
    expect(mail.html).toContain("Fulano<br>");
  });

  it("NOTIFY_EMAIL_TO aceita lista separada por virgula", async () => {
    setSmtpEnv("a@primetax.com.br, b@primetax.com.br ,,c@primetax.com.br");
    sendMail.mockResolvedValue({});
    await notifyOwner(payload);
    expect(sendMail.mock.calls[0][0].to).toEqual(["a@primetax.com.br", "b@primetax.com.br", "c@primetax.com.br"]);
  });

  it("porta 465 usa secure=true", async () => {
    setSmtpEnv();
    process.env.SMTP_PORT = "465";
    sendMail.mockResolvedValue({});
    await notifyOwner(payload);
    expect(createTransport.mock.calls[0][0]).toMatchObject({ port: 465, secure: true });
  });

  it("falha de envio: devolve false, nao lanca, e o log nao contem dados do lead", async () => {
    setSmtpEnv();
    sendMail.mockRejectedValue(Object.assign(new Error(`Mailbox unavailable for ${LEAD_EMAIL}`), { code: "EENVELOPE" }));
    await expect(notifyOwner(payload)).resolves.toBe(false);
    const logged = warnSpy.mock.calls.map(c => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("[Notification]");
    expect(logged).not.toContain(LEAD_EMAIL);
    expect(logged).not.toContain("Fulano");
  });

  it("payload vazio: devolve false sem enviar", async () => {
    setSmtpEnv();
    await expect(notifyOwner({ title: "  ", content: "x" })).resolves.toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
