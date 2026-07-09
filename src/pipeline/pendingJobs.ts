import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { EngineName } from "../config.js";
import { buildInitialPrompt, type AppConfig } from "../config.js";
import { atomicWriteFile } from "../util/files.js";
import { transcribe } from "./transcribe.js";
import { removeHallucinationLoops } from "./clean.js";
import { summarizeTranscript } from "../run.js";
import { makeSummarizer } from "../summarizerFactory.js";
import { loadMaterials } from "./material.js";
import { readJobMeta, filterExistingPaths } from "./jobMeta.js";

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

export const AUDIO_FILE = "録音.wav";
export const TRANSCRIPT_FILE = "文字起こし.txt";
export const NOTE_FILE = "ノート.md";

export type ProcessDeps = {
  outputRoot: string;
  config: AppConfig;
  /** 録音中フォルダの絶対パス（処理対象から除外する） */
  excludeDir?: string;
  notify: (title: string, body: string) => void;
};

/** 保存先ルートを走査し、未完フォルダを1件ずつ処理する（fs 走査部）。 */
async function scanEntries(outputRoot: string): Promise<DirEntry[]> {
  if (!existsSync(outputRoot)) return [];
  const dirents = await readdir(outputRoot, { withFileTypes: true });
  const entries: DirEntry[] = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const dir = join(outputRoot, d.name);
    entries.push({
      name: d.name,
      hasAudio: existsSync(join(dir, AUDIO_FILE)),
      hasNote: existsSync(join(dir, NOTE_FILE)),
    });
  }
  return entries;
}

/**
 * 未完の録音フォルダを古い順に1件ずつ処理する。
 * 文字起こし（ローカル）→ 要約（ネット必須）の順。段階の区切りは `文字起こし.txt`。
 * 1件が失敗しても保留のまま残し、通知して次へ進む（全体は止めない）。
 */
export async function processPendingJobs(deps: ProcessDeps): Promise<void> {
  const { outputRoot, config, excludeDir, notify } = deps;
  const entries = await scanEntries(outputRoot);
  const names = selectPendingDirs(entries, excludeDir ? basename(excludeDir) : undefined);

  for (const name of names) {
    const dir = join(outputRoot, name);
    const audioPath = join(dir, AUDIO_FILE);
    const transcriptPath = join(dir, TRANSCRIPT_FILE);
    const notePath = join(dir, NOTE_FILE);

    try {
      const stage = nextStage({
        hasAudio: existsSync(audioPath),
        hasTranscript: existsSync(transcriptPath),
        hasNote: existsSync(notePath),
      });
      if (stage === "skip") continue;

      // 1) 文字起こし（未なら実行）。ローカル・ネット不要。
      let cleaned: string;
      if (stage === "transcribe") {
        const raw = await transcribe(audioPath, {
          model: config.whisperModel,
          language: config.language,
          initialPrompt: buildInitialPrompt(config.vocabulary),
          outputDir: dir,
        });
        cleaned = removeHallucinationLoops(raw, { maxRepeats: config.maxRepeats });
        await atomicWriteFile(transcriptPath, cleaned);
      } else {
        cleaned = await readFile(transcriptPath, "utf8");
      }

      // 2) 要約（背景で可なら実行）。不可なら文字起こしまでで保留。
      if (!canSummarizeInBackground(config.engine, config.cloudConsent)) {
        notify("文字起こしを保存しました", `要約は未同意のため保留中: ${name}`);
        continue;
      }

      const materialPaths = await filterExistingPaths((await readJobMeta(dir)).materialPaths);
      const materials = materialPaths.length > 0 ? await loadMaterials(materialPaths) : "";
      const summarizer = makeSummarizer({ engine: config.engine, model: config.model });
      const note = await summarizeTranscript(cleaned, summarizer, {
        maxCharsPerChunk: config.maxCharsPerChunk,
        vocabulary: config.vocabulary,
        materials,
      });
      await atomicWriteFile(notePath, note);
      notify("ノート完成", notePath);
    } catch (err) {
      notify("後処理に失敗しました（保留のまま残します）", err instanceof Error ? err.message : String(err));
    }
  }
}
