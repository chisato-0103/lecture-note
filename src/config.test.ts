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
});
