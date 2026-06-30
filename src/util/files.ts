import { rename, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** YYYY-MM-DD_HHMM 形式のタイムスタンプ（保存ディレクトリ名用） */
export function formatTimestamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}`
  );
}

/**
 * 一時ファイルに書いてから rename する atomic write。
 * 途中失敗で壊れた本ファイルが残るのを防ぐ。
 */
export async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}
