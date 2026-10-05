// Cliente HTTP da API EmpresAqui. A URL leva o token: NUNCA registrar a URL nem a mensagem do fetch.
// Limite da API: 1 requisicao por segundo (acima disso, HTTP 429). Este modulo serializa as consultas do processo
// com 1,1 s de intervalo.
import { NaoEncontradoError, parseRespostaApi, type DadosApi } from "./parserApi";

const URL_BASE = "https://www.empresaqui.com.br/acesso/RetornoJson.php";
const INTERVALO_MS = 1_100;
const TIMEOUT_MS = 20_000;

export type CodigoErroApi = "token_invalido" | "sem_permissao" | "limite" | "indisponivel" | "resposta_invalida";

export type ResultadoConsulta =
  | { tipo: "ok"; dados: DadosApi; bruto: unknown; http: number }
  | { tipo: "nao_encontrado"; http: number }
  | { tipo: "erro"; codigo: CodigoErroApi; http: number | null };

export const MENSAGEM_ERRO_API: Record<CodigoErroApi, string> = {
  token_invalido: "Token da EmpresAqui inválido. Confira a configuração da integração.",
  sem_permissao: "A conta EmpresAqui não tem permissão para esta consulta.",
  limite: "Limite de consultas da EmpresAqui atingido. Tente de novo em instantes.",
  indisponivel: "A EmpresAqui não respondeu. Tente de novo em alguns minutos.",
  resposta_invalida: "A EmpresAqui devolveu uma resposta fora do formato esperado.",
};

let fila: Promise<unknown> = Promise.resolve();
let ultimaConsulta = 0;

/** Executa `fn` respeitando o intervalo minimo entre consultas (fila unica por processo). */
function naFila<T>(fn: () => Promise<T>, agora: () => number = Date.now, esperar = (ms: number) => new Promise(r => setTimeout(r, ms))): Promise<T> {
  const proxima = fila.then(async () => {
    const espera = ultimaConsulta + INTERVALO_MS - agora();
    if (espera > 0) await esperar(espera);
    ultimaConsulta = agora();
    return fn();
  });
  fila = proxima.catch(() => undefined);
  return proxima;
}

/** Consulta um CNPJ (14 digitos). Nunca lanca por erro da API: devolve o resultado classificado. */
export function consultarCnpj(cnpj14: string, token: string, fetchImpl: typeof fetch = fetch): Promise<ResultadoConsulta> {
  return naFila(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(`${URL_BASE}?Token=${encodeURIComponent(token)}&Cnpj=${cnpj14}`, { signal: ctrl.signal });
    } catch {
      return { tipo: "erro", codigo: "indisponivel", http: null };
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401) return { tipo: "erro", codigo: "token_invalido", http: 401 };
    if (res.status === 403) return { tipo: "erro", codigo: "sem_permissao", http: 403 };
    if (res.status === 429) return { tipo: "erro", codigo: "limite", http: 429 };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { tipo: "erro", codigo: res.status >= 500 ? "indisponivel" : "resposta_invalida", http: res.status };
    }
    try {
      return { tipo: "ok", dados: parseRespostaApi(json), bruto: json, http: res.status };
    } catch (e) {
      if (e instanceof NaoEncontradoError || res.status === 404) return { tipo: "nao_encontrado", http: res.status };
      return { tipo: "erro", codigo: res.status >= 500 ? "indisponivel" : "resposta_invalida", http: res.status };
    }
  });
}
