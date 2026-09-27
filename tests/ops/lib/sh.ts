// Running Docker, Git Bash and the repo's CLIs from the ops tests. Output is captured, never printed, unless a
// command fails (then it is part of the assertion message).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  timeoutMs?: number;
}

export function run(cmd: string, args: string[], o: RunOptions = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: o.cwd,
      env: { ...process.env, ...o.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill(), o.timeoutMs ?? 10 * 60_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(o.input ?? "");
  });
}

/** Runs and throws with the output when the exit code isn't 0. */
export async function ok(cmd: string, args: string[], o: RunOptions = {}): Promise<string> {
  const r = await run(cmd, args, o);
  if (r.code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.code}\n${r.stdout.slice(-4000)}\n${r.stderr.slice(-4000)}`);
  }
  return r.stdout;
}

export const docker = (args: string[], o: RunOptions = {}) => ok("docker", args, o);

/** bash: Git Bash on Windows (deploy.sh and the backup scripts are bash), the system bash elsewhere. */
export function bashPath(): string {
  const git = "C:\\Program Files\\Git\\bin\\bash.exe";
  return process.platform === "win32" && existsSync(git) ? git : "bash";
}

/** A path as bash on this machine understands it. */
export const posix = (p: string) => p.replace(/\\/g, "/");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
