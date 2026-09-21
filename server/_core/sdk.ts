import { COOKIE_NAME, ONE_YEAR_MS, SESSION_APP_ID } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { parseLocalOpenId } from "../localUsersHelpers";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

class SDKServer {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(`local-${localUser.id}`);
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: SESSION_APP_ID,
        name: options.name || "",
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }

      if (appId !== SESSION_APP_ID) {
        console.warn("[Auth] Session appId mismatch");
        return null;
      }

      return {
        openId,
        appId,
        name,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const signedInAt = new Date();
    const user = await db.getUserByOpenId(session.openId);

    if (!user) {
      throw ForbiddenError("User not found");
    }

    // Usuario local desativado perde a sessao imediatamente (nao so no proximo login)
    const localId = parseLocalOpenId(user.openId);
    let effectiveRole: User["role"] = user.role;
    if (localId !== null) {
      const localUser = await db.getLocalUserById(localId);
      if (!localUser || !localUser.active) {
        throw ForbiddenError("User inactive");
      }
      // Senha temporaria pendente: sessao invalida ate changePassword zerar a flag
      // (o cookie emitido no login passa a valer sozinho depois da troca)
      if (localUser.mustChangePassword === 1) {
        throw ForbiddenError("Password change required");
      }
      // Papel efetivo = local_users.role AGORA; users.role so era sincronizado no login
      effectiveRole = localUser.role;
    }

    await db.upsertUser({
      openId: user.openId,
      role: effectiveRole,
      lastSignedIn: signedInAt,
    });

    return { ...user, role: effectiveRole };
  }
}

export const sdk = new SDKServer();
