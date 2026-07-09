import type { EngineName } from "../config.js";

/** 各録音フォルダで「次にやること」。skip は対象外または完了。 */
export type NextStage = "transcribe" | "summarize" | "skip";

/** 走査で得た1フォルダ分の要約情報 */
export type DirEntry = { name: string; hasAudio: boolean; hasNote: boolean };

/**
 * フォルダ内のファイル構成から次の処理段階を判定する。
 * 段階の区切りは整形済みの `文字起こし.txt`（有れば文字起こしは完了）に置く。
 */
export function nextStage(files: {
  hasAudio: boolean;
  hasTranscript: boolean;
  hasNote: boolean;
}): NextStage {
  if (!files.hasAudio) return "skip";
  if (files.hasNote) return "skip";
  if (files.hasTranscript) return "summarize";
  return "transcribe";
}

/**
 * 未完フォルダ（音声あり・ノートなし）を古い順（フォルダ名昇順＝タイムスタンプ順）で返す。
 * excludeName は録音中フォルダなど処理対象から外したいものの basename。
 */
export function selectPendingDirs(entries: DirEntry[], excludeName?: string): string[] {
  return entries
    .filter((e) => e.hasAudio && !e.hasNote && e.name !== excludeName)
    .map((e) => e.name)
    .sort();
}

/**
 * バックグラウンドで要約まで進めてよいか。
 * claude（クラウド）は未同意だとダイアログを出せないため、同意済みのときだけ。
 * ollama はローカルなので常に可。
 */
export function canSummarizeInBackground(engine: EngineName, cloudConsent: boolean): boolean {
  return engine !== "claude" || cloudConsent;
}
