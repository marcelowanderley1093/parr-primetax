// Parser de leads.telefoneSocios (JSON gravado por SQL externo; somente leitura na aplicacao).
// Validadores portados verbatim da producao.

export type Socio = {
  nome: string;
  cpf: string;
  telefones: string[];
};

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

/**
 * JSON invalido ou nao-array -> []. Filtra nomes invalidos, zera CPF invalido,
 * filtra telefones invalidos e descarta socio sem telefone e sem CPF.
 */
export function parseSocios(raw: string | null | undefined): Socio[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const socios: Socio[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const nome = asString(entry.nome).trim();
    if (!isValidName(nome)) continue;

    const cpfRaw = asString(entry.cpf).trim();
    const cpf = isValidCpf(cpfRaw) ? cpfRaw : "";

    const telefones = asStringArray(entry.telefones).map(t => t.trim()).filter(isValidPhone);

    if (telefones.length === 0 && !cpf) continue;
    socios.push({ nome, cpf, telefones });
  }
  return socios;
}

/** Digitos do telefone com DDI 55 para link wa.me. */
export function whatsappDigits(telefone: string): string {
  return "55" + telefone.replace(/\D/g, "");
}
