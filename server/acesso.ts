// Controle de acesso por dono do lead (carteira). Decisao 02/10/2026 (Marcelo): parceiros comerciais concorrentes
// nao podem ver leads uns dos outros.
// - admin: ve e altera tudo;
// - comercial (parceiro): so os leads em que leads.responsavelId = seu local_users.id;
// - lead de outro parceiro responde "Lead nao encontrado" (NOT_FOUND), sem revelar que existe.
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import { parseLocalOpenId } from "./localUsersHelpers";
import * as db from "./db";

type Usuario = NonNullable<TrpcContext["user"]>;

export const LEAD_NAO_ENCONTRADO = "Lead não encontrado";

/**
 * Responsavel a filtrar nas listagens: undefined = sem filtro (admin); numero = so os leads desse local_users.id.
 * Comercial sem conta local (nao deveria existir) recebe -1: nao enxerga nenhum lead.
 */
export function responsavelDoEscopo(user: Usuario): number | undefined {
  if (user.role === "admin") return undefined;
  return parseLocalOpenId(user.openId) ?? -1;
}

export type VisaoPedida = "todos" | "livres" | "arquivados" | number | undefined;

/**
 * Visao efetiva do Kanban. Parceiro: sempre a propria carteira (pode alternar para os proprios arquivados).
 * Admin: todos, livres (sem dono), arquivados ou a carteira de um parceiro (numero = local_users.id).
 */
export function visaoKanban(user: Usuario, pedida: VisaoPedida): db.VisaoKanban {
  const proprio = responsavelDoEscopo(user);
  if (proprio !== undefined) return { responsavelId: proprio, arquivados: pedida === "arquivados" };
  if (pedida === "livres") return { livres: true };
  if (pedida === "arquivados") return { arquivados: true };
  if (typeof pedida === "number") return { responsavelId: pedida };
  return {};
}

/** Pode acessar o lead? Admin sempre; parceiro so se for o responsavel. */
export function podeAcessar(user: Usuario, responsavelId: number | null | undefined): boolean {
  const escopo = responsavelDoEscopo(user);
  return escopo === undefined || (responsavelId != null && responsavelId === escopo);
}

/** Lanca NOT_FOUND se o lead nao existe ou nao e da carteira do usuario. */
export async function exigirAcessoLead(user: Usuario, leadId: number): Promise<void> {
  if (responsavelDoEscopo(user) === undefined) return;
  const lead = await db.getResponsavelDoLead(leadId);
  if (!lead || !podeAcessar(user, lead.responsavelId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: LEAD_NAO_ENCONTRADO });
  }
}
