import type { EngineName } from "./config.js";
import {
  ClaudeCliSummarizer,
  OllamaSummarizer,
  type Summarizer,
} from "./pipeline/summarize.js";

export type SummarizerSettings = {
  engine: EngineName;
  model?: string;
  allowApiBilling?: boolean;
};

/** 設定から要約エンジン実装を生成する（CLI / Electron 共通） */
export function makeSummarizer(settings: SummarizerSettings): Summarizer {
  if (settings.engine === "ollama") {
    return new OllamaSummarizer({ model: settings.model });
  }
  return new ClaudeCliSummarizer({
    model: settings.model,
    allowApiBilling: settings.allowApiBilling ?? false,
  });
}
