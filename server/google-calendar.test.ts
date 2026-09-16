import { describe, expect, it } from "vitest";

describe("Google Calendar credentials", () => {
  it("GOOGLE_CALENDAR_CLIENT_ID is set and looks valid", () => {
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    expect(clientId).toBeDefined();
    expect(clientId).toBeTruthy();
    expect(clientId!.length).toBeGreaterThan(10);
    expect(clientId).toContain(".apps.googleusercontent.com");
  });

  it("GOOGLE_CALENDAR_CLIENT_SECRET is set and looks valid", () => {
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    expect(clientSecret).toBeDefined();
    expect(clientSecret).toBeTruthy();
    expect(clientSecret!.length).toBeGreaterThan(10);
    expect(clientSecret).toMatch(/^GOCSPX-/);
  });

  it("can build OAuth authorization URL", () => {
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const redirectUri = "https://primetaxleads-ce79cane.manus.space/api/google-calendar/callback";
    const scope = "https://www.googleapis.com/auth/calendar";

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId!);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("access_type", "offline");

    expect(authUrl.toString()).toContain("accounts.google.com");
    expect(authUrl.toString()).toContain("client_id=");
    expect(authUrl.toString()).toContain("calendar");
  });
});
