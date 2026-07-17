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
 * 幻聴ループ対策のデコード設定。
 * - condition-on-previous-text False: 直前ウィンドウの出力を次のプロンプトにしない(反復ループの根本抑制)
 * - word-timestamps True: hallucination-silence-threshold の前提条件(処理時間は増える)
 * - hallucination-silence-threshold 2: 幻聴が疑われるとき2秒超の無音区間をスキップ
 */
const DECODE_ARGS: readonly string[] = [
  "--condition-on-previous-text",
  "False",
  "--word-timestamps",
  "True",
  "--hallucination-silence-threshold",
  "2",
];

/** mlx_whisper に渡す引数列を組み立てる(テスト可能にするため分離) */
export function buildTranscribeArgs(audioPath: string, options: TranscribeOptions): string[] {
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
    ...DECODE_ARGS,
  ];
  if (options.initialPrompt) {
    args.push("--initial-prompt", options.initialPrompt);
  }
  return args;
}

/**
 * mlx-whisper で音声ファイルを文字起こしし、生成された .txt の中身を返す。
 * mlx_whisper は入力ファイルの basename に拡張子 .txt を付けて出力する。
 */
export async function transcribe(
  audioPath: string,
  options: TranscribeOptions,
): Promise<string> {
  const args = buildTranscribeArgs(audioPath, options);

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
