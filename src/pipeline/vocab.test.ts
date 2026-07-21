import { describe, it, expect } from "vitest";
import type { Summarizer } from "./summarize.js";
import { parseVocabularyResponse, extractVocabulary, mergeVocabulary } from "./vocab.js";

function fakeSummarizer(fn: (message: string) => Promise<string>): Summarizer {
  return { name: "fake", summarize: fn };
}

describe("parseVocabularyResponse", () => {
  it("カンマ・読点・改行区切りをパースする", () => {
    expect(parseVocabularyResponse("根付, ED2、トヨタ\n堤工場")).toEqual([
      "根付",
      "ED2",
      "トヨタ",
      "堤工場",
    ]);
  });

  it("空要素・50文字超・重複を除去する", () => {
    const long = "あ".repeat(51);
    expect(parseVocabularyResponse(`根付,,${long},根付`)).toEqual(["根付"]);
  });

  it("最大20語で打ち切る", () => {
    const response = Array.from({ length: 30 }, (_, i) => `語${i}`).join(",");
    expect(parseVocabularyResponse(response)).toHaveLength(20);
  });
});

describe("extractVocabulary", () => {
  it("資料が空なら LLM を呼ばず空配列", async () => {
    let called = false;
    const s = fakeSummarizer(async () => {
      called = true;
      return "x";
    });
    expect(await extractVocabulary("   ", s)).toEqual([]);
    expect(called).toBe(false);
  });

  it("資料は先頭2万文字に切り詰めて送る", async () => {
    let received = "";
    const s = fakeSummarizer(async (m) => {
      received = m;
      return "根付";
    });
    await extractVocabulary("あ".repeat(30000), s);
    expect(received.length).toBeLessThan(21000);
  });

  it("抽出失敗時は警告して空配列（例外を投げない）", async () => {
    const warns: string[] = [];
    const s = fakeSummarizer(async () => {
      throw new Error("boom");
    });
    const out = await extractVocabulary("資料", s, (m) => warns.push(m));
    expect(out).toEqual([]);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("boom");
  });
});

describe("mergeVocabulary", () => {
  it("自動語→手動語の順に結合する（手動語が末尾＝最優先）", () => {
    expect(mergeVocabulary(["A", "B"], ["C"])).toEqual(["A", "B", "C"]);
  });

  it("手動語と重複する自動語は自動側を捨てて手動側の位置を保つ", () => {
    expect(mergeVocabulary(["A", "C"], ["C", "D"])).toEqual(["A", "C", "D"]);
  });
});
