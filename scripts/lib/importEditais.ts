// Logica pura da importacao da base de editais PGFN (PARR) para leads + lead_procedimentos + editais. Sem banco.
//
// Decisoes (02/10/2026, Marcelo):
// - lead = par PESSOA + EMPRESA; os procedimentos (um por linha do edital) ficam dentro do lead;
// - pessoa = nome normalizado + CPF parcial publicado no edital ("***.432.***-**"); homonimos com CPF parcial
//   diferente sao pessoas diferentes;
// - distribuicao por GRUPO: leads que compartilham pessoa ou empresa ficam no mesmo grupo (mesmo parceiro);
// - carga da base inteira; idempotente pelo numero do procedimento (unico).
// Leads ja existentes (vindos da Manus, sem CPF parcial) sao casados por nome + CNPJ e ganham procedimentos,
// CPF parcial e datas; status, notas, contatos e CPF completo nao sao tocados.

// ---------------------------------------------------------------- formato

/** Colunas da aba "Consolidado PARR" da planilha extraida dos PDFs (ordem exata). */
export const COLUNAS_PLANILHA_EDITAIS = [
  "Ano", "Nº Edital", "Data de Publicação", "Nome do Contribuinte", "Contribuinte (CPF parcial)",
  "Nome do Devedor Principal", "Devedor Principal (CNPJ)", "CNPJ Raiz (8 díg.)", "Nº do Procedimento Administrativo",
  "Arquivo de Origem", "Pág.",
] as const;

/** Cabecalho do CSV gerado por scripts/converter-editais.ts (mesma ordem da planilha). */
export const CABECALHO_CSV_EDITAIS = [
  "ano", "numeroEdital", "dataPublicacao", "nomeContribuinte", "cpfParcial", "nomeDevedor", "cnpj", "cnpjRaiz",
  "numeroProcedimento", "arquivoOrigem", "pagina",
] as const;

/** Uma linha CSV com ";" (aspas so quando o campo tem ; " ou quebra de linha). */
export function linhaCsv(valores: string[]): string {
  return valores.map(v => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(";");
}

/** Le UMA linha CSV com ";" e aspas (o conversor nunca grava quebra de linha dentro de campo). */
export function parseLinhaCsv(linha: string): string[] {
  const out: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") { out.push(campo); campo = ""; }
    else campo += c;
  }
  out.push(campo);
  return out;
}

/** Percorre as linhas do texto sem montar um array com todas (memoria: o arquivo tem ~90 MB). */
function* linhasDoTexto(texto: string): Generator<string> {
  let ini = 0;
  while (ini < texto.length) {
    let fim = texto.indexOf("\n", ini);
    if (fim < 0) fim = texto.length;
    const l = texto.slice(ini, fim).replace(/\r$/, "");
    if (l !== "") yield l;
    ini = fim + 1;
  }
}

// ---------------------------------------------------------------- normalizacao

export const digitos = (s: string): string => s.replace(/\D/g, "");

export function normNome(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** CNPJ (formatado ou nao) -> 14 digitos, completando zero a esquerda perdido pelo Excel; invalido -> null. */
export function cnpj14(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = digitos(s);
  if (d.length === 0 || d.length > 14) return null;
  return d.padStart(14, "0");
}

export function formatarCnpj(d14: string): string {
  return `${d14.slice(0, 2)}.${d14.slice(2, 5)}.${d14.slice(5, 8)}/${d14.slice(8, 12)}-${d14.slice(12)}`;
}

/** Digito verificador do CNPJ (modulo 11). */
export function cnpjValido(d14: string): boolean {
  if (!/^\d{14}$/.test(d14) || /^(\d)\1{13}$/.test(d14)) return false;
  const calc = (len: number): number => {
    let soma = 0;
    let peso = len - 7;
    for (let i = 0; i < len; i++) {
      soma += Number(d14[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d14[12]) && calc(13) === Number(d14[13]);
}

/** "dd/mm/aaaa" -> "aaaa-mm-dd"; invalida -> null. */
export function dataIso(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  const dt = new Date(Date.UTC(+aaaa, +mm - 1, +dd));
  if (dt.getUTCFullYear() !== +aaaa || dt.getUTCMonth() !== +mm - 1 || dt.getUTCDate() !== +dd) return null;
  return `${aaaa}-${mm}-${dd}`;
}

/** Chave da pessoa: nome normalizado + CPF parcial como publicado (sem espacos). */
export const chavePessoa = (nome: string, cpfParcial: string): string => `${normNome(nome)}|${cpfParcial.replace(/\s/g, "")}`;
/** Chave do lead: pessoa + empresa. */
export const chaveLead = (nome: string, cpfParcial: string, cnpj: string): string => `${chavePessoa(nome, cpfParcial)}|${cnpj}`;
export const chaveEdital = (ano: number, numero: string): string => `${ano}|${numero}`;

// ---------------------------------------------------------------- leitura

export type LinhaEdital = {
  linha: number;
  ano: number;
  numeroEdital: string;
  dataPublicacao: string; // ISO
  nome: string;
  cpfParcial: string;
  nomeDevedor: string;
  cnpj: string; // 14 digitos
  numeroProcedimento: string;
  arquivoOrigem: string;
  pagina: number | null;
};

export type CodigoDescarte =
  | "colunas" | "ano_invalido" | "edital_vazio" | "data_invalida" | "nome_vazio" | "cpf_parcial_vazio"
  | "cnpj_invalido" | "procedimento_invalido" | "procedimento_repetido_no_arquivo";

export class LayoutEditaisError extends Error {}

/** Le o CSV do conversor, valida cada linha e descarta (contando) as invalidas e os procedimentos repetidos. */
export function lerCsvEditais(texto: string): { linhas: LinhaEdital[]; descartes: Partial<Record<CodigoDescarte, number>>; lidas: number } {
  const it = linhasDoTexto(texto.replace(/^\uFEFF/, ""));
  const primeira = it.next();
  const cab = primeira.done ? [] : parseLinhaCsv(primeira.value);
  if (cab.length !== CABECALHO_CSV_EDITAIS.length || CABECALHO_CSV_EDITAIS.some((c, i) => cab[i] !== c)) {
    throw new LayoutEditaisError(`cabecalho diferente do esperado: ${CABECALHO_CSV_EDITAIS.join(";")}`);
  }
  const descartes: Partial<Record<CodigoDescarte, number>> = {};
  const descartar = (c: CodigoDescarte) => { descartes[c] = (descartes[c] ?? 0) + 1; };
  const vistos = new Set<string>();
  const linhas: LinhaEdital[] = [];
  let n = 1;
  for (const bruta of it) {
    n++;
    const r = parseLinhaCsv(bruta);
    if (r.length !== CABECALHO_CSV_EDITAIS.length) { descartar("colunas"); continue; }
    const [ano, numeroEdital, data, nome, cpfParcial, nomeDevedor, cnpj, , proc, arquivo, pag] = r.map(v => v.trim());
    if (!/^\d{4}$/.test(ano)) { descartar("ano_invalido"); continue; }
    if (!numeroEdital) { descartar("edital_vazio"); continue; }
    const dataPublicacao = dataIso(data);
    if (!dataPublicacao) { descartar("data_invalida"); continue; }
    if (!nome) { descartar("nome_vazio"); continue; }
    if (!cpfParcial) { descartar("cpf_parcial_vazio"); continue; }
    const c = cnpj14(cnpj);
    if (!c || !cnpjValido(c)) { descartar("cnpj_invalido"); continue; }
    const numeroProcedimento = digitos(proc);
    if (numeroProcedimento.length < 6 || numeroProcedimento.length > 20) { descartar("procedimento_invalido"); continue; }
    if (vistos.has(numeroProcedimento)) { descartar("procedimento_repetido_no_arquivo"); continue; }
    vistos.add(numeroProcedimento);
    const p = Number(pag);
    linhas.push({
      linha: n, ano: Number(ano), numeroEdital, dataPublicacao, nome: nome.replace(/\s+/g, " "), cpfParcial: cpfParcial.replace(/\s/g, ""),
      nomeDevedor: nomeDevedor.replace(/\s+/g, " "), cnpj: c, numeroProcedimento, arquivoOrigem: arquivo,
      pagina: Number.isInteger(p) && p > 0 ? p : null,
    });
  }
  return { linhas, descartes, lidas: n - 1 };
}

// ---------------------------------------------------------------- plano

export type LeadExistente = {
  id: number;
  nome: string;
  cnpj: string | null;
  cpfParcial: string | null;
  grupoId: number | null;
  primeiraPublicacao: string | null;
  ultimaPublicacao: string | null;
  devedorPrincipal: string | null;
};

export type Existentes = {
  leads: LeadExistente[];
  procedimentos: ReadonlySet<string>;
  editais: ReadonlyMap<string, number>; // chaveEdital -> id
  maxGrupoId: number;
};

export type EditalNovo = { ano: number; numero: string; dataPublicacao: string; arquivoOrigem: string; qtdRegistros: number };
export type LeadNovo = {
  chave: string; nome: string; cpfParcial: string; cnpj: string; devedorPrincipal: string;
  primeiraPublicacao: string; ultimaPublicacao: string; grupoId: number;
};
export type LeadAtualizar = {
  id: number; cpfParcial: string | null; primeiraPublicacao: string | null; ultimaPublicacao: string | null;
  devedorPrincipal: string | null; grupoId: number;
};
export type ProcedimentoNovo = { chaveLead: string; chaveEdital: string; numeroProcedimento: string; cpfParcial: string; pagina: number | null };

export type ResumoPlano = {
  linhasValidas: number;
  editaisNoArquivo: number;
  editaisNovos: number;
  editaisDataDivergente: number;
  leadsNoArquivo: number;
  leadsNovos: number;
  leadsCasadosPorChave: number; // ja tinham CPF parcial (importacao anterior)
  leadsCasadosPorNomeCnpj: number; // leads antigos (Manus), sem CPF parcial
  casamentosAmbiguos: number; // nome + CNPJ casou com mais de um lead antigo (usado o de menor id)
  leadsExistentesAtualizados: number;
  procedimentosNoArquivo: number;
  procedimentosJaNoBanco: number;
  procedimentosNovos: number;
  grupos: number;
  gruposComMaisDeUmLead: number;
  maiorGrupo: number;
};

export type Plano = {
  editaisNovos: EditalNovo[];
  leadsNovos: LeadNovo[];
  leadsAtualizar: LeadAtualizar[];
  procedimentosNovos: ProcedimentoNovo[];
  resumo: ResumoPlano;
};

const minData = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);
const maxData = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/** Union-find simples sobre chaves texto. */
class UniaoBusca {
  private pai = new Map<string, string>();
  achar(x: string): string {
    let r = x;
    while (this.pai.has(r) && this.pai.get(r) !== r) r = this.pai.get(r)!;
    let y = x; // compressao de caminho
    while (this.pai.has(y) && this.pai.get(y) !== r) { const p = this.pai.get(y)!; this.pai.set(y, r); y = p; }
    if (!this.pai.has(r)) this.pai.set(r, r);
    return r;
  }
  unir(a: string, b: string): void {
    const ra = this.achar(a), rb = this.achar(b);
    if (ra !== rb) this.pai.set(rb, ra);
  }
}

/**
 * Monta o plano de importacao: o que inserir, o que atualizar e os grupos, a partir das linhas validas e do
 * que ja existe no banco. Rodar de novo com o banco atualizado produz plano vazio (idempotente).
 */
export function planejarImportacao(linhas: LinhaEdital[], ex: Existentes): Plano {
  // 1. Editais do arquivo
  const editaisArq = new Map<string, EditalNovo>();
  let editaisDataDivergente = 0;
  for (const l of linhas) {
    const k = chaveEdital(l.ano, l.numeroEdital);
    const e = editaisArq.get(k);
    if (!e) editaisArq.set(k, { ano: l.ano, numero: l.numeroEdital, dataPublicacao: l.dataPublicacao, arquivoOrigem: l.arquivoOrigem, qtdRegistros: 1 });
    else {
      e.qtdRegistros++;
      if (e.dataPublicacao !== l.dataPublicacao) editaisDataDivergente++;
    }
  }
  const editaisNovos = Array.from(editaisArq.entries()).filter(([k]) => !ex.editais.has(k)).map(([, e]) => e);

  // 2. Leads existentes: por chave completa (ja importados) e por nome + CNPJ (antigos, sem CPF parcial)
  const porChave = new Map<string, LeadExistente>();
  const antigosPorNomeCnpj = new Map<string, LeadExistente[]>();
  for (const l of ex.leads) {
    const c = cnpj14(l.cnpj);
    if (l.cpfParcial && c) porChave.set(chaveLead(l.nome, l.cpfParcial, c), l);
    else if (c) {
      const k = `${normNome(l.nome)}|${c}`;
      const lista = antigosPorNomeCnpj.get(k) ?? [];
      lista.push(l);
      antigosPorNomeCnpj.set(k, lista);
    }
  }
  for (const lista of Array.from(antigosPorNomeCnpj.values())) lista.sort((a, b) => a.id - b.id);

  // 3. Agrega linhas por lead (pessoa + empresa)
  type Agregado = { chave: string; nome: string; cpfParcial: string; cnpj: string; devedor: string; primeira: string; ultima: string; existente?: LeadExistente };
  const agregados = new Map<string, Agregado>();
  const procedimentosNovos: ProcedimentoNovo[] = [];
  let procedimentosJaNoBanco = 0;
  let casadosPorChave = 0, casadosPorNomeCnpj = 0, ambiguos = 0;
  const antigosUsados = new Set<number>();
  for (const l of linhas) {
    const k = chaveLead(l.nome, l.cpfParcial, l.cnpj);
    let a = agregados.get(k);
    if (!a) {
      a = { chave: k, nome: l.nome, cpfParcial: l.cpfParcial, cnpj: l.cnpj, devedor: l.nomeDevedor, primeira: l.dataPublicacao, ultima: l.dataPublicacao };
      const porK = porChave.get(k);
      if (porK) { a.existente = porK; casadosPorChave++; }
      else {
        const candidatos = (antigosPorNomeCnpj.get(`${normNome(l.nome)}|${l.cnpj}`) ?? []).filter(c => !antigosUsados.has(c.id));
        if (candidatos.length > 0) {
          if (candidatos.length > 1) ambiguos++;
          a.existente = candidatos[0];
          antigosUsados.add(candidatos[0].id);
          casadosPorNomeCnpj++;
        }
      }
      agregados.set(k, a);
    } else {
      a.primeira = minData(a.primeira, l.dataPublicacao)!;
      a.ultima = maxData(a.ultima, l.dataPublicacao)!;
    }
    if (ex.procedimentos.has(l.numeroProcedimento)) { procedimentosJaNoBanco++; continue; }
    procedimentosNovos.push({ chaveLead: k, chaveEdital: chaveEdital(l.ano, l.numeroEdital), numeroProcedimento: l.numeroProcedimento, cpfParcial: l.cpfParcial, pagina: l.pagina });
  }

  // 4. Grupos: une leads que compartilham pessoa (nome + CPF parcial) ou empresa (CNPJ).
  //    Leads sem CPF parcial so se ligam pela empresa; sem CNPJ, ficam sozinhos.
  const uf = new UniaoBusca();
  type No = { tipo: "existente"; lead: LeadExistente; cpfParcial: string | null } | { tipo: "novo"; ag: Agregado };
  const nos: { id: string; no: No }[] = [];
  const agregadoDoExistente = new Map<number, Agregado>();
  for (const a of Array.from(agregados.values())) if (a.existente) agregadoDoExistente.set(a.existente.id, a);
  for (const l of ex.leads) {
    const ag = agregadoDoExistente.get(l.id);
    const cpfParcial = l.cpfParcial ?? ag?.cpfParcial ?? null;
    const id = `L${l.id}`;
    nos.push({ id, no: { tipo: "existente", lead: l, cpfParcial } });
    uf.achar(id);
    const c = cnpj14(l.cnpj);
    if (c) uf.unir(id, `E:${c}`);
    if (cpfParcial) uf.unir(id, `P:${chavePessoa(l.nome, cpfParcial)}`);
  }
  for (const a of Array.from(agregados.values())) {
    if (a.existente) continue;
    const id = `N${a.chave}`;
    nos.push({ id, no: { tipo: "novo", ag: a } });
    uf.unir(id, `E:${a.cnpj}`);
    uf.unir(id, `P:${chavePessoa(a.nome, a.cpfParcial)}`);
  }
  // grupoId de cada componente: o menor grupoId ja existente nele; senao um novo, sequencial.
  const grupoDoComponente = new Map<string, number>();
  const tamanho = new Map<string, number>();
  for (const { id, no } of nos) {
    const r = uf.achar(id);
    tamanho.set(r, (tamanho.get(r) ?? 0) + 1);
    if (no.tipo === "existente" && no.lead.grupoId !== null) {
      const atual = grupoDoComponente.get(r);
      if (atual === undefined || no.lead.grupoId < atual) grupoDoComponente.set(r, no.lead.grupoId);
    }
  }
  let proximoGrupo = ex.maxGrupoId;
  const grupoDe = (id: string): number => {
    const r = uf.achar(id);
    let g = grupoDoComponente.get(r);
    if (g === undefined) { g = ++proximoGrupo; grupoDoComponente.set(r, g); }
    return g;
  };

  // 5. Saidas
  const leadsNovos: LeadNovo[] = [];
  const leadsAtualizar: LeadAtualizar[] = [];
  for (const { id, no } of nos) {
    const grupoId = grupoDe(id);
    if (no.tipo === "novo") {
      const a = no.ag;
      leadsNovos.push({
        chave: a.chave, nome: a.nome, cpfParcial: a.cpfParcial, cnpj: formatarCnpj(a.cnpj), devedorPrincipal: a.devedor,
        primeiraPublicacao: a.primeira, ultimaPublicacao: a.ultima, grupoId,
      });
      continue;
    }
    const l = no.lead;
    const ag = agregadoDoExistente.get(l.id);
    const novo: LeadAtualizar = {
      id: l.id,
      cpfParcial: l.cpfParcial ?? ag?.cpfParcial ?? null,
      primeiraPublicacao: minData(l.primeiraPublicacao, ag?.primeira ?? null),
      ultimaPublicacao: maxData(l.ultimaPublicacao, ag?.ultima ?? null),
      devedorPrincipal: l.devedorPrincipal || ag?.devedor || null,
      grupoId,
    };
    const mudou =
      novo.cpfParcial !== l.cpfParcial || novo.primeiraPublicacao !== l.primeiraPublicacao ||
      novo.ultimaPublicacao !== l.ultimaPublicacao || novo.devedorPrincipal !== l.devedorPrincipal || novo.grupoId !== l.grupoId;
    if (mudou) leadsAtualizar.push(novo);
  }

  const tamanhos = Array.from(tamanho.values());
  return {
    editaisNovos,
    leadsNovos,
    leadsAtualizar,
    procedimentosNovos,
    resumo: {
      linhasValidas: linhas.length,
      editaisNoArquivo: editaisArq.size,
      editaisNovos: editaisNovos.length,
      editaisDataDivergente,
      leadsNoArquivo: agregados.size,
      leadsNovos: leadsNovos.length,
      leadsCasadosPorChave: casadosPorChave,
      leadsCasadosPorNomeCnpj: casadosPorNomeCnpj,
      casamentosAmbiguos: ambiguos,
      leadsExistentesAtualizados: leadsAtualizar.length,
      procedimentosNoArquivo: linhas.length,
      procedimentosJaNoBanco,
      procedimentosNovos: procedimentosNovos.length,
      grupos: tamanhos.length,
      gruposComMaisDeUmLead: tamanhos.filter(t => t > 1).length,
      maiorGrupo: tamanhos.reduce((m, t) => (t > m ? t : m), 0),
    },
  };
}

export class ImportEditaisAbort extends Error {}

export function parseArgsEditais(argv: string[]): { file: string; run: "dry-run" | "apply" } {
  const i = argv.indexOf("--file");
  const file = i >= 0 ? argv[i + 1] : undefined;
  const dry = argv.includes("--dry-run");
  const apply = argv.includes("--apply");
  const conhecidos = new Set(["--file", "--dry-run", "--apply", file]);
  const desconhecidos = argv.filter(a => !conhecidos.has(a));
  if (desconhecidos.length) throw new ImportEditaisAbort(`argumento desconhecido: ${desconhecidos.join(" ")}`);
  if (!file) throw new ImportEditaisAbort("informe --file <caminho.csv>");
  if (dry === apply) throw new ImportEditaisAbort("informe exatamente um entre --dry-run e --apply");
  return { file, run: dry ? "dry-run" : "apply" };
}
