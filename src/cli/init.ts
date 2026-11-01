import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { Command } from "commander";

const FLAVORS = ["nextjs", "express"] as const;
type Flavor = (typeof FLAVORS)[number];

const NEXT_STEPS: Record<Flavor, string> = {
  nextjs: `
1. Copy the generated files into your Next.js App Router project
   (or start one with: npx create-next-app@latest my-shop)
2. cp .env.example .env.local  →  fill in your keys (midtrans login stores them too)
3. npm install (nothing extra needed — the template only uses Next.js + Node built-ins)
4. Put  <PayButton itemId="tshirt" label="Buy T-shirt (Rp 50.000)" />  on a page
5. npm run dev, click the button, pay with test card 4811 1111 1111 1114 (OTP 112233)
6. Test your webhook handler locally:
     midtrans webhook:test --url http://localhost:3000/api/payment/webhook

Security notes baked into this template:
  - Amounts are resolved SERVER-SIDE from lib/prices.ts — never trust a client amount
  - The webhook verifies sha512(order_id+status_code+gross_amount+server_key)
  - Orders are registered BEFORE the Snap token is created (audit trail)
  - Settling is idempotent — Midtrans retries won't double-fulfill`,
  express: `
1. In the target directory:  npm init -y  &&  npm i express
2. Make sure package.json has  "type": "module"
3. cp .env.example .env  →  fill in your keys (midtrans login stores them too)
4. node --env-file=.env server.js
5. Open http://localhost:3000 — buy, pay with test card 4811 1111 1111 1114 (OTP 112233)
6. Test your webhook handler locally:
     midtrans webhook:test --url http://localhost:3000/api/payment/webhook

Security notes baked into this template:
  - Amounts are resolved SERVER-SIDE from the PRICES table — never trust a client amount
  - The webhook verifies sha512(order_id+status_code+gross_amount+server_key)
  - Orders are registered BEFORE the Snap token is created (audit trail)
  - Settling is idempotent — Midtrans retries won't double-fulfill`,
};

function templatesRoot(): string {
  // dist/cli/init.js → <pkg>/templates   ·   src/cli/init.ts (tsx) → <pkg>/templates
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../templates");
}

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(join(dir, entry.name));
    else n++;
  }
  return n;
}

export const initCommand = new Command("init")
  .description(`Scaffold a working Midtrans integration (${FLAVORS.join(" | ")}) with hardened defaults`)
  .argument("<flavor>", `template flavor: ${FLAVORS.join(" | ")}`)
  .option("--dir <path>", "target directory", ".")
  .option("--force", "overwrite existing files")
  .action((flavor: string, options: { dir: string; force?: boolean }) => {
    if (!FLAVORS.includes(flavor as Flavor)) {
      console.error(pc.red(`✗ Unknown flavor "${flavor}". Choose one of: ${FLAVORS.join(", ")}`));
      process.exitCode = 1;
      return;
    }

    const source = join(templatesRoot(), flavor);
    if (!existsSync(source)) {
      console.error(pc.red(`✗ Template not found at ${source} (package installed correctly?)`));
      process.exitCode = 1;
      return;
    }

    const target = resolve(options.dir);
    mkdirSync(target, { recursive: true });

    const existing = existsSync(target) ? countFiles(target) : 0;
    if (existing > 0 && !options.force) {
      console.error(
        pc.yellow(`⚠ Target directory is not empty (${existing} file${existing === 1 ? "" : "s"}).\n` +
          `  Existing files are kept; new files are added. Use --force to overwrite.`),
      );
    }

    cpSync(source, target, {
      recursive: true,
      force: Boolean(options.force),
      errorOnExist: false,
      dereference: true,
    });

    console.error(pc.green(`✓ ${flavor} template written → ${target}`));
    console.error(NEXT_STEPS[flavor as Flavor]);
  });
