// apps/loadgen as a child process (its own event loop and worker threads, like a separate machine). Its JSON lines
// are collected; `stop()` ends a `hold --duration 0` run and returns the final report.
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { REPO } from "./stack";

export type Line = { event: string } & Record<string, unknown>;

export class LoadRun {
  readonly lines: Line[] = [];
  private exited: Promise<number>;
  private stderr = "";

  private constructor(private child: ChildProcess) {
    let buf = "";
    child.stdout!.on("data", (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const text = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (text.startsWith("{")) this.lines.push(JSON.parse(text) as Line);
      }
    });
    child.stderr!.on("data", (d: Buffer) => (this.stderr = (this.stderr + d.toString()).slice(-8000)));
    this.exited = new Promise((r) => child.on("close", (code) => r(code ?? -1)));
  }

  /** `node --import tsx apps/loadgen/src/cli.ts <args>` against the local stack. */
  static start(args: string[], env: Record<string, string>): LoadRun {
    const cwd = join(REPO, "apps", "loadgen");
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    return new LoadRun(child);
  }

  async waitFor(event: string, timeoutMs: number): Promise<Line> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = this.lines.find((l) => l.event === event);
      if (found) return found;
      const report = this.lines.find((l) => l.event === "report");
      if (report) throw new Error(`loadgen ended before "${event}": ${JSON.stringify(report)}`);
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`loadgen: no "${event}" within ${timeoutMs} ms. stderr:\n${this.stderr}`);
  }

  /** Ends the run (a `hold` waits for "stop" on stdin) and returns its report and exit code. */
  async stop(): Promise<{ code: number; report: Line }> {
    this.child.stdin!.end("stop\n");
    return this.finish();
  }

  /** Waits for a run with a fixed duration to end. */
  async finish(): Promise<{ code: number; report: Line }> {
    const code = await this.exited;
    const report = this.lines.find((l) => l.event === "report");
    if (!report) throw new Error(`loadgen exited ${code} without a report. stderr:\n${this.stderr}`);
    return { code, report };
  }
}
