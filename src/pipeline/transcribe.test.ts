import { describe, it, expect } from "vitest";
import { buildTranscribeArgs } from "./transcribe.js";

describe("buildTranscribeArgs", () => {
  it("幻聴対策のデコードフラグを常に付ける", () => {
    const args = buildTranscribeArgs("/tmp/a.wav", { outputDir: "/tmp/out" });
    const joined = args.join(" ");
    expect(joined).toContain("--condition-on-previous-text False");
    expect(joined).toContain("--word-timestamps True");
    expect(joined).toContain("--hallucination-silence-threshold 2");
  });

  it("initialPrompt があれば --initial-prompt を付ける", () => {
    const args = buildTranscribeArgs("/tmp/a.wav", {
      outputDir: "/tmp/out",
      initialPrompt: "次の固有名詞が登場します: 根付。",
    });
    expect(args).toContain("--initial-prompt");
    expect(args).toContain("次の固有名詞が登場します: 根付。");
  });

  it("initialPrompt が無ければ --initial-prompt を付けない", () => {
    const args = buildTranscribeArgs("/tmp/a.wav", { outputDir: "/tmp/out" });
    expect(args).not.toContain("--initial-prompt");
  });
});
