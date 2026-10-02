// Converte a aba "Consolidado PARR" da planilha de editais PGFN (extraida dos PDFs) em CSV UTF-8 com ";".
// Roda na maquina LOCAL (ler o xlsx de ~50 MB consome ~1,5 GB de memoria; a VPS recebe so o CSV).
// Nunca imprime valores de linha: so contagens. Entrada e saida ficam em data/ (fora do Git).
//
// Uso: pnpm tsx scripts/converter-editais.ts <planilha.xlsx> <saida.csv>
import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { CABECALHO_CSV_EDITAIS, COLUNAS_PLANILHA_EDITAIS, linhaCsv } from "./lib/importEditais";

const ABA = "Consolidado PARR";

function main(): number {
  const [entrada, saida] = process.argv.slice(2);
  if (!entrada || !saida) {
    console.error("PARAR: uso: pnpm tsx scripts/converter-editais.ts <planilha.xlsx> <saida.csv>");
    return 1;
  }
  const wb = XLSX.read(readFileSync(entrada), { type: "buffer", dense: true, sheets: [ABA] });
  const ws = wb.Sheets[ABA];
  if (!ws) {
    console.error(`PARAR: aba "${ABA}" nao encontrada`);
    return 1;
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  const cab = (rows[0] ?? []).map(v => String(v).trim());
  const esperado = [...COLUNAS_PLANILHA_EDITAIS];
  if (cab.length < esperado.length || esperado.some((c, i) => cab[i] !== c)) {
    console.error(`PARAR: cabecalho diferente do esperado (${esperado.length} colunas: ${esperado.join(" | ")})`);
    return 1;
  }
  const linhas = [CABECALHO_CSV_EDITAIS.join(";")];
  let vazias = 0;
  for (const r of rows.slice(1)) {
    const valores = esperado.map((_, i) => String(r[i] ?? "").replace(/\s+/g, " ").trim());
    if (valores.every(v => v === "")) {
      vazias++;
      continue;
    }
    linhas.push(linhaCsv(valores));
  }
  writeFileSync(saida, linhas.join("\n") + "\n", "utf-8");
  console.log(`linhas convertidas: ${linhas.length - 1} · linhas vazias ignoradas: ${vazias}`);
  console.log("PASSOU");
  return 0;
}

process.exit(main());
