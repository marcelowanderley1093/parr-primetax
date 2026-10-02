// Regras de contato compartilhadas entre cliente e servidor (lead_contatos e leads.cpf).
// Telefone e guardado so com digitos, sem DDI 55 (10 = fixo, 11 = celular). CPF so com digitos.

export const STATUS_CONTATO = ["nao_testado", "atende", "whatsapp", "numero_errado", "nao_e_o_socio"] as const;
export type StatusContato = (typeof STATUS_CONTATO)[number];

export const STATUS_CONTATO_LABEL: Record<StatusContato, string> = {
  nao_testado: "Não testado",
  atende: "Atende",
  whatsapp: "WhatsApp",
  numero_errado: "Número errado",
  nao_e_o_socio: "Não é o sócio",
};

/** Status que tiram o numero de circulacao: aparece riscado e no fim da lista. */
export const STATUS_DESCARTADO: ReadonlySet<StatusContato> = new Set<StatusContato>(["numero_errado", "nao_e_o_socio"]);

export const digitos = (s: string): string => s.replace(/\D/g, "");

/** Telefone digitado -> so digitos sem DDI 55, ou null se nao tiver 10/11 digitos com DDD valido. */
export function normalizarTelefone(entrada: string): string | null {
  let d = digitos(entrada);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d[0] === "0" || d[1] === "0") return null; // DDD vai de 11 a 99
  if (d.length === 11 && d[2] !== "9") return null; // celular com 11 digitos comeca com 9
  return d;
}

/** "11912345678" -> "(11) 91234-5678"; "1130000000" -> "(11) 3000-0000". Outro formato: devolve como veio. */
export function formatarTelefone(valor: string): string {
  const d = digitos(valor);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return valor;
}

/** Link wa.me com DDI 55. */
export function linkWhatsapp(valor: string): string {
  return `https://wa.me/55${digitos(valor)}`;
}

/** CPF valido pelo digito verificador (modulo 11). Rejeita sequencias repetidas. */
export function cpfValido(cpf: string): boolean {
  const d = digitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number): number => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(d[i]) * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** "12345678909" -> "123.456.789-09". Fora de 11 digitos: devolve como veio. */
export function formatarCpf(cpf: string): string {
  const d = digitos(cpf);
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Mascara para listagens: "***.456.789-**". */
export function mascararCpf(cpf: string): string {
  const d = digitos(cpf);
  if (d.length !== 11) return "***";
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/** E-mail simples (mesma exigencia do zod: algo@algo.algo). */
export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Comparacao de nomes sem acento, caixa e espacos extras. */
export function mesmoNome(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!a || !b) return false;
  return n(a) !== "" && n(a) === n(b);
}

type ContatoParaAgrupar = { id: number; pessoaNome: string | null; pessoaCpf: string | null; status: StatusContato };

export type GrupoContatos<T> = { pessoaNome: string | null; pessoaCpf: string | null; intimado: boolean; contatos: T[] };

/**
 * Agrupa contatos por pessoa (nome + CPF). O intimado (pessoa com o mesmo nome do lead) vem primeiro;
 * dentro de cada pessoa, numeros descartados (errado / nao e o socio) vao para o fim.
 */
export function agruparContatos<T extends ContatoParaAgrupar>(contatos: T[], nomeLead: string): GrupoContatos<T>[] {
  const grupos = new Map<string, GrupoContatos<T>>();
  for (const c of contatos) {
    const chave = `${(c.pessoaNome ?? "").trim().toUpperCase()}|${c.pessoaCpf ?? ""}`;
    let g = grupos.get(chave);
    if (!g) {
      g = { pessoaNome: c.pessoaNome, pessoaCpf: c.pessoaCpf, intimado: mesmoNome(c.pessoaNome, nomeLead), contatos: [] };
      grupos.set(chave, g);
    }
    g.contatos.push(c);
  }
  const lista = Array.from(grupos.values());
  for (const g of lista) {
    g.contatos.sort((a, b) => Number(STATUS_DESCARTADO.has(a.status)) - Number(STATUS_DESCARTADO.has(b.status)) || a.id - b.id);
  }
  return lista.sort((a, b) => Number(b.intimado) - Number(a.intimado));
}
