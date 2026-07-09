import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "../util/files.js";

/** 録音フォルダに保存する per-録音 のメタ情報（要約に必要な最小限） */
export type JobMeta = {
  /** 録音時刻（ISO8601）。表示・並び用 */
  recordedAt: string;
  /** 添付された授業資料の絶対パス（無ければ空） */
  materialPaths: string[];
};

export const JOB_META_FILE = "job.json";

const EMPTY_META: JobMeta = { recordedAt: "", materialPaths: [] };

/** job.json を読む。無い/壊れている場合は既定値（要約は資料なしで続行できる）。 */
export async function readJobMeta(dir: string): Promise<JobMeta> {
  try {
    const raw = await readFile(join(dir, JOB_META_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<JobMeta>;
    return {
      recordedAt: typeof parsed.recordedAt === "string" ? parsed.recordedAt : "",
      materialPaths: Array.isArray(parsed.materialPaths) ? parsed.materialPaths : [],
    };
  } catch {
    return { ...EMPTY_META };
  }
}

/** job.json を atomic に書く。 */
export async function writeJobMeta(dir: string, meta: JobMeta): Promise<void> {
  await atomicWriteFile(join(dir, JOB_META_FILE), JSON.stringify(meta, null, 2));
}

/** 実在するファイルパスのみ残す（移動・削除済みの資料は黙ってスキップ）。 */
export async function filterExistingPaths(paths: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const p of paths) {
    try {
      await access(p);
      results.push(p);
    } catch {
      // 存在しない資料はスキップ
    }
  }
  return results;
}
