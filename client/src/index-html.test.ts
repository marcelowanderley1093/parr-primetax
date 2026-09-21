import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Regressao: tradutor do navegador reescreve o DOM sob o React (NotFoundError insertBefore/removeChild).
// O HTML de entrada declara pt-BR e proibe traducao. Le o arquivo-fonte (client/index.html).
const html = readFileSync(path.resolve(import.meta.dirname, "..", "index.html"), "utf-8");
const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";

describe("client/index.html — idioma e traducao", () => {
  it('declara <html lang="pt-BR">', () => {
    expect(htmlTag).toMatch(/\slang="pt-BR"/);
  });

  it('declara translate="no" no <html>', () => {
    expect(htmlTag).toMatch(/\stranslate="no"/);
  });

  it('tem <meta name="google" content="notranslate"> no <head>', () => {
    const head = html.match(/<head\b[\s\S]*?<\/head>/i)?.[0] ?? "";
    expect(head).toMatch(/<meta\s+name="google"\s+content="notranslate"\s*\/?>/i);
  });
});
