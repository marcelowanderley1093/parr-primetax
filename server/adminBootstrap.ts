import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { normalizeEmail } from "./localUsersHelpers";

export type AdminBootstrapDeps = {
  getLocalUserByEmail: (email: string) => Promise<{ id: number } | undefined>;
  createLocalUser: (data: {
    nome: string;
    email: string;
    passwordHash: string;
    role: "admin";
    active: number;
    mustChangePassword: number;
    createdBy: number | null;
  }) => Promise<number>;
  updateLocalUserAdmin: (
    id: number,
    data: { nome: string; passwordHash: string; role: "admin"; active: number; mustChangePassword: number }
  ) => Promise<void>;
};

export type EnsureAdminResult = {
  id: number;
  email: string;
  created: boolean;
  temporaryPassword: string;
};

export function generateTemporaryPassword(): string {
  // 16 bytes -> 22 caracteres base64url (>= 16 exigidos)
  return randomBytes(16).toString("base64url");
}

/**
 * Garante que exista um admin em local_users para o e-mail informado.
 * Idempotente: se existir, reseta a senha temporária e força role=admin, active=1,
 * mustChangePassword=1. A senha temporária só existe no retorno (e no console de quem rodou).
 */
export async function ensureAdmin(
  deps: AdminBootstrapDeps,
  input: { email: string; nome: string }
): Promise<EnsureAdminResult> {
  const email = normalizeEmail(input.email);
  const nome = input.nome.trim();
  if (!email.includes("@")) throw new Error("ADMIN_EMAIL inválido");
  if (nome.length < 2) throw new Error("ADMIN_NOME deve ter pelo menos 2 caracteres");

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  const existing = await deps.getLocalUserByEmail(email);
  if (existing) {
    await deps.updateLocalUserAdmin(existing.id, {
      nome,
      passwordHash,
      role: "admin",
      active: 1,
      mustChangePassword: 1,
    });
    return { id: existing.id, email, created: false, temporaryPassword };
  }

  const id = await deps.createLocalUser({
    nome,
    email,
    passwordHash,
    role: "admin",
    active: 1,
    mustChangePassword: 1,
    createdBy: null,
  });
  return { id, email, created: true, temporaryPassword };
}
