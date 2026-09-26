// scripts/claude/test-related.mjs: after each edit, run the tests related to the edited file.
// Exit code 2 sends the output back to Claude Code, so it deals with the failure before moving on.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
if (!existsSync('turbo.json')) process.exit(0);                      // before Phase 1: nothing to test
const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path ?? '';
let cmd = null;
if (/\.lua$/.test(file)) cmd = 'pnpm --filter @pehchaan/relay test:integration';   // Lua runs only in Valkey
else if (/\.(ts|tsx|js|mjs)$/.test(file) && !file.includes('node_modules'))
  cmd = `pnpm exec vitest related --run --passWithNoTests "${file}"`;
if (!cmd) process.exit(0);
try {
  execSync(cmd, { stdio: 'pipe', timeout: 280_000, maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  process.stderr.write(('Related tests fail. If you just wrote them (red step), implement next; ' +
    'otherwise fix the regression now. Never weaken a test.\n' +
    `${e.stdout ?? ''}${e.stderr ?? ''}`).slice(-8000));
  process.exit(2);
}
