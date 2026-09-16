import { describe, expect, it } from "vitest";
import {
  buildGoogleCalendarAuthUrl,
  GOOGLE_CALENDAR_CALLBACK_PATH,
  getGoogleCalendarRedirectUri,
} from "./googleCalendar";

// Testes puros: nao dependem de GOOGLE_CALENDAR_CLIENT_ID/SECRET nem de PUBLIC_BASE_URL no ambiente.
describe("Google Calendar - redirect URI", () => {
  it("monta a redirect URI a partir da base publica", () => {
    expect(getGoogleCalendarRedirectUri("https://parr.primetax.com.br")).toBe(
      "https://parr.primetax.com.br" + GOOGLE_CALENDAR_CALLBACK_PATH
    );
  });

  it("lanca erro claro quando PUBLIC_BASE_URL esta vazia", () => {
    expect(() => getGoogleCalendarRedirectUri("")).toThrow(/PUBLIC_BASE_URL/);
  });
});

describe("Google Calendar - URL de autorizacao", () => {
  const clientId = "123456789-abc.apps.googleusercontent.com";
  const redirectUri = "https://staging.parr.primetax.com.br/api/google-calendar/callback";
  const url = new URL(buildGoogleCalendarAuthUrl(clientId, redirectUri));

  it("aponta para accounts.google.com com client_id e redirect_uri codificados", () => {
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.toString()).toContain(encodeURIComponent(redirectUri));
  });

  it("pede escopo calendar, refresh token (offline) e consentimento", () => {
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
});
