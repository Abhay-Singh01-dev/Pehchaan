// Prints an Argon2id hash of the Security Lab password (spec 14.1 layer 2, 18.7):
//   pnpm tsx infra/scripts/lab-password-hash.ts
// The password is typed at a hidden prompt (twice), or piped on stdin. Only the hash is printed: put it in the
// relay's .env as LAB_PASSWORD_HASH, in single quotes (it contains `$`). The relay never stores the password.
// Change it after every judging session.
import { randomBytes } from "node:crypto";
import { argon2id } from "hash-wasm";

/** Long enough that 5 guesses per 10 minutes (the relay's limit, 16.1) can't find it. */
const MIN_LENGTH = 12;

/** Reads one line from the terminal without echoing it. */
function hiddenPrompt(label: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stderr.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          // Ctrl-C
          stdin.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** Piped input: the first line. */
async function pipedLine(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  return text.split(/\r?\n/)[0] ?? "";
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return pipedLine();
  const first = await hiddenPrompt("Security Lab password: ");
  const again = await hiddenPrompt("Type it again: ");
  if (first !== again) {
    console.error("The two passwords don't match.");
    process.exit(1);
  }
  return first;
}

const password = await readPassword();
if (password.length < MIN_LENGTH) {
  console.error(`The Lab password must be at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}

// OWASP's Argon2id guidance, with a generous memory cost: the relay checks at most a few passwords a minute.
const hash = await argon2id({
  password,
  salt: randomBytes(16),
  parallelism: 1,
  iterations: 3,
  memorySize: 64 * 1024, // KiB
  hashLength: 32,
  outputType: "encoded",
});
console.log(hash);
