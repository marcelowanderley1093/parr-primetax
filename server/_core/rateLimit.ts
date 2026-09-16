import { TRPCError } from "@trpc/server";

// Limitador em memória para tentativas de login/troca de senha.
// Chave = IP + e-mail. Janela deslizante simples: 5 tentativas por 15 minutos;
// a 6ª tentativa dentro da janela é recusada com TOO_MANY_REQUESTS.
// Sucesso zera o contador da chave.
export const RATE_LIMIT_MAX_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimitKey(ip: string | undefined, email: string): string {
  return `${ip ?? "unknown"}|${email}`;
}

export function checkRateLimit(key: string, now: number = Date.now()): void {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX_ATTEMPTS) {
    const minutes = Math.max(1, Math.ceil((bucket.resetAt - now) / 60000));
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Muitas tentativas. Tente novamente em ${minutes} min.`,
    });
  }
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Somente para testes. */
export function clearRateLimits(): void {
  buckets.clear();
}
