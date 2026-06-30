import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { mergeConfig, loadConfig, saveConfig } from "./configStore.js";
import { DEFAULT_CONFIG } from "./config.js";

describe("mergeConfig", () => {
  it("未指定項目は既定値で埋める", () => {
    const cfg = mergeConfig({ engine: "ollama" });
    expect(cfg.engine).toBe("ollama");
    expect(cfg.maxRepeats).toBe(DEFAULT_CONFIG.maxRepeats);
    expect(cfg.vocabulary).toEqual([]);
  });

  it("空オブジェクトは既定設定になる", () => {
    expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
  });
});

describe("loadConfig / saveConfig", () => {
  it("保存した設定を読み戻せる（ラウンドトリップ）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lecture-note-"));
    try {
      const path = join(dir, "config.json");
      const cfg = mergeConfig({ engine: "ollama", deviceName: "テストマイク", cloudConsent: true });
      await saveConfig(path, cfg);
      const loaded = await loadConfig(path);
      expect(loaded).toEqual(cfg);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("存在しないファイルは既定設定を返す", async () => {
    const loaded = await loadConfig("/no/such/path/config.json");
    expect(loaded).toEqual(DEFAULT_CONFIG);
  });
});
