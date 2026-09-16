import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Google Calendar OAuth callback
  app.get("/api/google-calendar/callback", async (req, res) => {
    try {
      const code = req.query.code as string;
      const { ENV: _ENV } = await import("./env.js");
      const clientId = _ENV.googleCalendarClientId;
      const clientSecret = _ENV.googleCalendarClientSecret;
      console.log('[Google Calendar] Callback - clientId present:', !!clientId, 'clientSecret present:', !!clientSecret, 'code present:', !!code);
      if (!code || !clientId || !clientSecret) {
        return res.status(400).send(`Missing parameters: code=${!!code}, clientId=${!!clientId}, clientSecret=${!!clientSecret}`);
      }
      // Hardcode the published domain to match getAuthUrl and Google Console config
      const PUBLISHED_DOMAIN = process.env.GOOGLE_CALENDAR_REDIRECT_DOMAIN || 'primetaxleads-ce79cane.manus.space';
      const redirectUri = `https://${PUBLISHED_DOMAIN}/api/google-calendar/callback`;
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
      console.log('[Google Calendar] Token exchange response:', JSON.stringify(tokenData));
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

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
