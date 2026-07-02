import { homedir } from "node:os";
import { join } from "node:path";

export type EngineName = "claude" | "ollama";

export type AppConfig = {
  /** 文字起こしモデル（精度優先の large-v3 系） */
  whisperModel: string;
  language: string;
  /** 固有名詞リスト（--initial-prompt に渡す。誤変換抑制用） */
  vocabulary: string[];
  /** 幻聴ループ除去のしきい値 */
  maxRepeats: number;
  /** 1チャンクの最大文字数（超えると段階要約） */
  maxCharsPerChunk: number;
  /** 既定の要約エンジン */
  engine: EngineName;
  /** 要約モデル（省略時は各エンジンの既定） */
  model?: string;
  /** 録音に使うマイク名 */
  deviceName: string;
  /** クラウド要約（claude）の利用にユーザーが同意済みか */
  cloudConsent: boolean;
  /** 保存先ルート */
  outputRoot: string;
  /** 録音中のライブ字幕（速報文字起こし）を表示するか */
  liveCaption: boolean;
  /** ライブ字幕用の Whisper モデル（速報用。精度と遅延のバランスで選ぶ） */
  liveModel: string;
};

export const DEFAULT_CONFIG: AppConfig = {
  // large-v3-mlx(非turbo)は実機で空文字起こしになる不具合があったため、実証済みの turbo を採用
  whisperModel: "mlx-community/whisper-large-v3-turbo",
  language: "ja",
  vocabulary: [],
  maxRepeats: 5,
  maxCharsPerChunk: 24000,
  engine: "claude",
  deviceName: "MacBook Airのマイク",
  cloudConsent: false,
  outputRoot: join(homedir(), "Documents", "講義ノート"),
  liveCaption: true,
  // base は日本語で精度が粗いため、ほぼ同等の遅延で精度が上がる small を既定にする。
  // さらに軽くしたい場合は whisper-base-mlx / whisper-tiny-mlx に設定で下げられる。
  liveModel: "mlx-community/whisper-small-mlx",
};

/** 語彙リストを --initial-prompt 用の1文字列にまとめる（長すぎると逆効果なので上限を設ける） */
export function buildInitialPrompt(vocabulary: string[], maxChars = 600): string | undefined {
  if (vocabulary.length === 0) return undefined;
  let acc = "";
  for (const term of vocabulary) {
    const next = acc === "" ? term : `${acc}、${term}`;
    if (next.length > maxChars) break;
    acc = next;
  }
  return acc === "" ? undefined : `次の固有名詞が登場します: ${acc}。`;
}
