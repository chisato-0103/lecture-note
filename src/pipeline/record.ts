import { spawn, type ChildProcess } from "node:child_process";
import { rename, stat } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execCommand } from "../util/exec.js";

export type AudioDevice = { index: number; name: string };

/**
 * `ffmpeg -f avfoundation -list_devices true -i ""` の stderr 出力から
 * オーディオ入力デバイス一覧を取り出す。
 * 「AVFoundation audio devices:」以降の `[N] 名前` 行のみを対象にする。
 */
export function parseAvfoundationAudioDevices(stderr: string): AudioDevice[] {
  const lines = stderr.split("\n");
  const devices: AudioDevice[] = [];
  let inAudioSection = false;

  for (const line of lines) {
    if (line.includes("AVFoundation audio devices:")) {
      inAudioSection = true;
      continue;
    }
    if (line.includes("AVFoundation video devices:")) {
      inAudioSection = false;
      continue;
    }
    if (!inAudioSection) continue;

    const m = line.match(/\[(\d+)\]\s+(.+?)\s*$/);
    if (m) {
      devices.push({ index: Number(m[1]), name: m[2]! });
    }
  }
  return devices;
}

/**
 * デバイス名から index を解決する。完全一致を優先し、無ければ部分一致。
 */
export function resolveDeviceIndex(devices: AudioDevice[], name: string): number | undefined {
  const exact = devices.find((d) => d.name === name);
  if (exact) return exact.index;
  const partial = devices.find((d) => d.name.includes(name));
  return partial?.index;
}

/**
 * ffprobe で音声ファイルの長さ(秒)を取得する。
 * ffprobe 未導入や解析不能時は null を返し、検証はスキップする（録音自体は失敗させない）。
 */
export async function probeDurationSeconds(path: string): Promise<number | null> {
  try {
    const res = await execCommand(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      { timeoutMs: 15000 },
    );
    if (res.code !== 0) return null;
    const v = Number.parseFloat(res.stdout.trim());
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** マイク入力デバイス一覧を取得する */
export async function listAudioDevices(): Promise<AudioDevice[]> {
  // list_devices は非ゼロ終了かつ stderr に出力するため code は無視する
  const res = await execCommand(
    "ffmpeg",
    ["-f", "avfoundation", "-list_devices", "true", "-i", ""],
    { timeoutMs: 15000 },
  ).catch((e: unknown) => {
    throw new Error(`デバイス一覧の取得に失敗しました: ${e instanceof Error ? e.message : e}`);
  });
  return parseAvfoundationAudioDevices(res.stderr);
}

/** astats の ametadata 行から Peak/RMS の dB 値を取り出す。無音時の -inf は -90dB に丸める。 */
export function parseAstatsLevel(line: string): { kind: "peak" | "rms"; db: number } | null {
  const m = line.match(/(Peak|RMS)_level=(-?inf|-?[\d.]+)/);
  if (!m) return null;
  const db = m[2]!.includes("inf") ? -90 : Number(m[2]);
  if (!Number.isFinite(db)) return null;
  return { kind: m[1] === "Peak" ? "peak" : "rms", db };
}

/** dBFS(約 -60〜0) を 0..1 に線形マップする（レベルバー表示用）。 */
export function dbToLevel(db: number): number {
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

export type RecorderOptions = {
  /** 入力デバイス名（index へ解決する） */
  deviceName: string;
  /** 出力先 .wav パス */
  outPath: string;
  /** サンプルレート（既定 16000＝Whisper ネイティブ） */
  sampleRate?: number;
  /** ライブ字幕用セグメントの出力ディレクトリ。指定時のみセグメント出力を追加する */
  segmentDir?: string;
  /** セグメント長（秒・既定 5） */
  segmentSeconds?: number;
  /** 音声入力レベル通知（録音生存の確認用）。指定時のみ astats 出力を追加する */
  onLevel?: (level: { peakDb: number; rmsDb: number; level: number }) => void;
};

/**
 * ffmpeg(avfoundation) でマイクを録音する。
 * 録音中は outPath + ".part" に書き、stop() 後に長さを検証して正式名へ rename する（atomic）。
 */
const STDERR_TAIL_MAX = 4000;
/** これ未満の長さは「実質無音／破損」とみなして失敗扱いにする（秒） */
const MIN_RECORDING_SEC = 0.5;

export class Recorder {
  private child: ChildProcess | null = null;
  private partPath: string;
  private startedAt: Date | null = null;
  private closed = false;
  private exitCode: number | null = null;
  private stderrTail = "";
  private spawnError: Error | null = null;
  /** spawn 時に張る close 待ち（後付けにすると取りこぼすため） */
  private closePromise: Promise<void> | null = null;
  /** レベル解析用の行バッファと直近 Peak 値 */
  private levelBuf = "";
  private lastPeakDb = -90;

  constructor(private readonly options: RecorderOptions) {
    this.partPath = `${options.outPath}.part`;
  }

  get isRecording(): boolean {
    return this.child !== null && !this.closed;
  }

  get elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt.getTime() : 0;
  }

  async start(): Promise<void> {
    if (this.child) throw new Error("すでに録音中です");

    const devices = await listAudioDevices();
    const index = resolveDeviceIndex(devices, this.options.deviceName);
    if (index === undefined) {
      const names = devices.map((d) => `[${d.index}] ${d.name}`).join(", ");
      throw new Error(
        `入力デバイスが見つかりません: ${this.options.deviceName}（利用可能: ${names || "なし"}）`,
      );
    }

    await mkdir(dirname(this.partPath), { recursive: true });
    if (this.options.segmentDir) {
      await mkdir(this.options.segmentDir, { recursive: true });
    }

    const sr = this.options.sampleRate ?? 16000;
    // 入力（マイク）は1回だけ開く。複数出力へ暗黙 fan-out されるためマイクの2重オープンは不要。
    const args = ["-f", "avfoundation", "-i", `:${index}`];
    // 出力A: 連続WAV（従来と完全同一・バッチ文字起こし用）。
    // .part 拡張子のため -f wav でフォーマットを明示（拡張子から推測させない）
    args.push("-map", "0:a", "-ac", "1", "-ar", String(sr), "-f", "wav", "-y", this.partPath);
    // 出力B: ライブ字幕用の数秒セグメント（揮発）。segmentDir 指定時のみ。
    if (this.options.segmentDir) {
      const sec = this.options.segmentSeconds ?? 5;
      args.push(
        "-map", "0:a", "-ac", "1", "-ar", String(sr),
        "-f", "segment", "-segment_time", String(sec),
        "-reset_timestamps", "1", "-segment_format", "wav", "-y",
        join(this.options.segmentDir, "seg_%03d.wav"),
      );
    }
    const wantLevel = !!this.options.onLevel;
    if (wantLevel) {
      // 出力C: 音声レベル（astats メタデータを stdout に出す。録音生存の確認用）。
      // stdout は必ず drain する（読まないと detached プロセスが固まり q も効かなくなる）。
      args.push(
        "-map", "0:a", "-af",
        "asetnsamples=n=4800:p=1,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level+RMS_level,ametadata=mode=print:file=-:direct=1",
        "-f", "null", "-",
      );
    }
    // detached: 別プロセスグループにし、ターミナルの Ctrl-C(SIGINT) が
    // ffmpeg に直接飛んで graceful 停止(q)前に死ぬのを防ぐ
    const child = spawn("ffmpeg", args, {
      detached: true,
      stdio: ["pipe", wantLevel ? "pipe" : "ignore", "pipe"],
    });
    this.child = child;
    this.startedAt = new Date();
    if (wantLevel) this.attachLevelParser(child);

    // stderr を保持してエラー原因を分かるようにする
    child.stderr?.on("data", (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-STDERR_TAIL_MAX);
    });
    // close 監視は spawn 時に張る（stop() で後付けすると即死を取りこぼす）
    this.closePromise = new Promise<void>((resolve) => {
      child.once("close", (code) => {
        this.closed = true;
        this.exitCode = code;
        resolve();
      });
    });
    child.once("error", (err) => {
      this.closed = true;
      this.spawnError = err;
    });

    // 起動直後に即死していないか確認（マイク権限拒否・デバイス不正などを早期検出）
    await new Promise((r) => setTimeout(r, 800));
    if (this.closed) {
      this.child = null;
      throw new Error(`録音を開始できませんでした。${this.failureDetail()}`);
    }
  }

  /**
   * 録音を停止し、ファイルを検証して正式名にリネームする。
   * @returns 確定した録音ファイルのパス
   */
  async stop(): Promise<string> {
    const child = this.child;
    if (!child) throw new Error("録音していません");

    if (!this.closed) {
      // ffmpeg は stdin の 'q' で graceful にファイルを finalize する
      child.stdin?.write("q");
      child.stdin?.end();
    }
    // spawn 時に張った close 待ち（既に閉じていれば即解決済み）
    await this.closePromise;
    this.child = null;

    const info = await stat(this.partPath).catch(() => null);
    if (!info || info.size === 0) {
      throw new Error(
        `録音ファイルが空です。マイク権限や入力レベルを確認してください。${this.failureDetail()}`,
      );
    }

    // ffprobe で長さを検証（破損・ヘッダのみの壊れファイルはサイズ非0でも弾く）。
    // throw 時は rename しないため、部分ファイル(.part)はそのまま保全される。
    const durationSec = await probeDurationSeconds(this.partPath);
    if (durationSec !== null && durationSec < MIN_RECORDING_SEC) {
      throw new Error(
        `録音がほぼ空です（約${durationSec.toFixed(1)}秒）。マイク権限や入力レベルを確認してください。` +
          `部分ファイルを保全しました: ${this.partPath}。${this.failureDetail()}`,
      );
    }

    await rename(this.partPath, this.options.outPath);
    return this.options.outPath;
  }

  /** ffmpeg stdout の astats メタデータを行単位で解析し、onLevel に通知する。 */
  private attachLevelParser(child: ChildProcess): void {
    child.stdout?.on("data", (d: Buffer) => {
      this.levelBuf += d.toString();
      let nl = this.levelBuf.indexOf("\n");
      while (nl >= 0) {
        const line = this.levelBuf.slice(0, nl);
        this.levelBuf = this.levelBuf.slice(nl + 1);
        const parsed = parseAstatsLevel(line);
        if (parsed) {
          if (parsed.kind === "peak") {
            this.lastPeakDb = parsed.db;
          } else {
            this.options.onLevel?.({
              peakDb: this.lastPeakDb,
              rmsDb: parsed.db,
              level: dbToLevel(this.lastPeakDb),
            });
          }
        }
        nl = this.levelBuf.indexOf("\n");
      }
    });
  }

  /** 失敗時の診断メッセージ（終了コード＋ffmpeg stderr 末尾） */
  private failureDetail(): string {
    const parts: string[] = [];
    if (this.spawnError) parts.push(`起動エラー: ${this.spawnError.message}`);
    if (this.exitCode !== null) parts.push(`ffmpeg終了コード=${this.exitCode}`);
    const tail = this.stderrTail.trim().split("\n").slice(-4).join(" / ");
    if (tail) parts.push(`stderr: ${tail}`);
    return parts.join(" ");
  }
}
