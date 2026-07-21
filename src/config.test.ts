import { describe, it, expect } from "vitest";
import { buildInitialPrompt } from "./config.js";

describe("buildInitialPrompt", () => {
  it("空なら undefined", () => {
    expect(buildInitialPrompt([])).toBeUndefined();
  });

  it("語彙を読点でつないだ文を作る", () => {
    const out = buildInitialPrompt(["奥村組", "ネクスコ", "生平トンネル"]);
    expect(out).toContain("奥村組、ネクスコ、生平トンネル");
  });

  it("上限を超える語彙は打ち切る", () => {
    const many = Array.from({ length: 100 }, (_, i) => `語彙${i}`);
    const out = buildInitialPrompt(many, 30);
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThan(60); // 接頭辞込みでも短い
  });

  it("上限超過時は先頭側の語から削り、末尾の語を残す", () => {
    // Whisper はプロンプト末尾側を残すため、優先語（末尾）が生き残る必要がある
    const terms = ["先頭語アアアア", "中間語イイイイ", "末尾語ウウウウ"];
    const out = buildInitialPrompt(terms, 16);
    expect(out).toContain("末尾語ウウウウ");
    expect(out).not.toContain("先頭語アアアア");
  });

  it("空白だけの語は除外する", () => {
    expect(buildInitialPrompt(["  ", "根付"])).toBe("次の固有名詞が登場します: 根付。");
  });

  it("1語だけで上限を超える場合も undefined にはしない", () => {
    const out = buildInitialPrompt(["あ".repeat(300)], 150);
    expect(out).toBeDefined();
  });
});
