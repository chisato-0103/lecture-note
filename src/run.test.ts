import { describe, it, expect } from "vitest";
import { processTranscript } from "./run.js";
import type { Summarizer } from "./pipeline/summarize.js";

/** 固定文字列を返すだけのダミー要約器 */
const okSummarizer: Summarizer = {
  name: "test-ok",
  async summarize() {
    return "# ノート\n要約結果";
  },
};

/** 必ず失敗するダミー要約器（要約段の失敗を再現） */
const failingSummarizer: Summarizer = {
  name: "test-fail",
  async summarize() {
    throw new Error("要約に失敗");
  },
};

describe("processTranscript", () => {
  it("整形 → 要約を行い、整形済み文字起こしとノートを返す", async () => {
    const { cleaned, note } = await processTranscript("今日の講義の本文です\n", okSummarizer);
    expect(cleaned).toContain("今日の講義の本文です");
    expect(note).toContain("要約結果");
  });

  it("要約前に onCleaned が整形済みテキストで呼ばれる（中間成果の即保存）", async () => {
    let saved: string | null = null;
    await processTranscript("これはテスト用の本文です\n", okSummarizer, {
      onCleaned: (cleaned) => {
        saved = cleaned;
      },
    });
    expect(saved).toContain("これはテスト用の本文です");
  });

  it("要約が失敗しても onCleaned は先に実行済み（前段の成果を失わない）", async () => {
    let saved: string | null = null;
    await expect(
      processTranscript("失敗ケースの本文です\n", failingSummarizer, {
        onCleaned: (cleaned) => {
          saved = cleaned;
        },
      }),
    ).rejects.toThrow("要約に失敗");
    // 要約が落ちても、整形済み文字起こしは確定保存されている
    expect(saved).toContain("失敗ケースの本文です");
  });
});
