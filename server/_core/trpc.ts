import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

export const MENSAGEM_ERRO_INTERNO = "Erro interno no servidor. Tente de novo; se persistir, avise o administrador.";

/**
 * Erro inesperado (INTERNAL_SERVER_ERROR) nunca devolve a mensagem original ao navegador: erros do driver MySQL
 * trazem o SQL com os valores da linha (dados pessoais). Erros de negocio e de validacao seguem visiveis.
 */
export function formatarErro<S extends { message: string; data: Record<string, unknown> }>(opts: { shape: S; error: TRPCError }): S {
  const { shape, error } = opts;
  if (error.code !== "INTERNAL_SERVER_ERROR") return shape;
  return { ...shape, message: MENSAGEM_ERRO_INTERNO, data: { ...shape.data, stack: undefined } };
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: formatarErro,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
