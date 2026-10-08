import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  agruparContatos, cpfValido, emailValido, formatarCpf, formatarTelefone, linkWhatsapp, mascararCpf, mesmoNome,
  normalizarTelefone, type StatusContato,
} from "../shared/contatos";

// Dados 100% sinteticos. Sem DATABASE_URL: getDb() devolve null, entao uma chamada que passa da validacao
// cai em "Lead não encontrado" / "Database not available" — e isso que distingue validacao ok de rejeitada.

function ctx(logado: boolean): TrpcContext {
  return {
    user: logado
      ? { id: 1, openId: "local-1", email: "comercial@exemplo.test", name: "Comercial Teste", loginMethod: "local", role: "comercial", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }
      : null,
    req: { protocol: "https", headers: {}, get: () => "localhost:3000" } as any,
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("normalizarTelefone", () => {
  it("aceita fixo e celular com DDD, com ou sem mascara e DDI 55", () => {
    expect(normalizarTelefone("(11) 91234-5678")).toBe("11912345678");
    expect(normalizarTelefone("11 3000-0000")).toBe("1130000000");
    expect(normalizarTelefone("+55 (21) 98765-4321")).toBe("21987654321");
    expect(normalizarTelefone("552130000000")).toBe("2130000000");
  });

  it("rejeita sem DDD, DDD invalido, celular de 11 digitos sem 9 e lixo", () => {
    expect(normalizarTelefone("91234-5678")).toBeNull();
    expect(normalizarTelefone("(01) 3000-0000")).toBeNull();
    expect(normalizarTelefone("(10) 3000-0000")).toBeNull();
    expect(normalizarTelefone("11812345678")).toBeNull();
    expect(normalizarTelefone("abc")).toBeNull();
    expect(normalizarTelefone("")).toBeNull();
  });

  it("formata e monta link do WhatsApp com DDI", () => {
    expect(formatarTelefone("11912345678")).toBe("(11) 91234-5678");
    expect(formatarTelefone("1130000000")).toBe("(11) 3000-0000");
    expect(formatarTelefone("30000000")).toBe("30000000"); // legado sem DDD: mostra como veio
    expect(linkWhatsapp("11912345678")).toBe("https://wa.me/5511912345678");
  });
});

describe("CPF", () => {
  it("digito verificador", () => {
    expect(cpfValido("123.456.789-09")).toBe(true);
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("123.456.789-00")).toBe(false);
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("1234567890")).toBe(false);
    expect(cpfValido("")).toBe(false);
  });

  it("formata e mascara", () => {
    expect(formatarCpf("12345678909")).toBe("123.456.789-09");
    expect(mascararCpf("12345678909")).toBe("***.456.789-**");
    expect(mascararCpf("123")).toBe("***");
  });
});

describe("emailValido e mesmoNome", () => {
  it("e-mail", () => {
    expect(emailValido("a@b.com")).toBe(true);
    expect(emailValido("sem-arroba.com")).toBe(false);
    expect(emailValido("a@b")).toBe(false);
  });

  it("nome sem acento, caixa e espacos", () => {
    expect(mesmoNome("José  da Silva", "JOSE DA SILVA")).toBe(true);
    expect(mesmoNome("JOSE", "JOSE DA SILVA")).toBe(false);
    expect(mesmoNome(null, "X")).toBe(false);
  });
});

describe("agruparContatos", () => {
  const c = (id: number, pessoaNome: string | null, status: StatusContato = "nao_testado", pessoaCpf: string | null = null) =>
    ({ id, pessoaNome, pessoaCpf, status });

  it("intimado primeiro; descartados no fim de cada pessoa", () => {
    const grupos = agruparContatos(
      [c(1, "MARIA SOUZA"), c(2, "JOSE DA SILVA", "numero_errado"), c(3, "JOSE DA SILVA", "atende"), c(4, "JOSE DA SILVA")],
      "José da Silva",
    );
    expect(grupos.map(g => [g.pessoaNome, g.intimado])).toEqual([["JOSE DA SILVA", true], ["MARIA SOUZA", false]]);
    expect(grupos[0].contatos.map(x => x.id)).toEqual([3, 4, 2]);
  });

  it("mesmo nome com CPFs diferentes sao pessoas diferentes; sem nome vira grupo proprio", () => {
    const grupos = agruparContatos([c(1, "ANA", "nao_testado", "111"), c(2, "ANA", "nao_testado", "222"), c(3, null)], "X");
    expect(grupos).toHaveLength(3);
  });
});

describe("contatos (router)", () => {
  it("exige login", async () => {
    const caller = appRouter.createCaller(ctx(false));
    await expect(caller.contatos.list({ leadId: 1 })).rejects.toThrow(/login|UNAUTHORIZED|10001/i);
    await expect(caller.contatos.create({ leadId: 1, tipo: "telefone", valor: "11912345678" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("comercial passa da autorizacao (nao e so admin)", async () => {
    const caller = appRouter.createCaller(ctx(true));
    await expect(caller.contatos.create({ leadId: 1, tipo: "telefone", valor: "(11) 91234-5678" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Lead não encontrado",
    });
  });

  it("rejeita telefone e e-mail invalidos antes de tocar no banco, com mensagem para o usuario", async () => {
    const caller = appRouter.createCaller(ctx(true));
    await expect(caller.contatos.create({ leadId: 1, tipo: "telefone", valor: "91234-5678" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/Telefone inválido/),
    });
    await expect(caller.contatos.create({ leadId: 1, tipo: "email", valor: "sem-arroba" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "E-mail inválido",
    });
  });

  it("rejeita CPF da pessoa com digito errado; aceita valido", async () => {
    const caller = appRouter.createCaller(ctx(true));
    await expect(
      caller.contatos.create({ leadId: 1, tipo: "telefone", valor: "11912345678", pessoaCpf: "123.456.789-00" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.contatos.create({ leadId: 1, tipo: "telefone", valor: "11912345678", pessoaCpf: "123.456.789-09" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("update rejeita status fora da lista", async () => {
    const caller = appRouter.createCaller(ctx(true));
    await expect(caller.contatos.update({ id: 1, status: "ocupado" as StatusContato })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.contatos.update({ id: 1, status: "atende" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("leads.update com CPF", () => {
  it("rejeita CPF com digito errado", async () => {
    const caller = appRouter.createCaller(ctx(true));
    await expect(caller.leads.update({ id: 1, cpf: "123.456.789-00" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("aceita CPF valido e CPF vazio (limpar): passa da validacao e chega ao banco (admin)", async () => {
    const caller = appRouter.createCaller({ ...ctx(true), user: { ...ctx(true).user!, role: "admin" } });
    await expect(caller.leads.update({ id: 1, cpf: "123.456.789-09" })).rejects.toThrow("Database not available");
    await expect(caller.leads.update({ id: 1, cpf: "" })).rejects.toThrow("Database not available");
  });
});

describe("leads.update com e-mail e telefone vazios (lead dos editais)", () => {
  const admin = () => appRouter.createCaller({ ...ctx(true), user: { ...ctx(true).user!, role: "admin" } });

  it("aceita e-mail e telefone vazios junto com o CPF: passa da validacao e chega ao banco", async () => {
    await expect(admin().leads.update({ id: 1, nome: "Fulano de Teste", email: "", telefone: "", cpf: "123.456.789-09" }))
      .rejects.toThrow("Database not available");
  });

  it("aceita e-mail e telefone validos", async () => {
    await expect(admin().leads.update({ id: 1, email: "contato@exemplo.test", telefone: "11999990000" }))
      .rejects.toThrow("Database not available");
  });

  it("rejeita e-mail preenchido invalido e telefone curto", async () => {
    await expect(admin().leads.update({ id: 1, email: "sem-arroba" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().leads.update({ id: 1, telefone: "1234" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
