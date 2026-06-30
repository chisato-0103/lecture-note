import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { execCommand } from "../util/exec.js";

/** 資料全体の最大文字数（長すぎるプロンプトを避ける） */
const MAX_MATERIAL_CHARS = 60000;

/**
 * 授業資料ファイルからテキストを抽出する。
 * - .pdf            → pdftotext（poppler）
 * - .docx/.doc/.rtf/.html/.odt → textutil（macOS標準）
 * - それ以外（.txt/.md 等） → そのまま読む
 */
export async function extractMaterialText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();

  if (ext === ".pdf") {
    const res = await execCommand("pdftotext", ["-layout", path, "-"], { timeoutMs: 60000 }).catch(
      (e: unknown) => {
        throw new Error(
          `PDF抽出に失敗（pdftotext が必要: brew install poppler）: ${e instanceof Error ? e.message : e}`,
        );
      },
    );
    if (res.code !== 0) {
      throw new Error(`PDF抽出に失敗: ${res.stderr.trim() || path}`);
    }
    return res.stdout;
  }

  if ([".docx", ".doc", ".rtf", ".html", ".htm", ".odt"].includes(ext)) {
    const res = await execCommand("textutil", ["-convert", "txt", "-stdout", path], {
      timeoutMs: 60000,
    });
    if (res.code !== 0) {
      throw new Error(`資料のテキスト変換に失敗: ${res.stderr.trim() || path}`);
    }
    return res.stdout;
  }

  return readFile(path, "utf8");
}

/**
 * 複数の資料を読み込み、1つの参照テキストにまとめる。
 * 合計が上限を超える場合は末尾を切り詰める。
 */
export async function loadMaterials(paths: string[]): Promise<string> {
  if (paths.length === 0) return "";

  const parts: string[] = [];
  for (const p of paths) {
    const text = (await extractMaterialText(p)).trim();
    if (text) parts.push(`# 資料: ${basename(p)}\n${text}`);
  }

  let combined = parts.join("\n\n");
  if (combined.length > MAX_MATERIAL_CHARS) {
    combined = combined.slice(0, MAX_MATERIAL_CHARS) + "\n…（資料が長いため一部省略）";
  }
  return combined;
}
