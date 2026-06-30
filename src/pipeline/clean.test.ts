import { describe, it, expect } from "vitest";
import { removeHallucinationLoops } from "./clean.js";

describe("removeHallucinationLoops", () => {
  it("しきい値以上の連続反復は先頭1行に間引く", () => {
    const input = Array(50).fill("総務部課…").join("\n");
    const out = removeHallucinationLoops(input, { maxRepeats: 5 });
    expect(out).toBe("総務部課…");
  });

  it("しきい値未満の反復は残す", () => {
    const input = "はい。\nはい。\nはい。";
    const out = removeHallucinationLoops(input, { maxRepeats: 5 });
    expect(out).toBe(input);
  });

  it("末尾の句読点・…の揺れを同一視する", () => {
    const input = ["総務部課", "総務部課…", "総務部課。", "総務部課", "総務部課"].join("\n");
    const out = removeHallucinationLoops(input, { maxRepeats: 5 });
    // 5行とも同一キーなので先頭1行のみ
    expect(out).toBe("総務部課");
  });

  it("本文を挟んだループは本文を保持する", () => {
    const loop = Array(10).fill("ループ").join("\n");
    const input = `序論\n${loop}\n結論`;
    const out = removeHallucinationLoops(input, { maxRepeats: 5 });
    expect(out).toBe("序論\nループ\n結論");
  });

  it("空行は塊にせずそのまま残す", () => {
    const input = "a\n\n\n\n\n\n\nb";
    const out = removeHallucinationLoops(input, { maxRepeats: 5 });
    expect(out).toBe(input);
  });

  it("ループが2か所あればそれぞれ間引く", () => {
    const input = [
      ...Array(8).fill("X"),
      "本文",
      ...Array(8).fill("Y"),
    ].join("\n");
    const out = removeHallucinationLoops(input, { maxRepeats: 5 });
    expect(out).toBe("X\n本文\nY");
  });
});
