import { readFileSync } from "node:fs";
import readline from "node:readline/promises";

/**
 * Piped-stdin support: Node's readline.question() never resolves once the
 * input stream has ended, so sequential prompts over a pipe silently die.
 * For non-TTY input we instead read ALL of stdin once and hand out lines
 * from a queue — the classic behavior scripts expect.
 */
let pipedLines: string[] | null = null;

function nextPipedLine(): string {
  if (pipedLines === null) {
    pipedLines = readFileSync(0, "utf8").split(/\r?\n/);
    if (pipedLines[pipedLines.length - 1] === "") pipedLines.pop();
  }
  return pipedLines.shift() ?? "";
}

/** Visible text prompt. */
export async function promptText(question: string, defaultValue?: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const answer = nextPipedLine().trim();
    return answer || defaultValue || "";
  }
  const suffix = defaultValue !== undefined ? ` (${defaultValue})` : "";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue || "";
  } finally {
    rl.close();
  }
}

/**
 * Secret prompt that hides input with `*` (server keys should never be
 * shoulder-surfed). Piped input is read plainly (scripts own their pipes).
 */
export async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return nextPipedLine().trim();
  }

  return new Promise<string>((resolve) => {
    process.stdout.write(`${question}: `);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let input = "";
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n") {
        process.stdin.removeListener("data", onData);
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(input.trim());
        return;
      }
      if (ch === "\u0003") {
        // Ctrl+C
        process.stdout.write("\n");
        process.exit(130);
      }
      if (ch === "\u007f" || ch === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      if (ch >= " ") {
        input += ch;
        process.stdout.write("*");
      }
    };
    process.stdin.on("data", onData);
  });
}

/** y/n confirmation. `defaultYes` controls what plain Enter answers. */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  if (!process.stdin.isTTY) {
    const answer = nextPipedLine().trim().toLowerCase();
    if (answer === "") return defaultYes;
    return answer === "y" || answer === "yes";
  }
  const hint = defaultYes ? "Y/n" : "y/N";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
    if (answer === "") return defaultYes;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
