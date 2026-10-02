// Sonda ESTRUTURAL da API EmpresAqui. Consulta UM CNPJ nos dois endpoints conhecidos e imprime somente
// metadados: status HTTP, content-type e a arvore de chaves da resposta com o tipo JS de cada folha.
// NUNCA imprime valor de campo nem a URL (a URL carrega o token). Gasta ate 2 consultas do plano.
//
// Uso (Git Bash): EMPRESAQUI_API_TOKEN=... pnpm tsx scripts/sonda-empresaqui.ts <cnpj>
//   - endpoint "atual": GET /acesso/RetornoJson.php?Token=&Cnpj=  (documentacao DocsAPI)
//   - endpoint "legado": GET /api/{token}/{cnpj}                  (usado pelo Partner Portal)
// Entre as duas chamadas espera 1,1 s (limite da API: 1 requisicao/segundo).

const BASE = "https://www.empresaqui.com.br";
const TIMEOUT_MS = 20_000;
const MAX_DEPTH = 6;

type Probe = { nome: string; url: (token: string, cnpj: string) => string };

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
    return;
  }
  if (!v || typeof v !== "object") return;
  const entries = Object.entries(v as Record<string, unknown>);
  const numeric = entries.filter(([k]) => /^\d+$/.test(k));
  const named = entries.filter(([k]) => !/^\d+$/.test(k));
  for (const [k, child] of named) {
    const t = jsType(child);
    let extra = "";
    if (typeof child === "string") extra = child.length === 0 ? " (vazio)" : ` (len ${child.length})`;
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
  for (let i = 0; i < PROBES.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1_100));
    await probe(PROBES[i], token, cnpj);
  }
}

main();
