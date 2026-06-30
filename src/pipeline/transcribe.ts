import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { execCommand } from "../util/exec.js";

export type TranscribeOptions = {
  /** mlx-whisper モデル（既定は精度優先の large-v3 系） */
  model?: string;
  /** 言語（既定 ja） */
  language?: string;
  /** 固有名詞リスト等の語彙バイアス（--initial-prompt） */
  initialPrompt?: string;
  /** 出力ディレクトリ */
  outputDir: string;
  /** タイムアウト(ms)。既定 2 時間 */
  timeoutMs?: number;
};

const DEFAULT_MODEL = "mlx-community/whisper-large-v3-turbo";
const DEFAULT_LANGUAGE = "ja";
const DEFAULT_TRANSCRIBE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/**
 * mlx-whisper で音声ファイルを文字起こしし、生成された .txt の中身を返す。
 * mlx_whisper は入力ファイルの basename に拡張子 .txt を付けて出力する。
 */
export async function transcribe(
  audioPath: string,
  options: TranscribeOptions,
): Promise<string> {
  const model = options.model ?? DEFAULT_MODEL;
  const language = options.language ?? DEFAULT_LANGUAGE;

  const args = [
    audioPath,
    "--language",
    language,
    "--model",
    model,
    "--output-format",
    "txt",
    "--output-dir",
    options.outputDir,
  ];
  if (options.initialPrompt) {
    args.push("--initial-prompt", options.initialPrompt);
  }

  const res = await execCommand("mlx_whisper", args, {
    timeoutMs: options.timeoutMs ?? DEFAULT_TRANSCRIBE_TIMEOUT_MS,
  });
  if (res.code !== 0) {
    throw new Error(
      `mlx_whisper が失敗しました (code=${res.code}): ${res.stderr.trim() || "(stderr なし)"}`,
    );
  }

  const stem = basename(audioPath, extname(audioPath));
  const txtPath = join(options.outputDir, `${stem}.txt`);
  return readFile(txtPath, "utf8");
}
