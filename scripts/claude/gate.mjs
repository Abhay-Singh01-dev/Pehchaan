// scripts/claude/gate.mjs: when Claude Code tries to finish, run the fast gate. If it is red, send Claude
// back to work, up to 3 times in a row (a counter prevents an endless loop), then let it stop and report.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
if (!existsSync('turbo.json')) process.exit(0);
readFileSync(0, 'utf8');                                              // consume the hook input
const counter = '.claude/.gate-blocks';
try {
  execSync('pnpm turbo run lint typecheck test build', { stdio: 'pipe', timeout: 850_000, maxBuffer: 64 * 1024 * 1024 });
  rmSync(counter, { force: true });
} catch (e) {
  const n = (existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0) + 1;
  if (n > 3) { rmSync(counter, { force: true }); process.exit(0); } // give up blocking; the report must say "gate red"
  mkdirSync('.claude', { recursive: true });
  writeFileSync(counter, String(n));
  process.stderr.write((`The fast gate (lint, typecheck, test, build) is red (attempt ${n}/3). Keep working and fix it.\n` +
    (e.stdout ?? '') + (e.stderr ?? '')).slice(-8000));
  process.exit(2);
}
