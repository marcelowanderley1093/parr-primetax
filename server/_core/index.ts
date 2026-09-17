import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { GOOGLE_CALENDAR_CALLBACK_PATH } from "../googleCalendar";
import { resolveListenConfig } from "./listenConfig";

async function startServer() {
  const app = express();
  // Atras do reverse proxy da VPS: req.ip e req.protocol vem de X-Forwarded-For/Proto
  app.set("trust proxy", 1);
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Google Calendar OAuth callback
  app.get(GOOGLE_CALENDAR_CALLBACK_PATH, async (req, res) => {
    try {
      const code = req.query.code as string;
      const { ENV: _ENV } = await import("./env.js");
      const clientId = _ENV.googleCalendarClientId;
      const clientSecret = _ENV.googleCalendarClientSecret;
      console.log('[Google Calendar] Callback - clientId present:', !!clientId, 'clientSecret present:', !!clientSecret, 'code present:', !!code);
      if (!code || !clientId || !clientSecret) {
        return res.status(400).send(`Missing parameters: code=${!!code}, clientId=${!!clientId}, clientSecret=${!!clientSecret}`);
      }
      // Mesma redirect URI usada em getAuthUrl (PUBLIC_BASE_URL + callback)
      const { getGoogleCalendarRedirectUri } = await import("../googleCalendar");
      const redirectUri = getGoogleCalendarRedirectUri();
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokenData = await tokenRes.json();
      // Nunca logar o corpo: contem access_token/refresh_token
      console.log(`[Google Calendar] Token exchange: HTTP ${tokenRes.status}, refresh_token=${Boolean(tokenData?.refresh_token)}`);
      if (tokenData.refresh_token) {
        const { setSetting } = await import("../db");
        await setSetting("googleCalendarRefreshToken", tokenData.refresh_token);
        // Get user email
        if (tokenData.access_token) {
          try {
            const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
            });
            const userData = await userRes.json();
            if (userData.email) {
              await setSetting("googleCalendarEmail", userData.email);
            }
          } catch (e) { /* ignore */ }
        }
        res.redirect("/dashboard?calendar=connected");
      } else {
        res.redirect("/dashboard?calendar=error");
      }
    } catch (e) {
      console.error("[Google Calendar] OAuth callback error:", e);
      res.redirect("/dashboard?calendar=error");
    }
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const { host, port } = resolveListenConfig(process.env);

  // Porta ocupada (ou qualquer erro de bind) encerra o processo: nunca trocar de porta
  // silenciosamente atras do nginx/systemd.
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[Server] Porta em uso: ${host}:${port}. Encerrando.`);
    } else {
      console.error(`[Server] Falha ao escutar em ${host}:${port}: ${error.code ?? error.message}. Encerrando.`);
    }
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}/`);
  });
}

startServer().catch(console.error);
