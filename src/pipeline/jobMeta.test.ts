import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readJobMeta,
  writeJobMeta,
  filterExistingPaths,
  JOB_META_FILE,
} from "./jobMeta.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jobmeta-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeJobMeta / readJobMeta", () => {
  it("書いた内容をそのまま読み戻せる", async () => {
    const meta = { recordedAt: "2026-07-09T10:30:00.000Z", materialPaths: ["/a.pdf"] };
    await writeJobMeta(dir, meta);
    expect(await readJobMeta(dir)).toEqual(meta);
  });

  it("job.json が無ければ既定値を返す", async () => {
    expect(await readJobMeta(dir)).toEqual({ recordedAt: "", materialPaths: [] });
  });

  it("job.json が壊れていれば既定値を返す", async () => {
    await writeFile(join(dir, JOB_META_FILE), "{壊れたjson", "utf8");
    expect(await readJobMeta(dir)).toEqual({ recordedAt: "", materialPaths: [] });
  });
});

describe("filterExistingPaths", () => {
  it("実在するファイルだけ残す", async () => {
    const exists = join(dir, "slides.txt");
    await writeFile(exists, "x", "utf8");
    const missing = join(dir, "no-such-file.pdf");
    expect(await filterExistingPaths([exists, missing])).toEqual([exists]);
  });

  it("空配列はそのまま空", async () => {
    expect(await filterExistingPaths([])).toEqual([]);
  });
});
