import { describe, it, expect } from "vitest";
import { chunkTranscript } from "./chunk.js";

describe("chunkTranscript", () => {
  it("maxChars 以下なら1チャンク", () => {
    const text = "あ\nい\nう";
    expect(chunkTranscript(text, { maxChars: 100 })).toEqual([text]);
  });

  it("超過したら複数チャンクに分割し、各チャンクは上限以下", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `行${i}`);
    const text = lines.join("\n");
    const chunks = chunkTranscript(text, { maxChars: 30 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(30);
    }
  });

  it("分割しても内容（行）は欠落なく順序を保つ", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `行${i}`);
    const text = lines.join("\n");
    const chunks = chunkTranscript(text, { maxChars: 25 });
    const rejoined = chunks.join("\n");
    expect(rejoined.split("\n")).toEqual(lines);
  });

  it("1行が上限を超えてもその行は途中で切らず単独チャンクにする", () => {
    const long = "x".repeat(50);
    const text = `短い\n${long}\n短い`;
    const chunks = chunkTranscript(text, { maxChars: 10 });
    expect(chunks).toContain(long);
  });
});
