import { describe, it, expect } from "vitest";
import { assertSafeClaudeAuth } from "./summarize.js";

describe("assertSafeClaudeAuth", () => {
  it("API キーが無ければ通る", () => {
    expect(() => assertSafeClaudeAuth({}, false)).not.toThrow();
  });

  it("API キーがあり許可していなければ例外（意図しない課金防止）", () => {
    expect(() =>
      assertSafeClaudeAuth({ ANTHROPIC_API_KEY: "sk-xxx" }, false),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("API キーがあっても明示許可していれば通る", () => {
    expect(() =>
      assertSafeClaudeAuth({ ANTHROPIC_API_KEY: "sk-xxx" }, true),
    ).not.toThrow();
  });
});
