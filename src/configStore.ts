import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_CONFIG, type AppConfig } from "./config.js";

/** 部分設定を既定値とマージして完全な AppConfig にする */
export function mergeConfig(partial: Partial<AppConfig>): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    // 配列・任意項目は未指定なら既定を使う
    vocabulary: partial.vocabulary ?? DEFAULT_CONFIG.vocabulary,
    // 不正な engine 値（壊れた config.json 等）は既定の claude にフォールバック
    engine: partial.engine === "ollama" ? "ollama" : "claude",
  };
}

/** 設定ファイルを読み込む。無ければ／壊れていれば既定設定を返す */
export async function loadConfig(path: string): Promise<AppConfig> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return mergeConfig(parsed);
  } catch {
    return mergeConfig({});
  }
}

/** 設定ファイルを保存する（ディレクトリは自動作成） */
export async function saveConfig(path: string, config: AppConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), "utf8");
}
