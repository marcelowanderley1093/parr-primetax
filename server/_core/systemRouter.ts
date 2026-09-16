import { z } from "zod";
import { isNotificationConfigured, notifyOwner } from "./notification";
import { ENV } from "./env";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  // Envia um e-mail de teste para NOTIFY_EMAIL_TO (admin). Util para validar o SMTP no staging.
  testarEmail: adminProcedure.mutation(async ({ ctx }) => {
    const configured = isNotificationConfigured();
    if (!configured) {
      return { success: false, configured, to: [] as string[] } as const;
    }
    const delivered = await notifyOwner({
      title: "PARR Primetax: teste de e-mail",
      content:
        `E-mail de teste enviado pelo painel PARR.\n` +
        `Solicitado por: ${ctx.user.name ?? ctx.user.openId}\n` +
        `Data: ${new Date().toISOString()}`,
    });
    return { success: delivered, configured, to: ENV.notifyEmailTo } as const;
  }),
});
