// Mensagem de alerta de falha de servico do PARR (OnFailure do systemd). Pura, sem I/O.
// Nunca leva dados de clientes: so o nome da unidade, o servidor e a hora.

/** Nome de unidade systemd aceito (evita texto arbitrario no e-mail). */
export function unidadeValida(u: string): boolean {
  return /^[A-Za-z0-9@._:-]{1,120}$/.test(u);
}

export function montarAlerta(unidade: string, host: string, agora: Date): { assunto: string; texto: string } {
  if (!unidadeValida(unidade)) throw new Error("nome de unidade invalido");
  const hora = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return {
    assunto: `[PARR] Falha: ${unidade}`,
    texto: [
      `O serviço ${unidade} falhou no servidor ${host} em ${hora} (horário de Brasília).`,
      "",
      "Para ver o motivo, na VPS:",
      "  journalctl --since today --no-pager -u 'parr-*' | tail -80",
      "",
      "Mensagem automática do PARR. Não contém dados de clientes.",
    ].join("\n"),
  };
}
