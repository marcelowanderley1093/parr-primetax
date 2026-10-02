import { describe, expect, it } from "vitest";
import { appRouter, validarLinhasImportacao } from "./routers";
import type { TrpcContext } from "./_core/context";

// Dados 100% sinteticos.
const admin = (): TrpcContext => ({
  user: { id: 1, openId: "local-1", email: "a@exemplo.test", name: "Admin", loginMethod: "local", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  req: { protocol: "https", headers: {}, get: () => "x" } as any,
  res: { clearCookie: () => {} } as any,
});

describe("validarLinhasImportacao", () => {
  it("linhas validas -> sem problemas", () => {
    expect(validarLinhasImportacao([{ nome: "FULANO DE TAL", cnpj: "12.345.678/0001-95" }])).toEqual([]);
  });

  it("aponta linha e campo, sem o conteudo (o caso do arquivo EmpresAqui: lista de socios no nome)", () => {
    const listaDeSocios = "SOCIO UM-SOCIO DOIS-".repeat(20);
    const r = validarLinhasImportacao([{ nome: "OK" }, { nome: listaDeSocios }, { nome: "" }, { nome: "X", telefone: "9".repeat(31) }]);
    expect(r).toEqual(["linha 3: nome com mais de 255 caracteres", "linha 4: nome vazio", "linha 5: telefone com mais de 30 caracteres"]);
    expect(r.join()).not.toMatch(/SOCIO/);
  });
});

describe("leads.importExcel", () => {
  it("recusa a planilha inteira antes de gravar quando ha linha invalida", async () => {
    await expect(
      appRouter.createCaller(admin()).leads.importExcel({ leads: [{ nome: "OK" }, { nome: "N".repeat(300) }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/nada foi gravado.*linha 3: nome/) });
  });

  it("recusa mais de 5.000 linhas (bases grandes vao pelo script de carga)", async () => {
    const muitas = Array.from({ length: 5001 }, () => ({ nome: "FULANO" }));
    await expect(appRouter.createCaller(admin()).leads.importExcel({ leads: muitas })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
