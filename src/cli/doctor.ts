import { existsSync } from "node:fs";
import { Command } from "commander";
import pc from "picocolors";
import { MidtransClient } from "../core/client.js";
import { configPath, detectEnvironment, loadConfig, maskKey } from "../core/config.js";
import { resolveCredentials } from "../core/config.js";
import { buildNotification, sendNotification } from "../core/notification.js";
import { printError } from "./ui.js";

interface Check {
  name: string;
  run: () => Promise<{ ok: boolean; detail: string }> | { ok: boolean; detail: string };
}

const OK = pc.green("✓");
const BAD = pc.red("✗");
const WARN = pc.yellow("⚠");

export const doctorCommand = new Command("doctor")
  .description("Diagnose your Midtrans setup — keys, environment consistency, webhook reachability")
  .option("--offline", "skip live API checks")
  .option("--webhook-url <url>", "also probe this webhook endpoint with a signed test notification")
  .action(async (options: { offline?: boolean; webhookUrl?: string }) => {
    let failures = 0;
    let warnings = 0;

    const checks: Check[] = [
      {
        name: "Config file",
        run: () => {
          const exists = existsSync(configPath());
          const config = loadConfig();
          const count = Object.keys(config.profiles).length;
          return {
            ok: true, // informational
            detail: exists
              ? `${configPath()} — ${count} profile${count === 1 ? "" : "s"}${count === 0 ? " (run `midtrans login`)" : ""}`
              : `not found yet (~/.midtrans/config.toml) — fine if you use env vars`,
          };
        },
      },
      {
        name: "Credentials resolvable",
        run: () => {
          try {
            const creds = resolveCredentials();
            return {
              ok: true,
              detail: `from ${creds.source}${creds.profileName ? ` (${creds.profileName})` : ""} · ${maskKey(creds.serverKey)}`,
            };
          } catch {
            return { ok: false, detail: "no server key found — run `midtrans login` or set MIDTRANS_SERVER_KEY" };
          }
        },
      },
    ];

    // Environment consistency checks (only meaningful with a resolvable key)
    let creds: Awaited<ReturnType<typeof resolveCredentials>> | undefined;
    try {
      creds = resolveCredentials();
    } catch {
      creds = undefined;
    }

    if (creds) {
      const detected = detectEnvironment(creds.serverKey);
      checks.push({
        name: "Key format",
        run: () =>
          detected
            ? { ok: true, detail: `${detected} key detected from prefix` }
            : { ok: false, detail: "key does not start with SB-Mid-server- or Mid-server- — is it a real Midtrans server key?" },
      });

      if (detected && detected !== creds.environment) {
        checks.push({
          name: "Environment flag consistency",
          run: () => ({
            ok: false,
            detail: `key prefix says ${detected} but configuration says ${creds!.environment} — APIs would be called with the wrong base URL`,
          }),
        });
      }

      const envFlag = process.env.MIDTRANS_IS_PRODUCTION;
      if (envFlag !== undefined && detected) {
        const flagEnv = envFlag === "true" ? "production" : "sandbox";
        checks.push({
          name: "MIDTRANS_IS_PRODUCTION env",
          run: () =>
            flagEnv === detected
              ? { ok: true, detail: `env flag (${flagEnv}) matches key prefix` }
              : {
                  ok: false,
                  detail: `MIDTRANS_IS_PRODUCTION=${envFlag} (${flagEnv}) but key prefix is ${detected} — this mismatch silently breaks production apps`,
                },
        });
      }

      const clientKey = creds.clientKey;
      if (clientKey) {
        checks.push({
          name: "Client key pairing",
          run: () => {
            const clientEnv = clientKey.startsWith("SB-Mid-client-")
              ? "sandbox"
              : clientKey.startsWith("Mid-client-")
                ? "production"
                : null;
            if (!clientEnv) return { ok: false, detail: "client key has no recognizable Midtrans prefix" };
            return clientEnv === creds!.environment
              ? { ok: true, detail: `${clientEnv} client key matches server key environment` }
              : { ok: false, detail: `${clientEnv} client key paired with ${creds!.environment} server key — snap.js will fail` };
          },
        });
      }

      if (!options.offline) {
        checks.push({
          name: "Live key validation",
          run: async () => {
            const client = new MidtransClient({ serverKey: creds!.serverKey, environment: creds!.environment });
            const result = await client.validateCredentials();
            return { ok: result.valid, detail: `${result.message}${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ""}` };
          },
        });
      }

      if (options.webhookUrl) {
        checks.push({
          name: "Webhook endpoint probe",
          run: async () => {
            const notification = buildNotification({
              transactionStatus: "pending",
              orderId: `KIT-DOCTOR-${Date.now().toString(36).toUpperCase()}`,
              amount: 10000,
              serverKey: creds!.serverKey,
            });
            try {
              const response = await sendNotification(options.webhookUrl!, notification, 8000);
              if (response.ok) return { ok: true, detail: `HTTP ${response.status} in ${response.durationMs}ms (valid signature, unknown order)` };
              return { ok: false, detail: `HTTP ${response.status} — the endpoint rejected a valid signature; body: ${response.body.slice(0, 200)}` };
            } catch (error) {
              return { ok: false, detail: `unreachable: ${(error as Error).message}` };
            }
          },
        });
      }
    }

    console.error(pc.bold("midtrans doctor\n"));
    try {
      for (const check of checks) {
        const result = await check.run();
        if (result.ok) {
          console.error(`${OK} ${check.name.padEnd(30)} ${pc.dim(result.detail)}`);
        } else if (check.name === "Config file") {
          console.error(`${WARN} ${check.name.padEnd(30)} ${pc.dim(result.detail)}`);
          warnings++;
        } else {
          console.error(`${BAD} ${check.name.padEnd(30)} ${result.detail}`);
          failures++;
        }
      }
    } catch (error) {
      printError(error);
      process.exitCode = 1;
      return;
    }

    console.error("");
    if (failures === 0 && warnings === 0) {
      console.error(pc.green("All checks passed. You're good to go 🚀"));
    } else if (failures === 0) {
      console.error(pc.yellow("Passed with warnings."));
    } else {
      console.error(pc.red(`${failures} check${failures === 1 ? "" : "s"} failed.`));
      process.exitCode = 1;
    }
  });
