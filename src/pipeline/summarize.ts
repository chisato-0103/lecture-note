import { execCommand } from "../util/exec.js";

export interface Summarizer {
  readonly name: string;
  /** 組み立て済みのメッセージ（指示＋資料）を要約して本文を返す */
  summarize(message: string): Promise<string>;
}

/**
 * ANTHROPIC_API_KEY が設定されていると claude -p が API 従量課金になる恐れがある
 * （サブスク利用のつもりが高額請求になる事故の予防）。
 * allowApiBilling が真でない限り、キーが見えたら実行を止める。
 */
export function assertSafeClaudeAuth(
  env: NodeJS.ProcessEnv,
  allowApiBilling: boolean,
): void {
  // API 従量課金につながり得る認証用の環境変数（サブスク利用なら通常は未設定）
  const billingKey = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
  if (billingKey && !allowApiBilling) {
    throw new Error(
      "ANTHROPIC_API_KEY（または ANTHROPIC_AUTH_TOKEN）が設定されています。claude -p が API 従量課金になる恐れがあります。\n" +
        "サブスク利用なら環境変数を解除してください。意図的に API を使うなら --allow-api を付けてください。",
    );
  }
}

export type ClaudeOptions = {
  /** 使用モデル（未指定なら claude の既定） */
  model?: string;
  /** 実行タイムアウト(ms)。既定 10 分 */
  timeoutMs?: number;
  /** API 従量課金を明示的に許可する */
  allowApiBilling?: boolean;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_CLAUDE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Claude Code のヘッドレスモード `claude -p` で要約する。
 * メッセージは stdin で渡す（引数長制限・インジェクションを避ける）。
 * 前提: Claude Code がサブスクログインであること（API キー認証だと課金される）。
 */
export class ClaudeCliSummarizer implements Summarizer {
  readonly name = "claude";

  constructor(private readonly options: ClaudeOptions = {}) {}

  async summarize(message: string): Promise<string> {
    const env = this.options.env ?? process.env;
    assertSafeClaudeAuth(env, this.options.allowApiBilling ?? false);

    const args = ["-p"];
    if (this.options.model) args.push("--model", this.options.model);

    const res = await execCommand("claude", args, {
      input: message,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_CLAUDE_TIMEOUT_MS,
      env,
    });

    if (res.code !== 0) {
      throw new Error(
        `claude -p が失敗しました (code=${res.code}): ${res.stderr.trim() || "(stderr なし)"}`,
      );
    }
    const out = res.stdout.trim();
    if (out === "") {
      throw new Error("claude -p の出力が空でした");
    }
    return out;
  }
}

export type OllamaOptions = {
  /** 使用モデル（既定 llama3.1） */
  model?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_OLLAMA_MODEL = "llama3.1";
const DEFAULT_OLLAMA_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * 完全ローカルの代替要約エンジン（claude -p が将来有料化した場合の退避先）。
 * `ollama run <model>` にメッセージを stdin で渡す。
 */
export class OllamaSummarizer implements Summarizer {
  readonly name = "ollama";

  constructor(private readonly options: OllamaOptions = {}) {}

  async summarize(message: string): Promise<string> {
    const model = this.options.model ?? DEFAULT_OLLAMA_MODEL;
    const res = await execCommand("ollama", ["run", model], {
      input: message,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS,
      env: this.options.env ?? process.env,
    });
    if (res.code !== 0) {
      throw new Error(
        `ollama run が失敗しました (code=${res.code}): ${res.stderr.trim() || "(stderr なし)"}`,
      );
    }
    const out = res.stdout.trim();
    if (out === "") {
      throw new Error("ollama run の出力が空でした");
    }
    return out;
  }
}
