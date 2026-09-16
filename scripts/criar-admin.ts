// Bootstrap idempotente do primeiro admin em local_users.
// Uso (PowerShell):  $env:ADMIN_EMAIL='x@y'; $env:ADMIN_NOME='Nome'; pnpm tsx scripts/criar-admin.ts
// Uso (bash):        ADMIN_EMAIL='x@y' ADMIN_NOME='Nome' pnpm tsx scripts/criar-admin.ts
// Le SOMENTE ADMIN_EMAIL e ADMIN_NOME do ambiente. Gera senha temporaria aleatoria e a imprime UMA vez.
import "dotenv/config";
import * as db from "../server/db";
import { ensureAdmin } from "../server/adminBootstrap";

const email = process.env.ADMIN_EMAIL;
const nome = process.env.ADMIN_NOME;

if (!email || !nome) {
  console.error("PARAR: defina ADMIN_EMAIL e ADMIN_NOME no ambiente (nao como argumento).");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("PARAR: DATABASE_URL nao definida.");
  process.exit(1);
}

try {
  const result = await ensureAdmin(db, { email, nome });
  console.log(
    `PASSOU: local_users #${result.id} (${result.email}) ${result.created ? "criado" : "atualizado"} como admin, active=1, mustChangePassword=1.`
  );
  console.log("Senha temporaria (exibida uma unica vez; troque no primeiro acesso):");
  console.log(result.temporaryPassword);
  process.exit(0);
} catch (error) {
  console.error("PARAR:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
