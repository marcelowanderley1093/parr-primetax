import { describe, expect, it } from "vitest";
import { diaDoEvento, eventoDoGoogle, horaDoEvento } from "@shared/agenda";

describe("eventoDoGoogle", () => {
  it("evento com horario: mantem dateTime e nao e dia inteiro", () => {
    const ev = eventoDoGoogle({
      id: "a1",
      summary: "Reunião teste",
      start: { dateTime: "2026-10-06T14:00:00-03:00" },
      end: { dateTime: "2026-10-06T15:00:00-03:00" },
    });
    expect(ev).toEqual({
      id: "a1",
      title: "Reunião teste",
      start: "2026-10-06T14:00:00-03:00",
      end: "2026-10-06T15:00:00-03:00",
      description: "",
      diaInteiro: false,
    });
  });

  it("evento de dia inteiro: so data, marcado como dia inteiro", () => {
    const ev = eventoDoGoogle({ id: "b1", summary: "Férias", start: { date: "2026-10-05" }, end: { date: "2026-10-06" } });
    expect(ev?.diaInteiro).toBe(true);
    expect(ev?.start).toBe("2026-10-05");
  });

  it("local de trabalho (workingLocation) fica fora", () => {
    const ev = eventoDoGoogle({ id: "c1", summary: "Escritório", eventType: "workingLocation", start: { date: "2026-10-05" } });
    expect(ev).toBeNull();
  });

  it("evento comum (eventType default) entra; sem titulo vira 'Sem título'", () => {
    const ev = eventoDoGoogle({ id: "d1", eventType: "default", start: { dateTime: "2026-10-06T14:00:00-03:00" } });
    expect(ev?.title).toBe("Sem título");
  });
});

describe("diaDoEvento", () => {
  it("data sem hora e lida pelos digitos (nao vira o dia anterior em Brasilia)", () => {
    expect(diaDoEvento("2026-10-05")).toEqual({ ano: 2026, mes: 9, dia: 5 });
    expect(diaDoEvento("2026-01-01")).toEqual({ ano: 2026, mes: 0, dia: 1 });
  });

  it("data com hora usa o dia local", () => {
    expect(diaDoEvento("2026-10-05T12:00:00Z")).toEqual({ ano: 2026, mes: 9, dia: 5 });
  });

  it("vazio ou invalido devolve null", () => {
    expect(diaDoEvento("")).toBeNull();
    expect(diaDoEvento("xyz")).toBeNull();
  });
});

describe("horaDoEvento", () => {
  it("dia inteiro nao mostra hora", () => {
    expect(horaDoEvento({ start: "2026-10-05", diaInteiro: true })).toBe("");
    expect(horaDoEvento({ start: "2026-10-05" })).toBe("");
  });

  it("evento com horario mostra HH:MM", () => {
    expect(horaDoEvento({ start: "2026-10-05T12:00:00Z", diaInteiro: false })).toMatch(/^\d{2}:\d{2}$/);
  });

  it("sem inicio nao mostra hora", () => {
    expect(horaDoEvento({ start: "" })).toBe("");
  });
});
