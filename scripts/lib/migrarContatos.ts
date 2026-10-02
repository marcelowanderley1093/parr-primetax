// Logica pura da copia leads.telefoneSocios (JSON legado) -> lead_contatos. Sem banco, sem I/O.
//
// Regras de validacao IDENTICAS as de client/src/lib/socios.ts (parseSocios, portado verbatim da producao):
// o que a tela mostra hoje e exatamente o que vira linha em lead_contatos; o que a tela descarta hoje
// e descartado aqui, mas CONTADO no relatorio. O JSON original nao e alterado.
//
// Decisao 02/10/2026 (Marcelo, opcao "a"): guardar contatos de TODOS os socios do JSON, cada um
// identificado por pessoaNome/pessoaCpf. leads.cpf NAO e preenchido: o JSON nao diz quem e o intimado.

export type ContatoNovo = {
  leadId: number;
  pessoaNome: string;
  pessoaCpf: string | null;
  tipo: "telefone";
  valor: string; // so digitos, sem DDI 55
  origem: "base_anterior";
};

export type EstatisticasContatos = {
  leadsComJson: number;
  jsonInvalido: number; // JSON ilegivel ou nao-array (a tela mostra nada)
  sociosLidos: number;
  sociosNomeInvalido: number; // descartados pela regra de nome
  sociosSemTelefoneESemCpf: number; // descartados (a tela tambem descarta)
  sociosSoComCpf: number; // CPF valido e nenhum telefone: a tela mostra, mas nao gera linha de contato
  sociosMesmoNomeDoLead: number; // informativo: candidato a ser o intimado
  cpfsValidos: number;
  cpfsInvalidosZerados: number;
  telefonesLidos: number;
  telefonesInvalidos: number;
  telefonesDuplicados: number; // mesmo numero para a mesma pessoa no mesmo lead
  contatosGerados: number;
};

export function estatisticasVazias(): EstatisticasContatos {
  return {
    leadsComJson: 0, jsonInvalido: 0, sociosLidos: 0, sociosNomeInvalido: 0, sociosSemTelefoneESemCpf: 0,
    sociosSoComCpf: 0, sociosMesmoNomeDoLead: 0, cpfsValidos: 0, cpfsInvalidosZerados: 0, telefonesLidos: 0,
    telefonesInvalidos: 0, telefonesDuplicados: 0, contatosGerados: 0,
  };
}

// --- validadores: copia fiel de client/src/lib/socios.ts (manter em sincronia)
const isValidName = (name: string) => {
  if (!name || name.trim().length < 3) return false;
  if (/^\(\d{2}\)/.test(name)) return false;
  if (/^\d{8,}$/.test(name.replace(/[.\-\/]/g, ""))) return false;
  return /[A-Za-zÀ-ÿ]{2,}/.test(name);
};
const isValidCpf = (cpf: string) => {
  if (!cpf) return false;
  return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf) || (/^\d{11}$/.test(cpf.replace(/\D/g, "")));
};
const isValidPhone = (tel: string) => {
  if (!tel) return false;
  if (/[A-Za-z]/.test(tel)) return false;
  if (!tel.trim().startsWith("(")) return false;
  const digits = tel.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 13;
};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** Telefone ja validado -> so digitos; tira DDI 55 quando sobra DDD + numero (10 ou 11 digitos). */
export function normalizarTelefone(tel: string): string {
  const d = tel.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d.slice(2);
  return d;
}

/** Comparacao de nomes sem acento, caixa e espacos extras. */
export function mesmoNome(a: string, b: string): boolean {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  return n(a) !== "" && n(a) === n(b);
}

/**
 * Converte o JSON de um lead em linhas de lead_contatos, acumulando estatisticas em `stats`.
 * Nunca lanca: JSON ruim conta como jsonInvalido e gera zero linhas (mesmo comportamento da tela).
 */
export function contatosDoLead(
  lead: { id: number; nome: string; telefoneSocios: string | null },
  stats: EstatisticasContatos,
): ContatoNovo[] {
  if (!lead.telefoneSocios) return [];
  stats.leadsComJson++;
  let data: unknown;
  try {
    data = JSON.parse(lead.telefoneSocios);
  } catch {
    stats.jsonInvalido++;
    return [];
  }
  if (!Array.isArray(data)) {
    stats.jsonInvalido++;
    return [];
  }

  const out: ContatoNovo[] = [];
  const vistos = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    stats.sociosLidos++;
    const entry = item as Record<string, unknown>;
    const nome = asString(entry.nome).trim();
    if (!isValidName(nome)) {
      stats.sociosNomeInvalido++;
      continue;
    }

    const cpfRaw = asString(entry.cpf).trim();
    const cpf = isValidCpf(cpfRaw) ? cpfRaw.replace(/\D/g, "") : null;
    if (cpf) stats.cpfsValidos++;
    else if (cpfRaw) stats.cpfsInvalidosZerados++;

    const brutos = asStringArray(entry.telefones).map(t => t.trim());
    stats.telefonesLidos += brutos.length;
    const telefones = brutos.filter(isValidPhone);
    stats.telefonesInvalidos += brutos.length - telefones.length;

    if (telefones.length === 0 && !cpf) {
      stats.sociosSemTelefoneESemCpf++;
      continue;
    }
    if (mesmoNome(nome, lead.nome)) stats.sociosMesmoNomeDoLead++;
    if (telefones.length === 0) {
      stats.sociosSoComCpf++;
      continue;
    }

    for (const t of telefones) {
      const valor = normalizarTelefone(t);
      const chave = `${nome}|${cpf ?? ""}|${valor}`;
      if (vistos.has(chave)) {
        stats.telefonesDuplicados++;
        continue;
      }
      vistos.add(chave);
      out.push({ leadId: lead.id, pessoaNome: nome, pessoaCpf: cpf, tipo: "telefone", valor, origem: "base_anterior" });
    }
  }
  stats.contatosGerados += out.length;
  return out;
}

export class MigracaoAbort extends Error {}

export function parseArgsMigracao(argv: string[]): { run: "dry-run" | "apply" } {
  const dry = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  const desconhecidos = argv.filter(a => a !== "--dry-run" && a !== "--apply");
  if (desconhecidos.length) throw new MigracaoAbort(`argumento desconhecido: ${desconhecidos.join(" ")}`);
  if (dry === apply) throw new MigracaoAbort("informe exatamente um entre --dry-run e --apply");
  return { run: dry ? "dry-run" : "apply" };
}
