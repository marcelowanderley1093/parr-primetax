import { trpc } from "@/lib/trpc";
import { Building2, ChevronDown, ChevronRight, Landmark, Mail, Phone, Users } from "lucide-react";
import { useState } from "react";
import { formatarTelefone } from "@shared/contatos";

// Formato de empresas.dados.csv (gravado por server/empresaqui/importacao.ts). Tudo opcional: o JSON
// pode vir de versoes anteriores do importador ou, no futuro, so da API.
type SocioCsv = { identificador: string; nome: string; faixaEtaria: string | null; cpfCnpjMascarado: string | null; qualificacao: string | null; dataEntrada: string | null };
type DadosCsv = Partial<{
  nomeFantasia: string | null;
  endereco: { municipio: string | null; uf: string | null; bairro: string | null };
  telefones: string[];
  email: string | null;
  site: string | null;
  cnaePrincipal: string | null;
  cnaePrincipalDescricao: string | null;
  matriz: boolean | null;
  quantidadeFiliais: number | null;
  dataSituacaoCadastral: string | null;
  naturezaJuridica: string | null;
  dataInicioAtividade: string | null;
  opcaoMei: boolean | null;
  dataOpcaoSimples: string | null;
  dataExclusaoSimples: string | null;
  capitalSocialCentavos: number | null;
  faturamentoEstimado: string | null;
  quadroFuncionarios: string | null;
  historicoRegime: { ano: number; regime: string }[];
  socios: SocioCsv[];
  dividas: { numero: string; valorCentavos: number }[];
}>;

const brl = (centavos: number | null | undefined) =>
  centavos == null ? "—" : (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join("/") : null);
const cnpjFmt = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

const COR_SITUACAO: Record<string, string> = {
  ATIVA: "bg-green-100 text-green-800",
  INAPTA: "bg-amber-100 text-amber-800",
  SUSPENSA: "bg-amber-100 text-amber-800",
  BAIXADA: "bg-muted text-muted-foreground",
  NULA: "bg-muted text-muted-foreground",
};

const DIVIDAS_INICIAIS = 10;

/** Dados oficiais da empresa do lead (EmpresAqui). So leitura; aparece apenas quando ha empresa vinculada. */
export default function EmpresaCard({ leadId }: { leadId: number }) {
  const { data: empresa } = trpc.empresas.doLead.useQuery({ leadId });
  const [verDividas, setVerDividas] = useState(false);
  const [todasDividas, setTodasDividas] = useState(false);
  const [verSocios, setVerSocios] = useState(false);

  if (!empresa) return null;
  const d: DadosCsv = ((empresa.dados as { csv?: DadosCsv } | null)?.csv) ?? {};
  const dividas = [...(d.dividas ?? [])].sort((a, b) => b.valorCentavos - a.valorCentavos);
  const socios = d.socios ?? [];
  const historico = d.historicoRegime ?? [];
  const atualizado = empresa.csvAtualizadoEm ? new Date(empresa.csvAtualizadoEm).toLocaleDateString("pt-BR") : null;

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="mb-4">
        <h2 className="font-bold text-lg flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" /> Dados da empresa
        </h2>
        {atualizado && <div className="text-xs text-muted-foreground mt-0.5">Fonte: EmpresAqui · atualizado em {atualizado}</div>}
      </div>

      <div className="space-y-3 text-sm">
        <div>
          <div className="font-medium">{empresa.razaoSocial}</div>
          {d.nomeFantasia && <div className="text-xs text-muted-foreground">{d.nomeFantasia}</div>}
          <div className="text-xs text-muted-foreground">CNPJ {cnpjFmt(empresa.cnpj)}</div>
        </div>

        {empresa.situacaoCadastral && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${COR_SITUACAO[empresa.situacaoCadastral] ?? "bg-muted"}`}>
              {empresa.situacaoCadastral}
            </span>
            {dataBr(d.dataSituacaoCadastral) && <span className="text-xs text-muted-foreground">desde {dataBr(d.dataSituacaoCadastral)}</span>}
          </div>
        )}

        <div className="text-xs space-y-1">
          {empresa.regimeTributario && (
            <div><span className="text-muted-foreground">Regime:</span> {empresa.regimeTributario}
              {historico.length > 1 && <span className="text-muted-foreground"> ({historico.map(h => `${h.ano}: ${h.regime}`).join(" · ")})</span>}
            </div>
          )}
          {d.naturezaJuridica && <div><span className="text-muted-foreground">Natureza:</span> {d.naturezaJuridica}</div>}
          {d.matriz != null && (
            <div><span className="text-muted-foreground">Estabelecimento:</span> {d.matriz ? `Matriz${d.quantidadeFiliais ? ` · ${d.quantidadeFiliais} filia${d.quantidadeFiliais === 1 ? "l" : "is"}` : ""}` : "Filial"}</div>
          )}
          {empresa.cnaePrincipal && (
            <div><span className="text-muted-foreground">CNAE:</span> {empresa.cnaePrincipal}{d.cnaePrincipalDescricao ? ` · ${d.cnaePrincipalDescricao}` : ""}</div>
          )}
          {(empresa.municipio || empresa.uf) && (
            <div><span className="text-muted-foreground">Local:</span> {[empresa.municipio, empresa.uf].filter(Boolean).join("/")}</div>
          )}
          {dataBr(d.dataInicioAtividade) && <div><span className="text-muted-foreground">Abertura:</span> {dataBr(d.dataInicioAtividade)}</div>}
          {d.capitalSocialCentavos != null && <div><span className="text-muted-foreground">Capital social:</span> {brl(d.capitalSocialCentavos)}</div>}
          {d.faturamentoEstimado && <div><span className="text-muted-foreground">Faturamento estimado:</span> {d.faturamentoEstimado}</div>}
          {d.quadroFuncionarios && <div><span className="text-muted-foreground">Funcionários:</span> {d.quadroFuncionarios}</div>}
          {dataBr(d.dataOpcaoSimples) && (
            <div><span className="text-muted-foreground">Simples:</span> desde {dataBr(d.dataOpcaoSimples)}{dataBr(d.dataExclusaoSimples) ? `, excluída em ${dataBr(d.dataExclusaoSimples)}` : ""}</div>
          )}
        </div>

        {((d.telefones?.length ?? 0) > 0 || d.email) && (
          <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1">
            <div className="text-muted-foreground">Contato cadastral da empresa (geralmente o contador)</div>
            {d.telefones?.map(t => (
              <div key={t} className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {formatarTelefone(t)}</div>
            ))}
            {d.email && <div className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> {d.email}</div>}
          </div>
        )}

        <div>
          <button className="w-full flex items-center justify-between text-left" onClick={() => setVerDividas(v => !v)}>
            <span className="flex items-center gap-1.5 font-medium">
              <Landmark className="h-4 w-4 text-muted-foreground" /> Dívidas federais ativas
            </span>
            <span className="flex items-center gap-1 text-sm font-semibold text-[oklch(0.62_0.12_185)]">
              {brl(empresa.totalDividasCentavos)}
              {dividas.length > 0 && (verDividas ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
            </span>
          </button>
          <div className="text-xs text-muted-foreground">{empresa.qtdInscricoes ?? 0} inscriç{empresa.qtdInscricoes === 1 ? "ão" : "ões"}</div>
          {verDividas && dividas.length > 0 && (
            <ul className="mt-2 text-xs space-y-0.5">
              {(todasDividas ? dividas : dividas.slice(0, DIVIDAS_INICIAIS)).map((dv, i) => (
                <li key={`${dv.numero}-${i}`} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Inscrição {dv.numero}</span>
                  <span>{brl(dv.valorCentavos)}</span>
                </li>
              ))}
              {dividas.length > DIVIDAS_INICIAIS && (
                <li>
                  <button className="text-primary hover:underline mt-1" onClick={() => setTodasDividas(v => !v)}>
                    {todasDividas ? "mostrar só as maiores" : `ver todas as ${dividas.length}`}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        {socios.length > 0 && (
          <div>
            <button className="w-full flex items-center justify-between text-left" onClick={() => setVerSocios(v => !v)}>
              <span className="flex items-center gap-1.5 font-medium"><Users className="h-4 w-4 text-muted-foreground" /> Sócios no CNPJ</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {socios.length} {verSocios ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </span>
            </button>
            {verSocios && (
              <ul className="mt-2 space-y-2 text-xs">
                {socios.map((s, i) => (
                  <li key={`${s.nome}-${i}`} className="border-l-2 border-primary/20 pl-2">
                    <div className="font-medium">{s.nome}</div>
                    <div className="text-muted-foreground">
                      {[s.qualificacao, s.dataEntrada ? `desde ${dataBr(s.dataEntrada)}` : null, s.faixaEtaria, s.cpfCnpjMascarado].filter(Boolean).join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
