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
 * 正規化したキーの実マッチ行数が maxRepeats 回以上続いた塊は、先頭の1行だけ残す。
 * 塊の途中に挟まる空行は「透明」扱い（連続を切らず、回数にも数えない）。
 * 塊を除去するときは内部の空行も一緒に消えるが、塊の末尾より後の空行は残す。
 * maxRepeats 未満の繰り返し（「はい。」「はい。」程度）はそのまま残す。
 */
export function removeHallucinationLoops(text: string, options: CleanOptions = {}): string {
  const maxRepeats = options.maxRepeats ?? DEFAULT_MAX_REPEATS;
  const lines = text.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const key = normalize(lines[i]!);
    if (key === "") {
      out.push(lines[i]!);
      i++;
      continue;
    }

    // 空行を読み飛ばしながら同一キーの実マッチ行数を数える。
    // last は最後にマッチした行の位置（末尾側の空行は塊に含めない）。
    let matches = 1;
    let last = i;
    let j = i + 1;
    while (j < lines.length) {
      const k = normalize(lines[j]!);
      if (k === key) {
        matches++;
        last = j;
        j++;
      } else if (k === "") {
        j++; // 透明扱い（連続を切らない・数えない）
      } else {
        break;
      }
    }

    if (matches >= maxRepeats) {
      out.push(lines[i]!); // 塊は先頭の1行のみ残す（内部の空行ごと除去）
    } else {
      for (let k = i; k <= last; k++) out.push(lines[k]!);
    }
    i = last + 1;
  }

  return out.join("\n");
}
