// Envia o e-mail de alerta quando um servico do PARR falha. Chamado pelo systemd (parr-alerta@.service, via
// OnFailure= das unidades de backup). Usa o SMTP ja configurado do PARR (SMTP_* do env de producao) e manda para
// ALERTA_EMAIL. Nunca imprime credenciais.
//
// Uso: pnpm tsx scripts/alerta-falha.ts <unidade>      (teste: pnpm tsx scripts/alerta-falha.ts teste)
import "dotenv/config";
import { hostname } from "node:os";
import { getTransporter, isSmtpConfigured } from "../server/_core/notification";
import { ENV } from "../server/_core/env";
import { montarAlerta } from "./lib/alerta";

async function main(): Promise<number> {
  const unidade = process.argv[2] ?? "";
  const destino = process.env.ALERTA_EMAIL ?? "";
  if (!destino) {
    console.error("PARAR: ALERTA_EMAIL nao definida no ambiente");
    return 1;
  }
  if (!isSmtpConfigured()) {
    console.error("PARAR: SMTP nao configurado no ambiente");
    return 1;
  }
  const { assunto, texto } = montarAlerta(unidade, hostname(), new Date());
  try {
    await getTransporter().sendMail({ from: ENV.smtp.from, to: destino, subject: assunto, text: texto });
  } catch (e) {
    console.error(`PARAR: envio do alerta falhou (${(e as Error).name})`);
    return 1;
  }
  console.log("PASSOU: alerta enviado");
  return 0;
}

main().then(code => process.exit(code));
