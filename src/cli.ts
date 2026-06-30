#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { DEFAULT_CONFIG, buildInitialPrompt, type EngineName } from "./config.js";
import { transcribe } from "./pipeline/transcribe.js";
import { Recorder, listAudioDevices } from "./pipeline/record.js";
import { makeSummarizer } from "./summarizerFactory.js";
import { processTranscript } from "./run.js";
import { loadMaterials } from "./pipeline/material.js";
import { atomicWriteFile, formatTimestamp } from "./util/files.js";

const USAGE = `講義ノート生成 CLI

使い方:
  lecture-note record                   録音→(Ctrl-C で停止)→文字起こし→整形→要約→保存
  lecture-note <音声ファイル>           音声→文字起こし→整形→要約→ノート保存
  lecture-note summarize <文字起こし.txt>  既存の文字起こしから整形→要約→ノート保存
  lecture-note devices                  利用可能なマイク入力デバイス一覧

オプション:
  --device <名前>           録音に使うマイク名（既定: MacBook Airのマイク）
  --seconds <秒>            指定秒数だけ録音して自動停止（テスト用。省略時は Ctrl-C 停止）
  --vocab <用語,用語,...>   固有名詞リスト（文字起こしと要約の両方で誤変換を補正）
  --material <パス>         授業資料(PDF/Word/txt等)を要約の参考に渡す（複数指定可）
  --engine <claude|ollama>  要約エンジン（既定: claude）
  --model <名前>            要約モデル（省略可）
  --out <ディレクトリ>       保存先ルート（既定: ~/Documents/講義ノート）
  --max-repeats <数>        幻聴ループ除去のしきい値（既定: 5）
  --max-chars <数>          1チャンクの最大文字数（既定: 24000）
  --allow-api               ANTHROPIC_API_KEY による API 課金を明示的に許可
  -h, --help               このヘルプ`;

const DEFAULT_DEVICE = "MacBook Airのマイク";

/** Ctrl-C(SIGINT) を1回待つ */
function waitForSigint(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", () => resolve());
  });
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      device: { type: "string" },
      seconds: { type: "string" },
      vocab: { type: "string" },
      material: { type: "string", multiple: true },
      engine: { type: "string" },
      model: { type: "string" },
      out: { type: "string" },
      "max-repeats": { type: "string" },
      "max-chars": { type: "string" },
      "allow-api": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return;
  }

  const engine = (values.engine ?? DEFAULT_CONFIG.engine) as EngineName;
  if (engine !== "claude" && engine !== "ollama") {
    throw new Error(`未知のエンジン: ${engine}（claude か ollama を指定してください）`);
  }
  const outputRoot = values.out ?? DEFAULT_CONFIG.outputRoot;
  const maxRepeats = values["max-repeats"]
    ? Number(values["max-repeats"])
    : DEFAULT_CONFIG.maxRepeats;
  const maxCharsPerChunk = values["max-chars"]
    ? Number(values["max-chars"])
    : DEFAULT_CONFIG.maxCharsPerChunk;
  // 用語集: --vocab 優先、無ければ既定設定（カンマ/読点区切り）
  const vocabulary = values.vocab
    ? values.vocab.split(/[,、]/).map((s) => s.trim()).filter((s) => s.length > 0)
    : DEFAULT_CONFIG.vocabulary;
  const initialPrompt = buildInitialPrompt(vocabulary);
  const materialPaths = values.material ?? [];

  const log = (m: string) => console.error(`[lecture-note] ${m}`);

  // デバイス一覧（要約エンジン不要）
  if (positionals[0] === "devices") {
    const devices = await listAudioDevices();
    for (const d of devices) console.log(`[${d.index}] ${d.name}`);
    return;
  }

  const summarizer = makeSummarizer({
    engine,
    model: values.model,
    allowApiBilling: values["allow-api"] ?? false,
  });

  // サブコマンド判定
  const mode: "record" | "summarize" | "full" =
    positionals[0] === "record" ? "record" : positionals[0] === "summarize" ? "summarize" : "full";

  // 保存先ディレクトリ（録音開始時刻ベース）
  const startedAt = new Date();
  const stamp = formatTimestamp(startedAt);

  let rawTranscript: string;
  let outDir: string;

  if (mode === "record") {
    outDir = join(outputRoot, `${stamp}_録音`);
    const audioPath = join(outDir, "録音.wav");
    const recorder = new Recorder({
      deviceName: values.device ?? DEFAULT_DEVICE,
      outPath: audioPath,
    });
    const seconds = values.seconds ? Number(values.seconds) : undefined;
    await recorder.start();
    if (seconds && seconds > 0) {
      log(`録音開始（${values.device ?? DEFAULT_DEVICE}）。${seconds}秒間録音します...`);
      await new Promise((r) => setTimeout(r, seconds * 1000));
    } else {
      log(`録音開始（${values.device ?? DEFAULT_DEVICE}）。停止するには Ctrl-C`);
      await waitForSigint();
    }
    log("録音停止、検証中 ...");
    await recorder.stop();
    log(`録音保存: ${audioPath}`);

    log(`文字起こし開始（${DEFAULT_CONFIG.whisperModel}）...`);
    rawTranscript = await transcribe(audioPath, {
      model: DEFAULT_CONFIG.whisperModel,
      language: DEFAULT_CONFIG.language,
      initialPrompt,
      outputDir: outDir,
    });
    log("文字起こし完了");
  } else {
    const inputPath = mode === "summarize" ? positionals[1] : positionals[0];
    if (!inputPath) throw new Error("入力ファイルが指定されていません");
    const stem = basename(inputPath, extname(inputPath));
    outDir = join(outputRoot, `${stamp}_${stem}`);

    if (mode === "summarize") {
      log(`文字起こしを読み込み: ${inputPath}`);
      rawTranscript = await readFile(inputPath, "utf8");
    } else {
      log(`文字起こし開始（${DEFAULT_CONFIG.whisperModel}）...`);
      rawTranscript = await transcribe(inputPath, {
        model: DEFAULT_CONFIG.whisperModel,
        language: DEFAULT_CONFIG.language,
        initialPrompt,
        outputDir: outDir,
      });
      log("文字起こし完了");
    }
  }

  // 授業資料を読み込む（あれば）
  let materials = "";
  if (materialPaths.length > 0) {
    log(`授業資料を読み込み: ${materialPaths.join(", ")}`);
    materials = await loadMaterials(materialPaths);
  }

  const transcriptPath = join(outDir, "文字起こし.txt");
  const notePath = join(outDir, "ノート.md");

  // 整形 → 要約。整形済み文字起こしは要約前に確定保存し、要約失敗でも残す
  const { note } = await processTranscript(rawTranscript, summarizer, {
    maxRepeats,
    maxCharsPerChunk,
    vocabulary,
    materials,
    onProgress: log,
    onCleaned: async (cleaned) => {
      await atomicWriteFile(transcriptPath, cleaned);
      log(`文字起こしを保存: ${transcriptPath}`);
    },
  });

  await atomicWriteFile(notePath, note);

  log(`完了: ${notePath}`);
  console.log(notePath);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`エラー: ${message}`);
  process.exit(1);
});
