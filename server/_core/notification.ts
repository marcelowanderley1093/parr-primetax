import nodemailer, { type Transporter } from "nodemailer";
import { ENV } from "./env";

export type NotificationPayload = {
  title: string;
  content: string;
};

const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 20000;

let transporter: Transporter | null = null;
let transporterKey = "";

/** SMTP pronto para enviar (sem exigir NOTIFY_EMAIL_TO). */
export function isSmtpConfigured(): boolean {
  const { host, port, user, pass, from } = ENV.smtp;
  return Boolean(host && port && user && pass && from);
}

export function isNotificationConfigured(): boolean {
  return isSmtpConfigured() && ENV.notifyEmailTo.length > 0;
}

export function getTransporter(): Transporter {
  const { host, port, user, pass } = ENV.smtp;
  const key = `${host}|${port}|${user}`;
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    transporterKey = key;
  }
  return transporter;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const toHtml = (content: string): string =>
  `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${escapeHtml(content).replace(/\n/g, "<br>")}</div>`;

/**
 * Envia um e-mail de notificacao ao(s) endereco(s) de NOTIFY_EMAIL_TO via SMTP.
 * Nunca lanca: devolve `true` se o SMTP aceitou a mensagem, `false` em qualquer falha
 * (configuracao ausente, payload vazio, erro de envio). Logs nao incluem o conteudo.
 */
export async function notifyOwner(payload: NotificationPayload): Promise<boolean> {
  const title = (payload.title ?? "").trim().slice(0, TITLE_MAX_LENGTH);
  const content = (payload.content ?? "").trim().slice(0, CONTENT_MAX_LENGTH);
  if (!title || !content) {
    console.warn("[Notification] Titulo ou conteudo vazio; e-mail nao enviado");
    return false;
  }

  if (!isNotificationConfigured()) {
    console.warn("[Notification] SMTP/NOTIFY_EMAIL_TO nao configurados; e-mail nao enviado");
    return false;
  }

  try {
    await getTransporter().sendMail({
      from: ENV.smtp.from,
      to: ENV.notifyEmailTo,
      subject: title,
      text: content,
      html: toHtml(content),
    });
    return true;
  } catch (error) {
    const err = error as { code?: string; message?: string };
    console.warn("[Notification] Falha ao enviar e-mail:", err?.code ?? err?.message ?? "erro desconhecido");
    return false;
  }
}

/** Somente para testes. */
export function resetTransporterForTests(): void {
  transporter = null;
  transporterKey = "";
}
