export type ChunkOptions = {
  /** 1チャンクの最大文字数（既定 24000） */
  maxChars?: number;
};

const DEFAULT_MAX_CHARS = 24000;

/**
 * 長い文字起こしを、行（≒発話）境界を保ったまま maxChars を超えないチャンクに分割する。
 * maxChars 以下ならそのまま1チャンクで返す。
 * 1行が maxChars を超える場合はその行を単独チャンクとして許容する（途中で切らない）。
 */
export function chunkTranscript(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  if (text.length <= maxChars) return [text];

  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    if (current === "") {
      current = line;
      continue;
    }
    // +1 は改行ぶん
    if (current.length + 1 + line.length > maxChars) {
      chunks.push(current);
      current = line;
    } else {
      current += "\n" + line;
    }
  }
  if (current !== "") chunks.push(current);

  return chunks;
}
