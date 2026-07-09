import {
  app,
  Tray,
  Menu,
  Notification,
  shell,
  nativeImage,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  powerMonitor,
} from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInitialPrompt, type AppConfig } from "../config.js";
import { loadConfig, saveConfig } from "../configStore.js";
import { Recorder, listAudioDevices } from "../pipeline/record.js";
import { processPendingJobs } from "../pipeline/pendingJobs.js";
import { writeJobMeta } from "../pipeline/jobMeta.js";
import { checkDependencies, checkLiveCaptionDeps } from "../pipeline/deps.js";
import { formatTimestamp } from "../util/files.js";
import { LiveTranscriber } from "../pipeline/liveTranscribe.js";
import { LiveCaptionFilter } from "../pipeline/liveCaption.js";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, "..", "..", "assets");
const scriptsDir = join(here, "..", "..", "scripts");

type AppState = "idle" | "recording" | "processing";

let tray: Tray | null = null;
let settingsWin: BrowserWindow | null = null;
let captionWin: BrowserWindow | null = null;
let liveTranscriber: LiveTranscriber | null = null;
/** 字幕テキストの表示状態（録音中トグル）。音声レベルのモニタは常に表示する。 */
let captionTextEnabled = true;
let state: AppState = "idle";
let recorder: Recorder | null = null;
let elapsedTimer: NodeJS.Timeout | null = null;
let config: AppConfig;

let currentJob: { outDir: string; audioPath: string; materialPaths: string[] } | null = null;
/** 次の録音に添付する授業資料（録音開始時に確定） */
let pendingMaterials: string[] = [];

/** 録音中フォルダ（背景処理の対象から除外する）。 */
let activeRecordingDir: string | null = null;
/** 背景ジョブ処理の多重実行ガード。 */
let jobRunning = false;
let jobRerun = false;

const idleIcon = nativeImage.createFromPath(join(assetsDir, "iconTemplate.png"));
idleIcon.setTemplateImage(true);
const recordingIcon = nativeImage.createFromPath(join(assetsDir, "iconRecording.png"));

function configPath(): string {
  return join(app.getPath("userData"), "config.json");
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function setState(next: AppState): void {
  state = next;
  tray?.setImage(state === "recording" ? recordingIcon : idleIcon);
  rebuildMenu();
}

function elapsedLabel(): string {
  if (!recorder) return "";
  const sec = Math.floor(recorder.elapsedMs / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `録音中 ${m}:${s}`;
}

function rebuildMenu(): void {
  if (!tray) return;
  const items: Electron.MenuItemConstructorOptions[] = [];

  if (state === "idle") {
    items.push({ label: "● 録音開始", click: () => void startRecording() });
    const matLabel =
      pendingMaterials.length > 0
        ? `授業資料: ${pendingMaterials.length}件添付中（変更…）`
        : "授業資料を添付…";
    items.push({ label: matLabel, click: () => void chooseMaterials() });
    if (pendingMaterials.length > 0) {
      items.push({ label: "  添付を解除", click: () => { pendingMaterials = []; rebuildMenu(); } });
    }
  } else if (state === "recording") {
    items.push({ label: elapsedLabel(), enabled: false });
    items.push({
      label: "字幕テキストを表示",
      type: "checkbox",
      checked: captionTextEnabled,
      click: () => setCaptionText(!captionTextEnabled),
    });
    items.push({ label: "■ 停止してノート化", click: () => void stopAndProcess() });
  } else {
    items.push({ label: "処理中 …", enabled: false });
  }

  items.push({ type: "separator" });
  items.push({ label: "設定 …", enabled: state !== "processing", click: openSettings });
  items.push({
    label: "保存フォルダを開く",
    click: () => void shell.openPath(config.outputRoot),
  });
  items.push({ type: "separator" });
  items.push({ label: "終了", role: "quit", enabled: state !== "processing" });

  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(state === "recording" ? elapsedLabel() : "講義ノート");
}

function openSettings(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 440,
    height: 640,
    title: "講義ノート設定",
    webPreferences: {
      preload: join(assetsDir, "preload.cjs"),
      sandbox: false,
      contextIsolation: true,
    },
  });
  void settingsWin.loadFile(join(assetsDir, "settings.html"));
  settingsWin.on("closed", () => {
    settingsWin = null;
  });
}

async function chooseMaterials(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: "授業資料を選択",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "授業資料", extensions: ["pdf", "docx", "doc", "rtf", "txt", "md", "html", "odt"] },
    ],
  });
  if (!result.canceled) {
    pendingMaterials = result.filePaths;
    rebuildMenu();
  }
}

function createCaptionWindow(): void {
  if (captionWin && !captionWin.isDestroyed()) return;
  const { workArea } = screen.getPrimaryDisplay();
  const w = 720;
  const h = 140;
  captionWin = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(workArea.x + (workArea.width - w) / 2),
    y: Math.round(workArea.y + workArea.height - h - 80),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(assetsDir, "preload.cjs"),
      sandbox: false,
      contextIsolation: true,
    },
  });
  // フルスクリーン動画/メニューより前面へ。dock 非表示アプリでのちらつき回避に
  // skipTransformProcessType を付ける。表示はフォーカスを奪わない showInactive。
  captionWin.setAlwaysOnTop(true, "screen-saver");
  captionWin.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  captionWin.setIgnoreMouseEvents(true, { forward: true });
  void captionWin.loadFile(join(assetsDir, "caption.html"));
  captionWin.once("ready-to-show", () => captionWin?.showInactive());
  captionWin.on("closed", () => {
    captionWin = null;
  });
}

function destroyCaptionWindow(): void {
  if (captionWin && !captionWin.isDestroyed()) captionWin.close();
  captionWin = null;
}

function pushCaption(payload: { text?: string; ready?: boolean; error?: string }): void {
  if (captionWin && !captionWin.isDestroyed()) {
    captionWin.webContents.send("caption:text", payload);
  }
}

/** 字幕テキストの表示/非表示をモニタ窓へ伝える。 */
function pushCaptionMode(textVisible: boolean): void {
  if (captionWin && !captionWin.isDestroyed()) {
    captionWin.webContents.send("caption:mode", { textVisible });
  }
}

/** 字幕テキストのオン/オフを反映する（文字起こしの一時停止/再開＋窓表示＋メニュー）。 */
function setCaptionText(enabled: boolean): void {
  captionTextEnabled = enabled;
  if (enabled) liveTranscriber?.resume();
  else liveTranscriber?.pause();
  pushCaptionMode(enabled);
  rebuildMenu();
}

let lastLevelSentAt = 0;
/** 音声レベルを字幕ウィンドウへ送る（IPC負荷を抑えるため約150msに間引く）。 */
function pushLevel(level: { peakDb: number; rmsDb: number; level: number }): void {
  const now = Date.now();
  if (now - lastLevelSentAt < 150) return;
  lastLevelSentAt = now;
  if (captionWin && !captionWin.isDestroyed()) {
    captionWin.webContents.send("caption:level", level.level);
  }
}

/**
 * 録音モニタ（音声レベル）＋ライブ字幕を開始する。失敗しても録音は止めない。
 * 字幕テキストの初期状態は captionTextEnabled に従う（OFF なら文字起こしを一時停止）。
 */
function startLiveCaption(segmentDir: string): void {
  createCaptionWindow();
  // 同じ文字列の連呼（クリップ内ループ・隣接クリップ重複）を抑止する。録音1回で1つ。
  const captionFilter = new LiveCaptionFilter();
  const live = new LiveTranscriber({
    segmentDir,
    scriptPath: join(scriptsDir, "live_transcribe.py"),
    model: config.liveModel,
    initialPrompt: buildInitialPrompt(config.vocabulary),
    onReady: () => pushCaption({ ready: true }),
    onText: (text) => {
      const shown = captionFilter.filter(text);
      if (shown) pushCaption({ text: shown });
    },
    onError: (message) => pushCaption({ error: message }),
  });
  liveTranscriber = live;
  // 字幕OFF開始なら文字起こしを止めておく（レベルバーは Recorder から常時流れる）。
  if (!captionTextEnabled) live.pause();
  // レンダラーの読込完了後に初期表示状態を送る（取りこぼし防止）。
  captionWin?.webContents.once("did-finish-load", () => pushCaptionMode(captionTextEnabled));
  live.start().catch((err) => pushCaption({ error: errorMessage(err) }));
}

/** ライブ字幕を停止する（残りセグメントを flush し Python を終了）。 */
async function stopLiveCaption(): Promise<void> {
  const live = liveTranscriber;
  liveTranscriber = null;
  if (live) await live.stop().catch(() => {});
  destroyCaptionWindow();
}

async function startRecording(): Promise<void> {
  if (state !== "idle") return;
  const startedAt = new Date();
  const outDir = join(config.outputRoot, `${formatTimestamp(startedAt)}_録音`);
  const audioPath = join(outDir, "録音.wav");
  const segmentDir = join(outDir, "live");

  // 録音モニタ（レベルバー＋セグメント）は常に用意する。字幕テキストのオン/オフは
  // 録音中にトグルできるため、ffmpeg 側の出力は最初から出しておく必要がある。
  recorder = new Recorder({
    deviceName: config.deviceName,
    outPath: audioPath,
    segmentDir,
    onLevel: pushLevel,
  });
  try {
    await recorder.start();
  } catch (err) {
    recorder = null;
    notify("録音を開始できません", errorMessage(err));
    return;
  }

  currentJob = { outDir, audioPath, materialPaths: pendingMaterials };
  activeRecordingDir = outDir;
  pendingMaterials = [];
  setState("recording");
  elapsedTimer = setInterval(rebuildMenu, 1000);

  // 字幕テキストの初期表示状態は設定 liveCaption（＝最初からオンにするか）に従う。
  captionTextEnabled = config.liveCaption;
  startLiveCaption(segmentDir);
}

/** claude（クラウド）利用時、未同意なら同意ダイアログを出す。許可なら true */
async function ensureCloudConsent(): Promise<boolean> {
  if (config.engine !== "claude" || config.cloudConsent) return true;
  const { response: r2, checkboxChecked } = await dialog.showMessageBox({
    type: "warning",
    buttons: ["同意して続行", "キャンセル"],
    defaultId: 0,
    cancelId: 1,
    title: "クラウド要約の確認",
    message: "要約のため文字起こしを claude（クラウド）へ送信します。",
    detail: "講義内容が外部に送られます。ローカルのみで使いたい場合は設定で ollama を選んでください。",
    checkboxLabel: "今後確認しない",
    checkboxChecked: false,
  });
  if (r2 !== 0) return false;
  if (checkboxChecked) {
    config.cloudConsent = true;
    await saveConfig(configPath(), config).catch(() => {});
  }
  return true;
}

async function stopAndProcess(): Promise<void> {
  if (state !== "recording" || !recorder || !currentJob) return;
  const { outDir, materialPaths } = currentJob;

  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  setState("processing");

  try {
    await recorder.stop();
    recorder = null;
    await stopLiveCaption();
    await rm(join(outDir, "live"), { recursive: true, force: true }).catch(() => {});

    // 要約の同意（claude 初回のみ。ユーザーがその場にいるので一瞬）。
    // 拒否時は cloudConsent が false のままなので、背景では文字起こしまでで保留になる。
    await ensureCloudConsent();

    // 背景要約に使う情報だけ保存（語彙・エンジン等は処理時の現在設定を使う）。
    await writeJobMeta(outDir, {
      recordedAt: new Date().toISOString(),
      materialPaths,
    });

    notify("録音を保存しました", "文字起こし・要約はバックグラウンドで進みます（フタを閉じてOK）");
  } catch (err) {
    notify("録音の保存に失敗しました", errorMessage(err));
  } finally {
    recorder = null;
    currentJob = null;
    activeRecordingDir = null;
    destroyCaptionWindow();
    if (liveTranscriber) {
      void liveTranscriber.stop().catch(() => {});
      liveTranscriber = null;
    }
    setState("idle");
  }

  // idle に戻してから背景処理をキック（その場で待てば従来どおり完成する）。
  void runPendingJobsGuarded();
}

/**
 * 保留ジョブ処理を多重起動させずに走らせる。
 * 実行中に再要求（起動時＋復帰が重なる等）が来たら、現在の周回終了後にもう一度走査する。
 */
async function runPendingJobsGuarded(): Promise<void> {
  if (jobRunning) {
    jobRerun = true;
    return;
  }
  jobRunning = true;
  try {
    do {
      jobRerun = false;
      await processPendingJobs({
        outputRoot: config.outputRoot,
        config,
        excludeDir: activeRecordingDir ?? undefined,
        notify,
      }).catch((err) => notify("後処理でエラー", errorMessage(err)));
    } while (jobRerun);
  } finally {
    jobRunning = false;
  }
}

function registerIpc(): void {
  ipcMain.handle("config:get", () => config);
  ipcMain.handle("config:save", async (_e, next: AppConfig) => {
    config = next;
    await saveConfig(configPath(), config);
    rebuildMenu();
  });
  ipcMain.handle("devices:list", () => listAudioDevices().catch(() => []));
  ipcMain.handle("deps:check", async () => {
    const base = await checkDependencies(config.engine);
    if (!config.liveCaption) return base;
    const live = await checkLiveCaptionDeps(config.liveModel).catch(() => []);
    return [...base, ...live];
  });
}

async function startupDependencyCheck(): Promise<void> {
  const results = await checkDependencies(config.engine).catch(() => []);
  const missing = results.filter((r) => !r.ok);
  if (missing.length > 0) {
    notify(
      "依存コマンドが不足しています",
      missing.map((m) => `${m.name}: ${m.hint ?? "未検出"}`).join(" / "),
    );
  }

  // ライブ字幕の依存は欠けても録音・ノートは使えるため、別枠で軽く通知する。
  if (config.liveCaption) {
    const live = await checkLiveCaptionDeps(config.liveModel).catch(() => []);
    const liveMissing = live.filter((r) => !r.ok);
    if (liveMissing.length > 0) {
      notify(
        "ライブ字幕は使えません（録音・ノートは通常どおり）",
        liveMissing.map((m) => `${m.name}: ${m.hint ?? "未検出"}`).join(" / "),
      );
    }
  }
}

app.whenReady().then(async () => {
  app.dock?.hide();
  config = await loadConfig(configPath());

  tray = new Tray(idleIcon);
  registerIpc();
  setState("idle");

  if (process.env.LECTURE_NOTE_SMOKE === "1") {
    console.log("smoke: tray ready");
    openSettings();
    const win = settingsWin;
    if (win) {
      win.webContents.on("did-finish-load", () => console.log("smoke: settings loaded"));
      win.webContents.on("console-message", (_e, _lvl, msg) =>
        console.log(`smoke: renderer log: ${msg}`),
      );
      win.webContents.on("render-process-gone", (_e, d) =>
        console.log(`smoke: renderer gone: ${d.reason}`),
      );
    }
    setTimeout(() => app.quit(), 2500);
    return;
  }

  void startupDependencyCheck();
  // 起動時に未処理の録音を片付ける
  void runPendingJobsGuarded();
  // スリープ復帰時にも走らせる（次の教室でフタを開けた瞬間に文字起こしが進む）
  powerMonitor.on("resume", () => void runPendingJobsGuarded());
});

app.on("window-all-closed", () => {
  // メニューバー常駐なので終了しない（Tray の「終了」で抜ける）
});
