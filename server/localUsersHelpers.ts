import { z } from "zod";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Aceita e-mail digitado com espacos/maiusculas: normaliza antes de validar o formato.
export const emailInput = z.string().transform(normalizeEmail).pipe(z.string().email());

export function parseLocalOpenId(openId: string): number | null {
  const match = /^local-(\d+)$/.exec(openId);
  return match ? Number(match[1]) : null;
}
