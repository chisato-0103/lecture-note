import { spawn } from "node:child_process";

export type ExecResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export type ExecOptions = {
  /** 標準入力に流し込む文字列（コマンドライン引数を経由しないので安全・長文可） */
  input?: string;
  /** タイムアウト(ms)。超過したらプロセスを kill して reject する */
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

/**
 * 子プロセスを spawn し、stdout/stderr を収集して返す。
 * input は stdin 経由で渡す（shell 文字列連結をしないためコマンドインジェクションを避けられる）。
 */
export function execCommand(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env ?? process.env });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, options.timeoutMs);
    }

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`コマンドがタイムアウトしました (${options.timeoutMs}ms): ${command}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}
