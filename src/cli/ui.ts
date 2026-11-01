import pc from "picocolors";
import { MidtransError } from "../core/errors.js";
import type { Environment } from "../core/config.js";

/** Print any error nicely (Midtrans-aware) and set a failing exit code hint. */
export function printError(error: unknown): void {
  if (error instanceof MidtransError) {
    console.error(pc.red(`✗ ${error.toDisplay()}`));
  } else if (error instanceof Error) {
    console.error(pc.red(`✗ ${error.message}`));
  } else {
    console.error(pc.red(`✗ ${String(error)}`));
  }
  console.error(pc.dim("Need help? Run `midtrans docs` or `midtrans doctor`."));
}

export function envBanner(environment: Environment): string {
  return environment === "production"
    ? pc.bgRed(pc.bold(" PRODUCTION "))
    : pc.bgGreen(pc.black(pc.bold(" SANDBOX ")));
}

export function kv(label: string, value: string): void {
  console.error(`${pc.dim(label.padEnd(18))} ${value}`);
}
