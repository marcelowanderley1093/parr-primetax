import { describe, expect, it } from "vitest";
import { DEFAULT_HOST, DEFAULT_PORT, resolveListenConfig } from "./_core/listenConfig";

describe("resolveListenConfig", () => {
  it("HOST ausente -> 127.0.0.1", () => {
    expect(resolveListenConfig({}).host).toBe(DEFAULT_HOST);
    expect(resolveListenConfig({}).host).toBe("127.0.0.1");
  });

  it("HOST explicito e respeitado (com trim)", () => {
    expect(resolveListenConfig({ HOST: "0.0.0.0" }).host).toBe("0.0.0.0");
    expect(resolveListenConfig({ HOST: "  ::1  " }).host).toBe("::1");
  });

  it("HOST vazio ou so espacos cai no default", () => {
    expect(resolveListenConfig({ HOST: "" }).host).toBe("127.0.0.1");
    expect(resolveListenConfig({ HOST: "   " }).host).toBe("127.0.0.1");
  });

  it("PORT ausente ou vazia -> 3000", () => {
    expect(resolveListenConfig({}).port).toBe(DEFAULT_PORT);
    expect(resolveListenConfig({ PORT: "" }).port).toBe(3000);
  });

  it("PORT numerica e respeitada", () => {
    expect(resolveListenConfig({ PORT: "8080" })).toEqual({ host: "127.0.0.1", port: 8080 });
    expect(resolveListenConfig({ PORT: " 65535 " }).port).toBe(65535);
  });

  it("PORT invalida lanca", () => {
    expect(() => resolveListenConfig({ PORT: "abc" })).toThrow(/PORT invalida/);
    expect(() => resolveListenConfig({ PORT: "30a0" })).toThrow(/PORT invalida/);
    expect(() => resolveListenConfig({ PORT: "0" })).toThrow(/fora do intervalo/);
    expect(() => resolveListenConfig({ PORT: "65536" })).toThrow(/fora do intervalo/);
    expect(() => resolveListenConfig({ PORT: "-1" })).toThrow(/PORT invalida/);
  });
});
