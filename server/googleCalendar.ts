import { ENV } from "./_core/env";

export const GOOGLE_CALENDAR_CALLBACK_PATH = "/api/google-calendar/callback";
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/** PUBLIC_BASE_URL sem barra final (ex.: https://parr.primetax.com.br). Vazio se nao configurado. */
export function getPublicBaseUrl(): string {
  return ENV.publicBaseUrl;
}

/** Redirect URI registrada no Google Cloud Console. Lanca se PUBLIC_BASE_URL nao esta definida. */
export function getGoogleCalendarRedirectUri(baseUrl: string = getPublicBaseUrl()): string {
  if (!baseUrl) {
    throw new Error("PUBLIC_BASE_URL nao configurada; necessaria para o redirect do Google Calendar");
  }
  return `${baseUrl}${GOOGLE_CALENDAR_CALLBACK_PATH}`;
}

export function buildGoogleCalendarAuthUrl(clientId: string, redirectUri: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}
