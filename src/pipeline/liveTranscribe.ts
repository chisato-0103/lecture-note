import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { execCommand } from "../util/exec.js";

/** seg_<番号>.wav から番号を取り出す（数値順ソート用。999超でも壊れない） */
export function segIndex(name: string): number {
  const m = name.match(/(\d+)/);
  return m ? Number.parseInt(m[1]!, 10) : -1;
}

const SEG_RE = /^seg_\d+\.wav$/;

/**
 * mlx_whisper が入った Python インタプリタを解決する。
 * PATH の python3 に mlx_whisper が無いことがあるため、`which mlx_whisper`
 * （console_script）の shebang から正しいインタプリタを得る。失敗時は python3。
 */
export async function resolveLivePython(): Promise<string> {
  try {
    const which = await execCommand("which", ["mlx_whisper"], { timeoutMs: 5000 });
    const scriptPath = which.stdout.trim().split("\n")[0];
    if (scriptPath) {
      const head = await readFile(scriptPath, "utf8").catch(() => "");
      const m = head.split("\n")[0]?.match(/^#!\s*(\S+)/);
      if (m?.[1]) return m[1];
    }
  } catch {
    // フォールバックへ
  }
  return "python3";
}

export type LiveTranscriberOptions = {
  /** ライブ用セグメント WAV のディレクトリ（Recorder の segmentDir と同じ） */
  segmentDir: string;
  /** live_transcribe.py の絶対パス */
  scriptPath: string;
  /** 軽量モデル repo */
  model: string;
  /** 固有名詞バイアス（initial_prompt） */
  initialPrompt?: string;
  /** Python インタプリタ（未指定なら resolveLivePython で解決） */
  pythonPath?: string;
  /** ポーリング間隔(ms)。既定 1000 */
  pollMs?: number;
  /** これ未満のセグメントはスキップ（既定 16000B ≒ 0.5s @16k/mono/s16） */
  minBytes?: number;
  /** 1クリップ処理のタイムアウト(ms)。既定 30000 */
  perClipTimeoutMs?: number;
  /** 確定テキスト */
  onText: (text: string) => void;
  /** モデルロード完了 */
  onReady?: () => void;
  /** ライブ字幕の非致命エラー（録音は継続する） */
  onError?: (message: string) => void;
};

/**
 * 録音と並行して、ffmpeg が吐く数秒セグメント WAV を常駐 Python(mlx_whisper) で
 * 順次文字起こしし、確定テキストをコールバックで返す。
 *
 * セグメントは番号順に処理し、処理済みは削除する。最新番号のファイルは「まだ書き込み中」
 * の可能性があるため、次のセグメントが現れる（＝finalize 済み）まで処理しない。
 * stop() 時のみ最後の1個も処理する。
 */
export class LiveTranscriber {
  private child: ChildProcess | null = null;
  private rl: Interface | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private ready = false;

  private readonly queued = new Set<string>();
  private queue: string[] = [];
  private drainPromise: Promise<void> | null = null;
  /** 1件ずつ直列処理する。in-flight の応答待ち resolver */
  private pending: ((r: { text?: string; error?: string }) => void) | null = null;

  private readonly pollMs: number;
  private readonly minBytes: number;
  private readonly perClipTimeoutMs: number;

  constructor(private readonly options: LiveTranscriberOptions) {
    this.pollMs = options.pollMs ?? 1000;
    this.minBytes = options.minBytes ?? 16000;
    this.perClipTimeoutMs = options.perClipTimeoutMs ?? 30000;
  }

  async start(): Promise<void> {
    const python = this.options.pythonPath ?? (await resolveLivePython());
    const args = [this.options.scriptPath, this.options.model];
    if (this.options.initialPrompt) args.push(this.options.initialPrompt);

    const child = spawn(python, args, {
      stdio: ["pipe", "pipe", "pipe"],
      // HF_HUB_OFFLINE: モデルは事前DL前提でネットへ取りに行かせない。
      env: { ...process.env, HF_HUB_OFFLINE: "1", PYTHONUNBUFFERED: "1" },
    });
    this.child = child;
    child.on("error", (e) => this.options.onError?.(`Python起動失敗: ${e.message}`));
    child.on("close", () => {
      // 応答待ちが残っていれば解放（録音側を固めない）
      this.pending?.({ error: "Python が終了しました" });
      this.pending = null;
    });
    // stderr は tqdm 進捗等。データ扱いせず破棄する。
    child.stderr?.resume();

    this.rl = createInterface({ input: child.stdout! });
    this.rl.on("line", (line) => this.handleLine(line));

    this.pollTimer = setInterval(() => void this.poll(false), this.pollMs);
  }

  private handleLine(line: string): void {
    let obj: { ready?: boolean; text?: string; error?: string };
    try {
      obj = JSON.parse(line);
    } catch {
      return; // JSON 以外（万一の混入）は無視
    }
    if (obj.ready) {
      this.ready = true;
      this.options.onReady?.();
      return;
    }
    const resolve = this.pending;
    this.pending = null;
    resolve?.(obj);
  }

  private transcribeOne(path: string): Promise<{ text?: string; error?: string }> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (r: { text?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(
        () => done({ error: "文字起こしがタイムアウトしました" }),
        this.perClipTimeoutMs,
      );
      this.pending = done;
      this.child?.stdin?.write(path + "\n");
    });
  }

  private async poll(final: boolean): Promise<void> {
    const files = (await readdir(this.options.segmentDir).catch(() => []))
      .filter((f) => SEG_RE.test(f))
      .sort((a, b) => segIndex(a) - segIndex(b));
    // 最新番号は書き込み中の可能性があるため通常は除外。stop 時のみ全件。
    const finalized = final ? files.length : Math.max(0, files.length - 1);
    for (let i = 0; i < finalized; i++) {
      const f = files[i]!;
      if (!this.queued.has(f)) {
        this.queued.add(f);
        this.queue.push(f);
      }
    }
    this.kick();
  }

  private kick(): void {
    if (!this.drainPromise) {
      this.drainPromise = this.drain().finally(() => {
        this.drainPromise = null;
      });
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0 && this.child) {
      const file = this.queue.shift()!;
      const full = join(this.options.segmentDir, file);
      const info = await stat(full).catch(() => null);
      if (!info) continue;
      if (info.size < this.minBytes) {
        await unlink(full).catch(() => {});
        continue;
      }
      const r = await this.transcribeOne(full);
      if (r.error) this.options.onError?.(r.error);
      else if (r.text) this.options.onText(r.text);
      await unlink(full).catch(() => {});
    }
  }

  /** 録音停止時に呼ぶ。残りセグメントを処理し、Python を終了する。 */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.poll(true);
    await this.drainPromise;
    this.rl?.close();
    this.rl = null;
    this.child?.stdin?.end();
    this.child?.kill();
    this.child = null;
  }
}
