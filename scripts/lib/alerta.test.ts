import { describe, expect, it } from "vitest";
import { montarAlerta, unidadeValida } from "./alerta";

describe("montarAlerta", () => {
  it("monta assunto e texto com unidade, servidor e hora de Brasilia, sem dados de clientes", () => {
    const a = montarAlerta("parr-backup-offsite-prod", "parr-primetax", new Date("2026-10-06T04:15:00Z"));
    expect(a.assunto).toBe("[PARR] Falha: parr-backup-offsite-prod");
    expect(a.texto).toContain("parr-backup-offsite-prod falhou no servidor parr-primetax em 06/10/2026, 01:15:00");
    expect(a.texto).toContain("journalctl");
  });

  it("recusa nome de unidade com caracteres fora do padrao", () => {
    expect(unidadeValida("parr-backup-prod")).toBe(true);
    expect(unidadeValida("teste")).toBe(true);
    expect(unidadeValida("x; rm -rf /")).toBe(false);
    expect(unidadeValida("")).toBe(false);
    expect(() => montarAlerta("<script>", "h", new Date())).toThrow();
  });
});
