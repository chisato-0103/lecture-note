import { describe, it, expect } from "vitest";
import {
  nextStage,
  selectPendingDirs,
  canSummarizeInBackground,
} from "./pendingJobs.js";

describe("nextStage", () => {
  it("音声が無ければ skip（対象外）", () => {
    expect(nextStage({ hasAudio: false, hasTranscript: false, hasNote: false })).toBe("skip");
    expect(nextStage({ hasAudio: false, hasTranscript: true, hasNote: false })).toBe("skip");
  });

  it("ノートが有れば skip（完了）", () => {
    expect(nextStage({ hasAudio: true, hasTranscript: true, hasNote: true })).toBe("skip");
    expect(nextStage({ hasAudio: true, hasTranscript: false, hasNote: true })).toBe("skip");
  });

  it("音声のみ（文字起こし未）なら transcribe", () => {
    expect(nextStage({ hasAudio: true, hasTranscript: false, hasNote: false })).toBe(
      "transcribe"
    );
  });

  it("文字起こし有り・ノート無しなら summarize", () => {
    expect(nextStage({ hasAudio: true, hasTranscript: true, hasNote: false })).toBe("summarize");
  });
});

describe("selectPendingDirs", () => {
  const entries = [
    { name: "2026-07-09_1030_録音", hasAudio: true, hasNote: false },
    { name: "2026-07-08_0900_録音", hasAudio: true, hasNote: false },
    { name: "2026-07-07_1500_録音", hasAudio: true, hasNote: true }, // 完了 → 除外
    { name: "空フォルダ", hasAudio: false, hasNote: false }, // 音声なし → 除外
  ];

  it("未完（音声あり・ノートなし）のみを古い順で返す", () => {
    expect(selectPendingDirs(entries)).toEqual([
      "2026-07-08_0900_録音",
      "2026-07-09_1030_録音",
    ]);
  });

  it("録音中フォルダ（excludeName）は除外する", () => {
    expect(selectPendingDirs(entries, "2026-07-09_1030_録音")).toEqual([
      "2026-07-08_0900_録音",
    ]);
  });

  it("対象が無ければ空配列", () => {
    expect(selectPendingDirs([])).toEqual([]);
  });
});

describe("canSummarizeInBackground", () => {
  it("claude は同意済みのときだけ背景要約できる", () => {
    expect(canSummarizeInBackground("claude", true)).toBe(true);
    expect(canSummarizeInBackground("claude", false)).toBe(false);
  });

  it("ollama（ローカル）は同意に関係なく背景要約できる", () => {
    expect(canSummarizeInBackground("ollama", false)).toBe(true);
    expect(canSummarizeInBackground("ollama", true)).toBe(true);
  });
});
