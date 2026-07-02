import { describe, expect, it } from "vitest";
import { collapseCharRuns, collapseRepeatedPhrases, LiveCaptionFilter } from "./liveCaption.js";

describe("collapseCharRuns", () => {
  it("区切りのない同一文字の連発を1つに畳む（幻聴ループ）", () => {
    expect(collapseCharRuns("生".repeat(60))).toBe("生");
  });

  it("区切りのない同一トークンの反復も1周期に畳む", () => {
    expect(collapseCharRuns("ありがとう".repeat(5))).toBe("ありがとう");
  });

  it("3回までの反復は自然な強調として残す", () => {
    expect(collapseCharRuns("そうそうそう")).toBe("そうそうそう");
    expect(collapseCharRuns("はいはい")).toBe("はいはい");
  });

  it("反復でない文はそのまま返す", () => {
    expect(collapseCharRuns("生物の授業を始めます")).toBe("生物の授業を始めます");
  });

  it("文中に混ざった連発だけを畳む", () => {
    expect(collapseCharRuns("えー生生生生生では")).toBe("えー生では");
  });
});

describe("collapseRepeatedPhrases", () => {
  it("連続する同一フレーズを1つに畳む（幻聴ループ）", () => {
    const input = "ありがとうございました。ありがとうございました。ありがとうございました。";
    expect(collapseRepeatedPhrases(input)).toBe("ありがとうございました。");
  });

  it("末尾の記号ゆれを無視して同一視する", () => {
    expect(collapseRepeatedPhrases("はい。はい")).toBe("はい。");
  });

  it("連続していない同一フレーズは残す", () => {
    const input = "はい。では。はい。";
    expect(collapseRepeatedPhrases(input)).toBe("はい。では。はい。");
  });

  it("繰り返しでない文はそのまま返す", () => {
    expect(collapseRepeatedPhrases("今日は微分方程式を扱います。")).toBe(
      "今日は微分方程式を扱います。",
    );
  });

  it("区切りが無い1フレーズはそのまま返す", () => {
    expect(collapseRepeatedPhrases("次に進みます")).toBe("次に進みます");
  });
});

describe("LiveCaptionFilter", () => {
  it("直前クリップと同一なら null を返す（クリップ間の連呼を抑止）", () => {
    const f = new LiveCaptionFilter();
    expect(f.filter("はい。")).toBe("はい。");
    expect(f.filter("はい。")).toBeNull();
    expect(f.filter("はい")).toBeNull(); // 記号ゆれも同一視
  });

  it("内容が変われば表示する", () => {
    const f = new LiveCaptionFilter();
    expect(f.filter("はい。")).toBe("はい。");
    expect(f.filter("では始めます。")).toBe("では始めます。");
  });

  it("クリップ内ループを畳んでから直前比較する", () => {
    const f = new LiveCaptionFilter();
    expect(f.filter("ありがとうございました。ありがとうございました。")).toBe(
      "ありがとうございました。",
    );
    expect(f.filter("ありがとうございました。")).toBeNull();
  });

  it("区切りなしの連発（生生生…）を1つに畳んで表示する", () => {
    const f = new LiveCaptionFilter();
    expect(f.filter("生".repeat(80))).toBe("生");
  });

  it("空・空白のみは null", () => {
    const f = new LiveCaptionFilter();
    expect(f.filter("")).toBeNull();
    expect(f.filter("  \n ")).toBeNull();
  });
});
