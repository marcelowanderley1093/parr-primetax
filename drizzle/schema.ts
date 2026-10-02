import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, bigint, json, index, uniqueIndex, date } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "comercial"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const leadStatusEnum = mysqlEnum("status", [
  "novo_lead",
  "contato_inicial",
  "reuniao_agendada",
  "proposta_enviada",
]);

export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  nome: varchar("nome", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  telefone: varchar("telefone", { length: 30 }).notNull(),
  cnpj: varchar("cnpj", { length: 20 }),
  devedorPrincipal: varchar("devedorPrincipal", { length: 255 }),
  valorDivida: varchar("valorDivida", { length: 50 }),
  mensagem: text("mensagem"),
  lgpdConsent: int("lgpdConsent").notNull().default(0),
  status: mysqlEnum("status", [
    "novo_lead",
    "contato_inicial",
    "reuniao_agendada",
    "proposta_enviada",
  ]).notNull().default("novo_lead"),
  pipedrivePersonId: varchar("pipedrivePersonId", { length: 50 }),
  pipedriveDealId: varchar("pipedriveDealId", { length: 50 }),
  telefoneSocios: text("telefoneSocios"),
  calendarEventId: varchar("calendarEventId", { length: 255 }),
  importBatchId: int("importBatchId"),
  // Empresa (CNPJ) do edital; aponta para empresas.id (sem FK, como o resto do schema).
  empresaId: int("empresaId"),
  // CPF completo do socio intimado, so digitos. Vem de pesquisa manual (nem edital nem EmpresAqui trazem).
  cpf: varchar("cpf", { length: 11 }),
  // --- Base de editais PGFN (lead = par pessoa + empresa; procedimentos em lead_procedimentos) ---
  // CPF como publicado no edital ("***.432.***-**"; contribuinte PJ vem com CNPJ). Junto com o nome, identifica a pessoa.
  cpfParcial: varchar("cpfParcial", { length: 20 }),
  // Grupo de distribuicao: leads que compartilham pessoa ou empresa vao sempre para o mesmo parceiro.
  grupoId: int("grupoId"),
  // Publicacao do edital mais antigo e do mais recente do lead (prazo de impugnacao = ultima + 30 dias corridos).
  primeiraPublicacao: date("primeiraPublicacao", { mode: "string" }),
  ultimaPublicacao: date("ultimaPublicacao", { mode: "string" }),
  // --- Carteira (Fase B): dono do lead = local_users.id (existe desde o convite, antes do 1o login) ---
  responsavelId: int("responsavelId"),
  atribuidoEm: timestamp("atribuidoEm"),
  arquivadoEm: timestamp("arquivadoEm"),
  arquivadoMotivo: varchar("arquivadoMotivo", { length: 60 }),
  arquivadoPorId: int("arquivadoPorId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, t => [
  index("leads_empresaId_idx").on(t.empresaId),
  index("leads_status_idx").on(t.status),
  index("leads_responsavelId_idx").on(t.responsavelId),
  index("leads_grupoId_idx").on(t.grupoId),
  index("leads_ultimaPublicacao_idx").on(t.ultimaPublicacao),
  index("leads_cnpj_idx").on(t.cnpj),
  index("leads_nome_idx").on(t.nome),
]);

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

export const leadNotes = mysqlTable("lead_notes", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  userId: int("userId"),
  userName: varchar("userName", { length: 255 }),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LeadNote = typeof leadNotes.$inferSelect;
export type InsertLeadNote = typeof leadNotes.$inferInsert;

export const leadStatusHistory = mysqlTable("lead_status_history", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  fromStatus: varchar("fromStatus", { length: 50 }),
  toStatus: varchar("toStatus", { length: 50 }).notNull(),
  userId: int("userId"),
  userName: varchar("userName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LeadStatusHistory = typeof leadStatusHistory.$inferSelect;
export type InsertLeadStatusHistory = typeof leadStatusHistory.$inferInsert;

export const siteSettings = mysqlTable("site_settings", {
  id: int("id").autoincrement().primaryKey(),
  settingKey: varchar("settingKey", { length: 100 }).notNull().unique(),
  settingValue: text("settingValue"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SiteSetting = typeof siteSettings.$inferSelect;
export type InsertSiteSetting = typeof siteSettings.$inferInsert;

export const leadImports = mysqlTable("lead_imports", {
  id: int("id").autoincrement().primaryKey(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  sheetName: varchar("sheetName", { length: 255 }),
  leadsCount: int("leadsCount").notNull().default(0),
  importedBy: varchar("importedBy", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LeadImport = typeof leadImports.$inferSelect;
export type InsertLeadImport = typeof leadImports.$inferInsert;

// Local users created by admin (email/password login)
export const localUsers = mysqlTable("local_users", {
  id: int("id").autoincrement().primaryKey(),
  nome: varchar("nome", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: mysqlEnum("role", ["comercial", "admin"]).default("comercial").notNull(),
  active: int("active").notNull().default(0),
  mustChangePassword: int("mustChangePassword").notNull().default(1),
  activationToken: varchar("activationToken", { length: 255 }),
  activationTokenExpiry: timestamp("activationTokenExpiry"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
});

export type LocalUser = typeof localUsers.$inferSelect;
export type InsertLocalUser = typeof localUsers.$inferInsert;

// Empresa (CNPJ) enriquecida pela EmpresAqui. Uma linha por CNPJ; varios leads podem apontar para ela.
// EmpresAqui sobrescreve tudo aqui (dado oficial do CNPJ, inclusive telefone, que costuma ser do contador);
// o contato do socio intimado fica em lead_contatos e nunca e tocado pela integracao.
// Colunas soltas = so o que filtra/ordena no Kanban; o restante vive em `dados` (normalizado, fusao CSV + API)
// e o original de cada fonte em `brutoCsv` / `brutoApi`.
export const empresas = mysqlTable("empresas", {
  id: int("id").autoincrement().primaryKey(),
  cnpj: varchar("cnpj", { length: 14 }).notNull().unique(),
  razaoSocial: varchar("razaoSocial", { length: 255 }),
  nomeFantasia: varchar("nomeFantasia", { length: 255 }),
  situacaoCadastral: varchar("situacaoCadastral", { length: 20 }),
  regimeTributario: varchar("regimeTributario", { length: 60 }),
  porte: varchar("porte", { length: 40 }),
  cnaePrincipal: varchar("cnaePrincipal", { length: 7 }),
  uf: varchar("uf", { length: 2 }),
  municipio: varchar("municipio", { length: 120 }),
  totalDividasCentavos: bigint("totalDividasCentavos", { mode: "number" }),
  qtdInscricoes: int("qtdInscricoes"),
  dados: json("dados"),
  brutoCsv: json("brutoCsv"),
  brutoApi: json("brutoApi"),
  csvAtualizadoEm: timestamp("csvAtualizadoEm"),
  apiAtualizadoEm: timestamp("apiAtualizadoEm"),
  // Sincronizacao pela API: null = nunca pedida.
  syncStatus: mysqlEnum("syncStatus", ["pendente", "ok", "nao_encontrado", "erro"]),
  syncErro: varchar("syncErro", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, t => [index("empresas_syncStatus_idx").on(t.syncStatus)]);

export type Empresa = typeof empresas.$inferSelect;
export type InsertEmpresa = typeof empresas.$inferInsert;

// Contatos editaveis pelo comercial: uma linha por telefone ou e-mail. Substitui leads.telefoneSocios
// (JSON somente leitura). pessoaNome/pessoaCpf identificam de quem e o contato: o socio intimado ou
// outro socio da mesma empresa. atualizadoPorUserId aponta para users.id (como lead_notes.userId).
export const leadContatos = mysqlTable("lead_contatos", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  pessoaNome: varchar("pessoaNome", { length: 255 }),
  pessoaCpf: varchar("pessoaCpf", { length: 11 }),
  tipo: mysqlEnum("tipo", ["telefone", "email"]).notNull(),
  valor: varchar("valor", { length: 320 }).notNull(),
  origem: mysqlEnum("origem", ["edital", "manual", "empresaqui", "base_anterior"]).notNull(),
  status: mysqlEnum("status", ["nao_testado", "atende", "whatsapp", "numero_errado", "nao_e_o_socio"])
    .notNull()
    .default("nao_testado"),
  observacao: text("observacao"),
  atualizadoPorUserId: int("atualizadoPorUserId"),
  atualizadoPorNome: varchar("atualizadoPorNome", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, t => [index("lead_contatos_leadId_idx").on(t.leadId)]);

export type LeadContato = typeof leadContatos.$inferSelect;
export type InsertLeadContato = typeof leadContatos.$inferInsert;

// Uma linha por chamada paga a uma API externa (hoje so EmpresAqui), para o "consumo do mes" em
// Configuracoes > Integracoes. A API nao informa saldo: a contagem e local.
export const integracaoConsultas = mysqlTable("integracao_consultas", {
  id: int("id").autoincrement().primaryKey(),
  integracao: varchar("integracao", { length: 40 }).notNull(),
  cnpj: varchar("cnpj", { length: 14 }),
  resultado: mysqlEnum("resultado", ["ok", "nao_encontrado", "erro", "limite"]).notNull(),
  httpStatus: int("httpStatus"),
  userId: int("userId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => [index("integracao_consultas_integracao_createdAt_idx").on(t.integracao, t.createdAt)]);

export type IntegracaoConsulta = typeof integracaoConsultas.$inferSelect;
export type InsertIntegracaoConsulta = typeof integracaoConsultas.$inferInsert;

// Editais PGFN de abertura de Procedimento Administrativo de Reconhecimento de Responsabilidade (PARR).
// Base legal citada nos proprios editais: CTN art. 135, III; Lei 10.522/2002 art. 20-D, III; Portaria PGFN 948/2017.
export const editais = mysqlTable("editais", {
  id: int("id").autoincrement().primaryKey(),
  ano: int("ano").notNull(),
  numero: varchar("numero", { length: 20 }).notNull(),
  dataPublicacao: date("dataPublicacao", { mode: "string" }).notNull(),
  arquivoOrigem: varchar("arquivoOrigem", { length: 255 }),
  qtdRegistros: int("qtdRegistros").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => [uniqueIndex("editais_ano_numero_unique").on(t.ano, t.numero)]);

export type Edital = typeof editais.$inferSelect;
export type InsertEdital = typeof editais.$inferInsert;

// Um procedimento administrativo por linha do edital. O numero do procedimento e unico: chave de idempotencia
// da importacao. Um lead (pessoa + empresa) pode ter varios procedimentos, em editais diferentes.
export const leadProcedimentos = mysqlTable("lead_procedimentos", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId").notNull(),
  editalId: int("editalId").notNull(),
  numeroProcedimento: varchar("numeroProcedimento", { length: 20 }).notNull().unique(),
  cpfParcial: varchar("cpfParcial", { length: 20 }),
  pagina: int("pagina"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, t => [
  index("lead_procedimentos_leadId_idx").on(t.leadId),
  index("lead_procedimentos_editalId_idx").on(t.editalId),
]);

export type LeadProcedimento = typeof leadProcedimentos.$inferSelect;
export type InsertLeadProcedimento = typeof leadProcedimentos.$inferInsert;
