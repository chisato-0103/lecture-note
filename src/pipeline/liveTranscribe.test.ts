import { describe, it, expect } from "vitest";
import { segIndex } from "./liveTranscribe.js";

describe("segIndex", () => {
  it("seg_<番号>.wav から番号を取り出す", () => {
    expect(segIndex("seg_000.wav")).toBe(0);
    expect(segIndex("seg_042.wav")).toBe(42);
    expect(segIndex("seg_1000.wav")).toBe(1000);
  });

  it("番号順ソートが 999→1000 をまたいでも壊れない（辞書順バグの回帰）", () => {
    const files = [
      "seg_010.wav",
      "seg_002.wav",
      "seg_1000.wav",
      "seg_100.wav",
      "seg_999.wav",
      "seg_001.wav",
    ];
    const sorted = [...files].sort((a, b) => segIndex(a) - segIndex(b));
    expect(sorted).toEqual([
      "seg_001.wav",
      "seg_002.wav",
      "seg_010.wav",
      "seg_100.wav",
      "seg_999.wav",
      "seg_1000.wav",
    ]);
  });
});
