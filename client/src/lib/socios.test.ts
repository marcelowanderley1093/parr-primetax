import { describe, expect, it } from "vitest";
import { parseSocios, whatsappDigits } from "./socios";

const json = (v: unknown) => JSON.stringify(v);

describe("parseSocios", () => {
  it("JSON invalido -> []", () => {
    expect(parseSocios("{nao é json")).toEqual([]);
    expect(parseSocios("")).toEqual([]);
    expect(parseSocios(null)).toEqual([]);
    expect(parseSocios(undefined)).toEqual([]);
  });

  it("nao-array -> []", () => {
    expect(parseSocios(json({ nome: "Fulano", telefones: ["(11) 98765-4321"] }))).toEqual([]);
    expect(parseSocios(json("texto"))).toEqual([]);
    expect(parseSocios(json(42))).toEqual([]);
  });

  it("array vazio -> []", () => {
    expect(parseSocios("[]")).toEqual([]);
  });

  it("nome que na verdade e telefone e descartado", () => {
    expect(parseSocios(json([{ nome: "(11) 98765-4321", telefones: ["(11) 98765-4321"] }]))).toEqual([]);
  });

  it("nome que e CPF sem formatacao e descartado", () => {
    expect(parseSocios(json([{ nome: "12345678901", telefones: ["(11) 98765-4321"] }]))).toEqual([]);
    expect(parseSocios(json([{ nome: "123.456.789-01", telefones: ["(11) 98765-4321"] }]))).toEqual([]);
  });

  it("nome com menos de 3 caracteres e descartado", () => {
    expect(parseSocios(json([{ nome: "Jo", telefones: ["(11) 98765-4321"] }]))).toEqual([]);
    expect(parseSocios(json([{ nome: "  A ", telefones: ["(11) 98765-4321"] }]))).toEqual([]);
  });

  it("CPF formatado e aceito", () => {
    const r = parseSocios(json([{ nome: "Maria Silva", cpf: "123.456.789-01", telefones: [] }]));
    expect(r).toEqual([{ nome: "Maria Silva", cpf: "123.456.789-01", telefones: [] }]);
  });

  it("CPF de 11 digitos e aceito", () => {
    const r = parseSocios(json([{ nome: "Maria Silva", cpf: "12345678901", telefones: [] }]));
    expect(r).toEqual([{ nome: "Maria Silva", cpf: "12345678901", telefones: [] }]);
  });

  it("CPF invalido e zerado sem descartar o socio que tem telefone", () => {
    const r = parseSocios(json([{ nome: "Carlos Souza", cpf: "123", telefones: ["(21) 3333-4444"] }]));
    expect(r).toEqual([{ nome: "Carlos Souza", cpf: "", telefones: ["(21) 3333-4444"] }]);
  });

  it("telefone com letras e rejeitado", () => {
    const r = parseSocios(json([{ nome: "Carlos Souza", cpf: "123.456.789-01", telefones: ["(11) 9ABCD-4321", "(11) 98765-4321"] }]));
    expect(r[0].telefones).toEqual(["(11) 98765-4321"]);
  });

  it("telefone sem parentese inicial e rejeitado", () => {
    const r = parseSocios(json([{ nome: "Carlos Souza", cpf: "123.456.789-01", telefones: ["11 98765-4321", "98765-4321"] }]));
    expect(r[0].telefones).toEqual([]);
  });

  it("socio sem telefone valido e sem CPF e descartado", () => {
    expect(parseSocios(json([{ nome: "Sem Contato", cpf: "abc", telefones: ["11 98765-4321"] }]))).toEqual([]);
    expect(parseSocios(json([{ nome: "Sem Nada" }]))).toEqual([]);
  });

  it("caso feliz: dois socios, multiplos telefones, entradas invalidas filtradas", () => {
    const raw = json([
      { nome: "Ana Paula Ribeiro", cpf: "111.222.333-44", telefones: ["(11) 98765-4321", "(11) 3333-2222", "sem-parentese"] },
      { nome: "(11) 91234-5678", telefones: ["(11) 91234-5678"] },
      { nome: "Bruno Lima", cpf: "999", telefones: ["(21) 99999-8888"] },
      { nome: "Fantasma", telefones: [] },
      "lixo",
      null,
    ]);
    expect(parseSocios(raw)).toEqual([
      { nome: "Ana Paula Ribeiro", cpf: "111.222.333-44", telefones: ["(11) 98765-4321", "(11) 3333-2222"] },
      { nome: "Bruno Lima", cpf: "", telefones: ["(21) 99999-8888"] },
    ]);
  });
});

describe("whatsappDigits", () => {
  it("prefixa 55 e remove formatacao", () => {
    expect(whatsappDigits("(11) 98765-4321")).toBe("5511987654321");
  });
});
