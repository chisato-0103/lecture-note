import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { LiveTranscriber, segIndex } from "./liveTranscribe.js";

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

describe("LiveTranscriber 一時停止", () => {
  function make(segmentDir: string, onText: (t: string) => void): LiveTranscriber {
    return new LiveTranscriber({
      segmentDir,
      scriptPath: "unused",
      model: "unused",
      minBytes: 0,
      onText,
    });
  }

  it("pause/resume で isPaused が切り替わる", () => {
    const live = make("unused", () => {});
    expect(live.isPaused).toBe(false);
    live.pause();
    expect(live.isPaused).toBe(true);
    live.resume();
    expect(live.isPaused).toBe(false);
  });

  it("一時停止中はセグメントを文字起こしせず削除する", async () => {
    const dir = await mkdtemp(join(tmpdir(), "live-"));
    try {
      const texts: string[] = [];
      const live = make(dir, (t) => texts.push(t));
      await writeFile(join(dir, "seg_000.wav"), "dummy-audio");

      // 文字起こしに到達しないことを担保するため差し替え、drain の生存ガードを通す
      let transcribeCalled = false;
      (live as unknown as { transcribeOne: () => Promise<{ text: string }> }).transcribeOne =
        async () => {
          transcribeCalled = true;
          return { text: "x" };
        };
      (live as unknown as { child: object }).child = {};

      live.pause();
      (live as unknown as { queue: string[] }).queue.push("seg_000.wav");
      await (live as unknown as { drain: () => Promise<void> }).drain();

      expect(transcribeCalled).toBe(false);
      expect(texts).toEqual([]);
      expect(await readdir(dir)).toEqual([]); // 破棄されている
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
