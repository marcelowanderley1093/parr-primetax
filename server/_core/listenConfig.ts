export type ListenConfig = { host: string; port: number };

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3000;

/**
 * Resolve host e porta de escuta a partir do ambiente. Pura: recebe o objeto de env.
 * - HOST ausente/vazio -> 127.0.0.1 (atras do nginx; nunca exposto por padrao)
 * - PORT ausente/vazio -> 3000; nao numerico ou fora de 1..65535 -> lanca
 */
export function resolveListenConfig(env: Record<string, string | undefined>): ListenConfig {
  const host = (env.HOST ?? "").trim() || DEFAULT_HOST;

  const rawPort = (env.PORT ?? "").trim();
  if (rawPort === "") return { host, port: DEFAULT_PORT };

  if (!/^\d+$/.test(rawPort)) {
    throw new Error(`PORT invalida: "${rawPort}" (esperado inteiro entre 1 e 65535)`);
  }
  const port = Number(rawPort);
  if (port < 1 || port > 65535) {
    throw new Error(`PORT fora do intervalo: ${port} (esperado 1..65535)`);
  }
  return { host, port };
}
