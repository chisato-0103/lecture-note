// ライブ字幕の「同じ文字列の連呼」を抑止するフィルタ。
// ライブは5秒クリップを独立に文字起こしするため、(1)クリップ内で Whisper が
// 同一文を繰り返す幻聴ループ、(2)隣接クリップが同じ発話やフィラーを拾う重複、
// の2つで連呼が起きる。ここで両方を畳む。バッチ側の removeHallucinationLoops は
// 改行区切りの確定テキスト向けなので、句点区切り・逐次処理のライブ用に別実装する。

/** 比較用キー。前後空白と末尾の句読点・記号ゆれを落として同一視する。 */
function normalizeKey(s: string): string {
  return s.trim().replace(/[。、，．,.…・!！?？\s]+$/u, "");
}

/**
 * 区切り記号のない同一ユニットの連続反復（「生生生生…」等の幻聴ループ）を
 * 1周期に畳む。最短ユニットが4回以上連続した箇所のみ対象で、3回までの
 * 自然な強調（「そうそうそう」）は残す。句点区切りの反復は
 * collapseRepeatedPhrases が担当するため、ここは区切り無し反復を受け持つ。
 */
export function collapseCharRuns(text: string): string {
  return text.replace(/(.+?)\1{3,}/gu, "$1");
}

/**
 * 1クリップのテキスト内で、連続する同一フレーズを先頭1つに畳む。
 * 句点・感嘆・改行（区切り文字は各フレーズ末尾に残す）で分割して比較する。
 * 連続していない同一フレーズ（「はい。では。はい。」）は残す。
 */
export function collapseRepeatedPhrases(text: string): string {
  const parts = text.split(/(?<=[。！？!?\n])/);
  const out: string[] = [];
  let prevKey: string | null = null;
  for (const part of parts) {
    const key = normalizeKey(part);
    if (key === "") {
      out.push(part); // 記号のみ・空白は素通し（区切りの保全）
      continue;
    }
    if (key === prevKey) continue; // 直前フレーズと同一 → 捨てる
    out.push(part);
    prevKey = key;
  }
  return out.join("").trim();
}

/**
 * 逐次流れてくるクリップのテキストから連呼を除くフィルタ（録音1回につき1インスタンス）。
 * クリップ内ループを畳んだうえで、直前に表示したクリップと同一なら null を返す。
 */
export class LiveCaptionFilter {
  private lastKey = "";

  /** @returns 表示するテキスト。空または直前と同一なら null（表示しない）。 */
  filter(text: string): string | null {
    // 先に区切りなしの連発を潰し、その後フレーズ単位の連続重複を畳む。
    const collapsed = collapseRepeatedPhrases(collapseCharRuns(text));
    const key = normalizeKey(collapsed);
    if (key === "") return null;
    if (key === this.lastKey) return null;
    this.lastKey = key;
    return collapsed;
  }
}
