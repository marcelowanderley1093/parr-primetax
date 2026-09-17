import { ENV } from "./env";
import { getTransporter, isSmtpConfigured } from "./notification";

export const ACTIVATION_EMAIL_SUBJECT = "Ative sua conta - PrimeTax PARR";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Template portado da producao (gradiente #0D9488 -> #4FBDB5, botao, validade 7 dias, rodape). */
export function buildActivationEmailHtml(params: { nome: string; activationLink: string }): string {
  const nome = escapeHtml(params.nome);
  const link = escapeHtml(params.activationLink);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:linear-gradient(135deg,#0D9488 0%,#4FBDB5 100%);background-color:#0D9488;padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">PrimeTax PARR</h1>
            <p style="margin:8px 0 0;color:#e6fffa;font-size:14px;">Painel de Gestão de Leads</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 16px;font-size:18px;color:#0f172a;">Olá, <strong>${nome}</strong>!</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
              Você foi convidado para acessar o painel PARR da PrimeTax. Para ativar sua conta e definir sua senha, clique no botão abaixo:
            </p>
            <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 24px;">
              <tr><td style="border-radius:8px;background:#0D9488;">
                <a href="${link}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:8px;">Ativar Minha Conta</a>
              </td></tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748b;">
              Se o botão não funcionar, copie e cole este link no navegador:<br>
              <a href="${link}" style="color:#0D9488;word-break:break-all;">${link}</a>
            </p>
            <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">Este link é válido por <strong>7 dias</strong>. Após esse período, solicite um novo convite ao administrador.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">PrimeTax Solutions - Inteligência Tributária &amp; Defesa Patrimonial</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Envia o e-mail de ativacao. Nunca lanca: true em sucesso, false em falha.
 * Logs de falha nao incluem link, token, destinatario nem credencial.
 */
export async function sendActivationEmail(params: {
  to: string;
  nome: string;
  activationLink: string;
}): Promise<boolean> {
  if (!isSmtpConfigured()) {
    console.warn("[ActivationEmail] SMTP nao configurado; convite nao enviado");
    return false;
  }
  try {
    await getTransporter().sendMail({
      from: ENV.smtp.from,
      to: params.to,
      subject: ACTIVATION_EMAIL_SUBJECT,
      text:
        `Olá, ${params.nome}!\n\n` +
        `Você foi convidado para acessar o painel PARR da PrimeTax. Para ativar sua conta e definir sua senha, acesse:\n` +
        `${params.activationLink}\n\n` +
        `Este link é válido por 7 dias.\n\n` +
        `PrimeTax Solutions - Inteligência Tributária & Defesa Patrimonial`,
      html: buildActivationEmailHtml({ nome: params.nome, activationLink: params.activationLink }),
    });
    return true;
  } catch (error) {
    // message/response do SMTP podem conter o endereco do destinatario: logar so code/command
    const err = error as { code?: string; command?: string };
    console.warn("[ActivationEmail] Falha ao enviar convite:", err?.code ?? "sem-codigo", err?.command ?? "");
    return false;
  }
}
