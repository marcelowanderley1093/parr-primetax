// Logica pura: atribui os leads JA EM ANDAMENTO (status diferente de "novo_lead") a quem os moveu.
// Decisao 02/10/2026 (Marcelo): lead em andamento fica com quem o moveu; distribuicao sempre por GRUPO
// (pessoa ou empresa em comum => mesmo parceiro).
//
// Autor = userName da mudanca de status mais recente do lead (o historico importado da Manus nao tem userId, so o
// nome). O nome e casado com local_users.nome (sem acento/caixa/espacos). Sem autor, autor que nao casa ou casa com
// mais de um usuario, ou grupo com autores diferentes => PENDENTE (o admin decide). Leads que ja tem responsavel
// nunca sao alterados.

export type LeadAndamento = { id: number; status: string; grupoId: number | null; responsavelId: number | null };
export type MudancaStatus = { leadId: number; userName: string | null; createdAt: string | Date; id: number };
export type UsuarioLocal = { id: number; nome: string };
export type LeadDoGrupo = { id: number; grupoId: number | null; responsavelId: number | null };

export type Atribuicao = { leadId: number; responsavelId: number };
export type Pendente = { leadId: number; motivo: "sem_autor" | "autor_desconhecido" | "autor_ambiguo" | "grupo_com_autores_diferentes" };

const AUTORES_SISTEMA = new Set(["SISTEMA", "IMPORTACAO EXCEL"]);

export function normNome(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** Autor da mudanca de status mais recente de cada lead (ignora "Sistema" e importacoes). */
export function ultimoAutorPorLead(historico: MudancaStatus[]): Map<number, string | null> {
  const ultimo = new Map<number, MudancaStatus>();
  for (const h of historico) {
    const atual = ultimo.get(h.leadId);
    const t = new Date(h.createdAt).getTime();
    if (!atual || t > new Date(atual.createdAt).getTime() || (t === new Date(atual.createdAt).getTime() && h.id > atual.id)) {
      ultimo.set(h.leadId, h);
    }
  }
  const out = new Map<number, string | null>();
  for (const [leadId, h] of Array.from(ultimo.entries())) {
    const nome = h.userName ? normNome(h.userName) : "";
    out.set(leadId, nome && !AUTORES_SISTEMA.has(nome) ? h.userName : null);
  }
  return out;
}

export function planejarAtribuicao(
  andamento: LeadAndamento[],
  historico: MudancaStatus[],
  usuarios: UsuarioLocal[],
  leadsDosGrupos: LeadDoGrupo[],
): { atribuicoes: Atribuicao[]; pendentes: Pendente[]; resumo: Record<string, number> } {
  const autores = ultimoAutorPorLead(historico);
  const porNome = new Map<string, UsuarioLocal[]>();
  for (const u of usuarios) {
    const k = normNome(u.nome);
    porNome.set(k, [...(porNome.get(k) ?? []), u]);
  }

  // 1. Responsavel proposto para cada lead em andamento ainda sem dono
  const pendentes: Pendente[] = [];
  const proposta = new Map<number, number>(); // leadId -> local_users.id
  for (const l of andamento) {
    if (l.status === "novo_lead" || l.responsavelId !== null) continue;
    const autor = autores.get(l.id);
    if (!autor) { pendentes.push({ leadId: l.id, motivo: "sem_autor" }); continue; }
    const candidatos = porNome.get(normNome(autor)) ?? [];
    if (candidatos.length === 0) { pendentes.push({ leadId: l.id, motivo: "autor_desconhecido" }); continue; }
    if (candidatos.length > 1) { pendentes.push({ leadId: l.id, motivo: "autor_ambiguo" }); continue; }
    proposta.set(l.id, candidatos[0].id);
  }

  // 2. Consolida por grupo: todos os autores do grupo precisam ser o mesmo
  const andamentoPorId = new Map(andamento.map(l => [l.id, l]));
  const donoDoGrupo = new Map<number, number | "conflito">();
  for (const [leadId, resp] of Array.from(proposta.entries())) {
    const g = andamentoPorId.get(leadId)!.grupoId;
    if (g === null) continue;
    const atual = donoDoGrupo.get(g);
    donoDoGrupo.set(g, atual === undefined || atual === resp ? resp : "conflito");
  }
  // grupo em que algum lead ja tem dono diferente do proposto tambem e conflito
  for (const l of leadsDosGrupos) {
    if (l.grupoId === null || l.responsavelId === null) continue;
    const d = donoDoGrupo.get(l.grupoId);
    if (d !== undefined && d !== "conflito" && d !== l.responsavelId) donoDoGrupo.set(l.grupoId, "conflito");
  }

  const atribuicoes: Atribuicao[] = [];
  const jaAtribuido = new Set<number>();
  for (const [leadId, resp] of Array.from(proposta.entries())) {
    const g = andamentoPorId.get(leadId)!.grupoId;
    if (g === null) { atribuicoes.push({ leadId, responsavelId: resp }); jaAtribuido.add(leadId); continue; }
    if (donoDoGrupo.get(g) === "conflito") pendentes.push({ leadId, motivo: "grupo_com_autores_diferentes" });
  }
  // o grupo vai inteiro: todos os leads sem dono dos grupos resolvidos
  for (const l of leadsDosGrupos) {
    if (l.grupoId === null || l.responsavelId !== null || jaAtribuido.has(l.id)) continue;
    const d = donoDoGrupo.get(l.grupoId);
    if (d !== undefined && d !== "conflito") { atribuicoes.push({ leadId: l.id, responsavelId: d }); jaAtribuido.add(l.id); }
  }

  const contar = (m: Pendente["motivo"]) => pendentes.filter(p => p.motivo === m).length;
  return {
    atribuicoes,
    pendentes,
    resumo: {
      leadsEmAndamentoSemDono: andamento.filter(l => l.status !== "novo_lead" && l.responsavelId === null).length,
      leadsAtribuidos: atribuicoes.length,
      gruposAtribuidos: Array.from(donoDoGrupo.values()).filter(d => d !== "conflito").length,
      pendentesSemAutor: contar("sem_autor"),
      pendentesAutorDesconhecido: contar("autor_desconhecido"),
      pendentesAutorAmbiguo: contar("autor_ambiguo"),
      pendentesGrupoComAutoresDiferentes: contar("grupo_com_autores_diferentes"),
    },
  };
}
