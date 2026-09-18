import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn(() => ({ sendMail })) } }));

const { sendActivationEmail, buildActivationEmailHtml, ACTIVATION_EMAIL_SUBJECT } = await import("./_core/activationEmail");
const { resetTransporterForTests } = await import("./_core/notification");

const SMTP_VARS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "NOTIFY_EMAIL_TO"] as const;
function setSmtpEnv() {
  process.env.SMTP_HOST = "smtp.exemplo.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "usuario";
  process.env.SMTP_PASS = "senha-smtp-de-teste";
  process.env.SMTP_FROM = "PARR <parr@primetax.com.br>";
}

const params = {
  to: "convidado.secreto@primetax.com.br",
  nome: "Convidado <Teste>",
  activationLink: "https://staging.exemplo.test/ativar-conta?token=deadbeef0123",
};

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const k of SMTP_VARS) delete process.env[k];
  sendMail.mockReset();
  resetTransporterForTests();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe("sendActivationEmail", () => {
  it("SMTP nao configurado -> false, sem lancar, sem tentar enviar (NOTIFY_EMAIL_TO nao e exigido)", async () => {
    await expect(sendActivationEmail(params)).resolves.toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("envia com remetente do SMTP_FROM, assunto fixo, link no texto e no HTML", async () => {
    setSmtpEnv();
    sendMail.mockResolvedValue({});
    await expect(sendActivationEmail(params)).resolves.toBe(true);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.from).toBe("PARR <parr@primetax.com.br>");
    expect(mail.to).toBe(params.to);
    expect(mail.subject).toBe("Ative sua conta - PrimeTax PARR");
    expect(ACTIVATION_EMAIL_SUBJECT).toBe(mail.subject);
    expect(mail.text).toContain(params.activationLink);
    expect(mail.html).toContain(`href="${params.activationLink}"`);
    expect(mail.html).toContain("Ativar Minha Conta");
    expect(mail.html).toContain("#0D9488");
    expect(mail.html).toContain("#4FBDB5");
    expect(mail.html).toContain("7 dias");
    expect(mail.html).toContain("PrimeTax Solutions - Inteligência Tributária &amp; Defesa Patrimonial");
    expect(mail.html).not.toContain("manus");
  });

  it("escapa HTML no nome", () => {
    const html = buildActivationEmailHtml({ nome: "<script>x</script>", activationLink: "https://a.test/x" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("falha de envio -> false, sem lancar; log sem link, token, destinatario ou credencial", async () => {
    setSmtpEnv();
    sendMail.mockRejectedValue(Object.assign(new Error(`Recipient address rejected: ${params.to}`), { code: "EENVELOPE", command: "RCPT TO" }));
    await expect(sendActivationEmail(params)).resolves.toBe(false);
    const logged = warnSpy.mock.calls.map(c => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("[ActivationEmail]");
    expect(logged).not.toContain(params.to);
    expect(logged).not.toContain("deadbeef0123");
    expect(logged).not.toContain("ativar-conta");
    expect(logged).not.toContain("senha-smtp-de-teste");
  });
});
