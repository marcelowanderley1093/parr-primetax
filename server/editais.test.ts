import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { hojeIso, prazoImpugnacao, situacaoPrazo } from "../shared/editais";
import { condicaoBusca } from "./db";

describe("prazoImpugnacao (publicacao + 30 dias corridos)", () => {
  it("soma 30 dias, inclusive virando mes e ano", () => {
    expect(prazoImpugnacao("2025-12-18")).toBe("2026-01-17");
    expect(prazoImpugnacao("2026-01-31")).toBe("2026-03-02");
    expect(prazoImpugnacao("2028-02-01")).toBe("2028-03-02"); // 2028 e bissexto
  });

  it("data invalida -> null", () => {
    expect(prazoImpugnacao("18/12/2025")).toBeNull();
    expect(prazoImpugnacao("")).toBeNull();
  });
});

describe("situacaoPrazo", () => {
  it("aberto, atencao, critico, vence hoje e encerrado", () => {
    expect(situacaoPrazo("2025-12-18", "2025-12-20")).toMatchObject({ prazo: "2026-01-17", dias: 28, nivel: "aberto" });
    expect(situacaoPrazo("2025-12-18", "2026-01-07")).toMatchObject({ dias: 10, nivel: "atencao" });
    expect(situacaoPrazo("2025-12-18", "2026-01-14")).toMatchObject({ dias: 3, nivel: "critico", rotulo: "Impugnação até 17/01/2026 · faltam 3 dias" });
    expect(situacaoPrazo("2025-12-18", "2026-01-16")?.rotulo).toMatch(/falta 1 dia$/);
    expect(situacaoPrazo("2025-12-18", "2026-01-17")?.rotulo).toMatch(/vence hoje$/);
    expect(situacaoPrazo("2025-12-18", "2026-01-18")).toMatchObject({ dias: -1, nivel: "encerrado", rotulo: "Prazo encerrado em 17/01/2026" });
  });

  it("sem publicacao ou com data ruim -> null", () => {
    expect(situacaoPrazo(null, "2026-01-01")).toBeNull();
    expect(situacaoPrazo("2025-12-18", "ontem")).toBeNull();
  });

  it("hojeIso usa a data local", () => {
    expect(hojeIso(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("condicaoBusca", () => {
  const dialect = new MySqlDialect();
  const q = (b: string | undefined) => {
    const c = condicaoBusca(b);
    return c ? dialect.sqlToQuery(c) : undefined;
  };

  it("vazio -> sem condicao", () => {
    expect(q(undefined)).toBeUndefined();
    expect(q("   ")).toBeUndefined();
  });

  it("numero (6+ digitos, sem letras) busca prefixo do CNPJ ou procedimento exato", () => {
    const r = q("12.345.678")!;
    expect(r.sql).toMatch(/REPLACE\(REPLACE\(REPLACE/);
    expect(r.sql).toMatch(/lead_procedimentos/);
    expect(r.params).toEqual(["12345678%", "12345678"]);
  });

  it("texto busca trecho de nome, empresa e e-mail, escapando % e _", () => {
    const r = q("ab%c_d")!;
    expect(r.sql).not.toMatch(/lead_procedimentos/);
    expect(r.params).toEqual(["%ab\\%c\\_d%", "%ab\\%c\\_d%", "%ab\\%c\\_d%"]);
  });

  it("numero curto ou com letras vira busca de texto", () => {
    expect(q("12345")!.sql).not.toMatch(/lead_procedimentos/);
    expect(q("loja 123456")!.sql).not.toMatch(/lead_procedimentos/);
  });
});
