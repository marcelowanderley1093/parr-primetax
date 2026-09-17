export const JWT_SECRET_MIN_LENGTH = 32;

export type BootProblem = { variable: string; problem: string };

/**
 * Valida a configuracao essencial de boot. Pura: recebe o objeto de env.
 * Nunca inclui valores de variaveis nas mensagens, so os nomes.
 */
export function validateBootEnv(env: Record<string, string | undefined>): BootProblem[] {
  const problems: BootProblem[] = [];

  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  if (databaseUrl === "") {
    problems.push({ variable: "DATABASE_URL", problem: "ausente ou vazia" });
  }

  const jwtSecret = env.JWT_SECRET ?? "";
  if (jwtSecret.trim() === "") {
    problems.push({ variable: "JWT_SECRET", problem: "ausente ou vazio" });
  } else if (jwtSecret.length < JWT_SECRET_MIN_LENGTH) {
    problems.push({
      variable: "JWT_SECRET",
      problem: `menos de ${JWT_SECRET_MIN_LENGTH} caracteres`,
    });
  }

  return problems;
}

export function formatBootProblems(problems: BootProblem[]): string {
  return problems.map(p => `${p.variable}: ${p.problem}`).join("; ");
}
