import readline from "node:readline/promises";

/** Visible text prompt (falls back to plain readline when stdin is not a TTY). */
export async function promptText(question: string, defaultValue?: string): Promise<string> {
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
 * shoulder-surfed). When stdin is not a TTY (piped input), reads plainly.
 */
export async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await rl.question(`${question}: `)).trim();
    } finally {
      rl.close();
    }
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
