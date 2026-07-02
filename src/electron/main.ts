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
} from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInitialPrompt, type AppConfig } from "../config.js";
import { loadConfig, saveConfig } from "../configStore.js";
import { Recorder, listAudioDevices } from "../pipeline/record.js";
import { transcribe } from "../pipeline/transcribe.js";
import { processTranscript } from "../run.js";
import { makeSummarizer } from "../summarizerFactory.js";
import { checkDependencies, checkLiveCaptionDeps } from "../pipeline/deps.js";
import { loadMaterials } from "../pipeline/material.js";
import { atomicWriteFile, formatTimestamp } from "../util/files.js";
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
let state: AppState = "idle";
let recorder: Recorder | null = null;
let elapsedTimer: NodeJS.Timeout | null = null;
let config: AppConfig;

let currentJob: { outDir: string; audioPath: string; materialPaths: string[] } | null = null;
/** 次の録音に添付する授業資料（録音開始時に確定） */
let pendingMaterials: string[] = [];

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

/** ライブ字幕（録音中の速報文字起こし）を開始する。失敗しても録音は止めない。 */
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

  recorder = new Recorder({
    deviceName: config.deviceName,
    outPath: audioPath,
    segmentDir: config.liveCaption ? segmentDir : undefined,
    onLevel: config.liveCaption ? pushLevel : undefined,
  });
  try {
    await recorder.start();
  } catch (err) {
    recorder = null;
    notify("録音を開始できません", errorMessage(err));
    return;
  }

  currentJob = { outDir, audioPath, materialPaths: pendingMaterials };
  pendingMaterials = [];
  setState("recording");
  elapsedTimer = setInterval(rebuildMenu, 1000);

  if (config.liveCaption) {
    startLiveCaption(segmentDir);
  }
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
  const { outDir, audioPath, materialPaths } = currentJob;

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
    notify("録音停止", "文字起こしを開始します");

    const rawTranscript = await transcribe(audioPath, {
      model: config.whisperModel,
      language: config.language,
      initialPrompt: buildInitialPrompt(config.vocabulary),
      outputDir: outDir,
    });

    // クラウド送信の同意確認（claude のとき）
    const allowed = await ensureCloudConsent();
    if (!allowed) {
      await atomicWriteFile(join(outDir, "文字起こし.txt"), rawTranscript);
      notify("文字起こしのみ保存", "要約はキャンセルされました（クラウド送信を拒否）");
      return;
    }

    const materials = materialPaths.length > 0 ? await loadMaterials(materialPaths) : "";

    const transcriptPath = join(outDir, "文字起こし.txt");
    const notePath = join(outDir, "ノート.md");

    const summarizer = makeSummarizer({ engine: config.engine, model: config.model });
    // 整形済み文字起こしは要約前に確定保存し、要約失敗でも残す
    const { note } = await processTranscript(rawTranscript, summarizer, {
      maxRepeats: config.maxRepeats,
      maxCharsPerChunk: config.maxCharsPerChunk,
      vocabulary: config.vocabulary,
      materials,
      onCleaned: async (cleaned) => {
        await atomicWriteFile(transcriptPath, cleaned);
      },
    });

    await atomicWriteFile(notePath, note);

    notify("ノート完成", notePath);
    await shell.openPath(notePath);
  } catch (err) {
    notify("処理に失敗しました", errorMessage(err));
  } finally {
    recorder = null;
    currentJob = null;
    destroyCaptionWindow();
    if (liveTranscriber) {
      void liveTranscriber.stop().catch(() => {});
      liveTranscriber = null;
    }
    setState("idle");
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
});

app.on("window-all-closed", () => {
  // メニューバー常駐なので終了しない（Tray の「終了」で抜ける）
});
