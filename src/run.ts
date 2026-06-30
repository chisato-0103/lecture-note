import { removeHallucinationLoops } from "./pipeline/clean.js";
import { chunkTranscript } from "./pipeline/chunk.js";
import {
  buildSummaryMessage,
  buildPartialMessage,
  buildMergeMessage,
} from "./pipeline/prompt.js";
import type { Summarizer } from "./pipeline/summarize.js";

export type SummarizeTranscriptOptions = {
  maxCharsPerChunk?: number;
  instruction?: string;
  /** 用語集（要約側での誤変換補正に使う） */
  vocabulary?: string[];
  /** 授業資料テキスト（用語・構成の参考） */
  materials?: string;
  /** 進捗ログ用コールバック */
  onProgress?: (message: string) => void;
};

/**
 * 文字起こしテキストを階層ノートに要約する。
 * 長文はチャンク分割→部分要約→統合（段階要約）する。
 */
/** これ未満の文字数なら「実質無音」とみなして要約に進まない */
const MIN_TRANSCRIPT_CHARS = 10;

export async function summarizeTranscript(
  transcript: string,
  summarizer: Summarizer,
  options: SummarizeTranscriptOptions = {},
): Promise<string> {
  if (transcript.trim().length < MIN_TRANSCRIPT_CHARS) {
    throw new Error(
      "文字起こしが空（ほぼ無音）です。マイクに声が届いていない可能性があります" +
        "（マイク位置・入力レベル・デバイス選択を確認してください）。要約はスキップしました。",
    );
  }
  const onProgress = options.onProgress ?? (() => {});
  const chunks = chunkTranscript(transcript, { maxChars: options.maxCharsPerChunk });

  if (chunks.length === 1) {
    onProgress("要約中（1チャンク）...");
    return summarizer.summarize(
      buildSummaryMessage(transcript, {
        instruction: options.instruction,
        vocabulary: options.vocabulary,
        materials: options.materials,
      }),
    );
  }

  onProgress(`段階要約: ${chunks.length} チャンクに分割`);
  const partials: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress(`部分要約 ${i + 1}/${chunks.length} ...`);
    const partial = await summarizer.summarize(
      buildPartialMessage(chunks[i]!, i, chunks.length, {
        instruction: options.instruction,
        vocabulary: options.vocabulary,
        materials: options.materials,
      }),
    );
    partials.push(partial);
  }

  onProgress("部分ノートを統合中 ...");
  return summarizer.summarize(buildMergeMessage(partials));
}

export type ProcessTranscriptOptions = SummarizeTranscriptOptions & {
  maxRepeats?: number;
  /**
   * 整形済み文字起こしが確定した時点（要約より前）で呼ばれる。
   * ここで `文字起こし.txt` を保存しておけば、後段の要約が失敗しても前段の成果を失わない。
   */
  onCleaned?: (cleaned: string) => void | Promise<void>;
};

/**
 * 生の文字起こしから「整形 → 要約」までを行い、ノート本文を返す。
 * 整形後のクリーンな文字起こしも一緒に返す（中間成果として保存できるように）。
 * onCleaned は整形完了直後・要約開始前に await される（中間成果の即保存用）。
 */
export async function processTranscript(
  rawTranscript: string,
  summarizer: Summarizer,
  options: ProcessTranscriptOptions = {},
): Promise<{ cleaned: string; note: string }> {
  const cleaned = removeHallucinationLoops(rawTranscript, {
    maxRepeats: options.maxRepeats,
  });
  // 要約に進む前に整形済みテキストを確定させる（要約失敗時の保全）
  await options.onCleaned?.(cleaned);
  const note = await summarizeTranscript(cleaned, summarizer, options);
  return { cleaned, note };
}
