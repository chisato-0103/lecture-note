import { homedir } from "node:os";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { execCommand } from "../util/exec.js";
import { resolveLivePython } from "./liveTranscribe.js";
import type { EngineName } from "../config.js";

export type DepStatus = {
  name: string;
  ok: boolean;
  detail: string;
  /** インストール手順などのヒント */
  hint?: string;
};

type Probe = {
  name: string;
  command: string;
  args: string[];
  hint: string;
};

const PROBES: Record<string, Probe> = {
  ffmpeg: {
    name: "ffmpeg",
    command: "ffmpeg",
    args: ["-version"],
    hint: "brew install ffmpeg",
  },
  mlx_whisper: {
    name: "mlx_whisper",
    command: "mlx_whisper",
    args: ["--help"],
    hint: "pip3 install mlx-whisper",
  },
  claude: {
    name: "claude",
    command: "claude",
    args: ["--version"],
    hint: "https://claude.com/claude-code を参照",
  },
  ollama: {
    name: "ollama",
    command: "ollama",
    args: ["--version"],
    hint: "brew install ollama",
  },
};

async function probe(p: Probe): Promise<DepStatus> {
  try {
    const res = await execCommand(p.command, p.args, { timeoutMs: 15000 });
    // --help は非ゼロ終了のこともあるので、起動できたこと自体を成功とみなす
    const firstLine = (res.stdout || res.stderr).split("\n")[0]?.trim() ?? "";
    return { name: p.name, ok: true, detail: firstLine || "検出" };
  } catch {
    return { name: p.name, ok: false, detail: "見つかりません", hint: p.hint };
  }
}

/**
 * 必要な外部コマンドの有無を確認する。
 * 録音・文字起こしは常に必須。要約は選択中エンジンのみ確認する。
 */
export async function checkDependencies(engine: EngineName): Promise<DepStatus[]> {
  const targets = [PROBES.ffmpeg!, PROBES.mlx_whisper!];
  targets.push(engine === "ollama" ? PROBES.ollama! : PROBES.claude!);
  return Promise.all(targets.map(probe));
}

/** HF キャッシュの hub ディレクトリ（HF_HUB_CACHE / HF_HOME を尊重） */
function hfHubCacheDir(): string {
  if (process.env.HF_HUB_CACHE) return process.env.HF_HUB_CACHE;
  if (process.env.HF_HOME) return join(process.env.HF_HOME, "hub");
  return join(homedir(), ".cache", "huggingface", "hub");
}

/** ライブ字幕用 Python(mlx_whisper) が import 可能か確認する */
async function probeLivePython(): Promise<DepStatus> {
  const name = "live: python(mlx_whisper)";
  try {
    const python = await resolveLivePython();
    const res = await execCommand(python, ["-c", "import mlx_whisper"], { timeoutMs: 20000 });
    if (res.code === 0) return { name, ok: true, detail: python };
    return { name, ok: false, detail: "import 失敗", hint: "pip3 install mlx-whisper" };
  } catch {
    return { name, ok: false, detail: "Python 未検出", hint: "pip3 install mlx-whisper" };
  }
}

/** ライブ字幕用モデルが HF キャッシュに取得済みか（オフライン起動の前提） */
async function probeLiveModel(model: string): Promise<DepStatus> {
  const name = `live: model(${model})`;
  const dir = join(hfHubCacheDir(), "models--" + model.replace(/\//g, "--"), "snapshots");
  try {
    const snaps = await readdir(dir);
    if (snaps.length > 0) return { name, ok: true, detail: "取得済み" };
  } catch {
    // 未取得
  }
  return { name, ok: false, detail: "未取得", hint: `huggingface-cli download ${model}` };
}

/** ライブ字幕の依存（Python+mlx_whisper、軽量モデル）を確認する。 */
export async function checkLiveCaptionDeps(model: string): Promise<DepStatus[]> {
  return Promise.all([probeLivePython(), probeLiveModel(model)]);
}
