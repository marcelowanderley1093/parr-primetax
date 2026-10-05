// Sonda ESTRUTURAL da API EmpresAqui. Consulta UM CNPJ e imprime somente metadados: status HTTP, content-type,
// a arvore de chaves e, para cada texto, o FORMATO mascarado (digito -> 9, letra -> a; ex.: "99/99/9999").
// NUNCA imprime valor de campo nem a URL (a URL carrega o token).
// Padrao: so o endpoint atual (1 consulta). Com --legado consulta tambem o legado (2 consultas; em 02/10/2026
// os dois devolveram a mesma estrutura).
//
// Uso (Git Bash): EMPRESAQUI_API_TOKEN=... pnpm tsx scripts/sonda-empresaqui.ts <cnpj>
//   - endpoint "atual": GET /acesso/RetornoJson.php?Token=&Cnpj=  (documentacao DocsAPI)
//   - endpoint "legado": GET /api/{token}/{cnpj}                  (usado pelo Partner Portal)
// Entre as duas chamadas espera 1,1 s (limite da API: 1 requisicao/segundo).

const BASE = "https://www.empresaqui.com.br";
const TIMEOUT_MS = 20_000;
const MAX_DEPTH = 6;

type Probe = { nome: string; url: (token: string, cnpj: string) => string };

/** Formato sem o valor: digito -> 9, letra -> a (inclui acentuadas), ate 40 caracteres. */
export function mascara(s: string): string {
  return s.replace(/\d/g, "9").replace(/[A-Za-zÀ-ÿ]/g, "a").slice(0, 40);
}

const PROBES: Probe[] = [
  { nome: "atual", url: (t, c) => `${BASE}/acesso/RetornoJson.php?Token=${encodeURIComponent(t)}&Cnpj=${c}` },
  { nome: "legado", url: (t, c) => `${BASE}/api/${encodeURIComponent(t)}/${c}` },
];

function jsType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// Descreve a estrutura sem valores. Objetos com chaves numericas ("0", "1", ...) sao colapsados:
// mostra quantas chaves numericas existem e a estrutura da primeira (assim o legado, que poe as
// dividas sob chaves numericas, nao despeja centenas de linhas).
function describe(v: unknown, indent: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH) {
    out.push(`${indent}(profundidade maxima)`);
    return;
  }
  if (Array.isArray(v)) {
    out.push(`${indent}[${v.length} item(ns)]${v.length ? ` tipo do 1o: ${jsType(v[0])}` : ""}`);
    if (v.length && v[0] && typeof v[0] === "object") describe(v[0], indent + "  ", depth + 1, out);
    else if (v.length && typeof v[0] === "string") out.push(`${indent}  formato do 1o: ${mascara(v[0])}`);
    return;
  }
  if (!v || typeof v !== "object") return;
  const entries = Object.entries(v as Record<string, unknown>);
  const numeric = entries.filter(([k]) => /^\d+$/.test(k));
  const named = entries.filter(([k]) => !/^\d+$/.test(k));
  for (const [k, child] of named) {
    const t = jsType(child);
    let extra = "";
    if (typeof child === "string") extra = child.length === 0 ? " (vazio)" : ` (len ${child.length}) formato: ${mascara(child)}`;
    out.push(`${indent}${k}: ${t}${extra}`);
    if (child && typeof child === "object") describe(child, indent + "  ", depth + 1, out);
  }
  if (numeric.length) {
    out.push(`${indent}<${numeric.length} chave(s) numerica(s)> estrutura da primeira (${numeric[0][0]}): ${jsType(numeric[0][1])}`);
    if (numeric[0][1] && typeof numeric[0][1] === "object") describe(numeric[0][1], indent + "  ", depth + 1, out);
  }
}

async function probe(p: Probe, token: string, cnpj: string): Promise<void> {
  console.log(`\n=== endpoint ${p.nome} ===`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(p.url(token, cnpj), { signal: ctrl.signal });
    const body = await res.text();
    console.log(`HTTP ${res.status}; content-type: ${res.headers.get("content-type") ?? "(nenhum)"}; bytes: ${Buffer.byteLength(body)}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      console.log("corpo NAO e JSON (conteudo omitido)");
      return;
    }
    const out: string[] = [];
    console.log(`topo: ${jsType(parsed)}`);
    describe(parsed, "  ", 0, out);
    for (const l of out) console.log(l);
  } catch (e) {
    // Mensagem de erro do fetch pode conter a URL: imprime so o nome do erro.
    console.log(`falha de rede: ${(e as Error).name}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const token = process.env.EMPRESAQUI_API_TOKEN;
  const cnpj = (process.argv[2] ?? "").replace(/\D/g, "");
  if (!token) {
    console.error("PARAR: defina EMPRESAQUI_API_TOKEN no shell.");
    process.exit(1);
  }
  if (cnpj.length !== 14 && cnpj.length !== 8) {
    console.error("PARAR: informe um CNPJ (14 digitos) ou CNPJ base (8 digitos) como argumento.");
    process.exit(1);
  }
  const probes = process.argv.includes("--legado") ? PROBES : PROBES.filter(p => p.nome === "atual");
  for (let i = 0; i < probes.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1_100));
    await probe(probes[i], token, cnpj);
  }
}

main();
