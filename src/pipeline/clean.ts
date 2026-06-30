export type CleanOptions = {
  /** 同一行がこの回数以上連続したら間引く（既定 5） */
  maxRepeats?: number;
};

const DEFAULT_MAX_REPEATS = 5;

/**
 * 行末の揺れ（前後空白・連続する句読点や「…」）を取り除いて比較用キーにする。
 * 例: "総務部課…" と "総務部課" を同一視する。
 */
function normalize(line: string): string {
  return line.trim().replace(/[。、，．,.…・\s]+$/u, "");
}

/**
 * Whisper の幻聴ループ（同一行の連続反復）を除去する。
 *
 * 正規化したキーが連続して maxRepeats 回以上続いた塊は、先頭の1行だけ残す。
 * maxRepeats 未満の繰り返し（「はい。」「はい。」程度）はそのまま残す。
 * 空行は塊として扱わず常にそのまま残す。
 */
export function removeHallucinationLoops(text: string, options: CleanOptions = {}): string {
  const maxRepeats = options.maxRepeats ?? DEFAULT_MAX_REPEATS;
  const lines = text.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const key = normalize(lines[i]!);

    // 連続する同一キー行の塊の長さを数える（空行は塊にしない）
    let j = i + 1;
    if (key !== "") {
      while (j < lines.length && normalize(lines[j]!) === key) j++;
    }
    const runLength = j - i;

    if (key !== "" && runLength >= maxRepeats) {
      out.push(lines[i]!); // 塊は先頭の1行のみ残す
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]!);
    }
    i = j;
  }

  return out.join("\n");
}
