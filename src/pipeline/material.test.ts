import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { extractMaterialText, loadMaterials } from "./material.js";

describe("extractMaterialText / loadMaterials", () => {
  it("txt/md はそのまま読む", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mat-"));
    try {
      const p = join(dir, "資料.md");
      await writeFile(p, "# 第1章\nRAG とは検索拡張生成", "utf8");
      expect(await extractMaterialText(p)).toContain("検索拡張生成");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("複数資料をファイル名見出し付きで結合する", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mat-"));
    try {
      const a = join(dir, "a.txt");
      const b = join(dir, "b.txt");
      await writeFile(a, "あいうえお", "utf8");
      await writeFile(b, "かきくけこ", "utf8");
      const out = await loadMaterials([a, b]);
      expect(out).toContain("# 資料: a.txt");
      expect(out).toContain("あいうえお");
      expect(out).toContain("# 資料: b.txt");
      expect(out).toContain("かきくけこ");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("空配列なら空文字", async () => {
    expect(await loadMaterials([])).toBe("");
  });
});
