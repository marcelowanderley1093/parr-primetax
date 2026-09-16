export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  googleCalendarClientId: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
  googleCalendarClientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "",
};
