export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  /** Origem publica do app, sem barra final (ex.: https://parr.primetax.com.br). */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, ""),
  // Removidos no commit de limpeza junto com os modulos _core orfaos que ainda os referenciam
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  googleCalendarClientId: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
  googleCalendarClientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "",
  // Lidas em tempo de chamada (getter) para permitir teste sem reimportar o modulo.
  get smtp() {
    return {
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT ?? "587"),
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
      from: process.env.SMTP_FROM ?? "",
    };
  },
  /** NOTIFY_EMAIL_TO aceita lista separada por virgula. */
  get notifyEmailTo(): string[] {
    return (process.env.NOTIFY_EMAIL_TO ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(s => s.length > 0);
  },
};
