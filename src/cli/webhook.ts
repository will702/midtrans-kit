import { readFileSync } from "node:fs";
import { Command } from "commander";
import pc from "picocolors";
import { buildNotification, sendNotification } from "../core/notification.js";
import type { NotificationStatus, SyntheticNotification } from "../core/notification.js";
import { resolveCredentials } from "../core/config.js";
import { verifySignature } from "../core/signature.js";
import { explainTransactionStatus, mapTransactionStatus } from "../core/status.js";
import { printError, envBanner } from "./ui.js";

const STATUSES: NotificationStatus[] = [
  "pending",
  "capture",
  "settlement",
  "deny",
  "cancel",
  "expire",
];

export const webhookTestCommand = new Command("webhook:test")
  .description("Send a correctly-signed fake payment notification at your webhook endpoint — test locally, no tunnels")
  .option("--url <url>", "webhook endpoint to hit", "http://localhost:3000/api/payment/webhook")
  .option("--status <status>", `transaction_status to simulate: ${STATUSES.join("|")}`, "settlement")
  .option("--fraud-status <status>", "fraud_status for capture simulations", "accept")
  .option("--amount <number>", "gross amount in IDR", "10000")
  .option("--order-id <id>", "order id (default: auto TEST-…)")
  .option("--payment-type <type>", "payment_type field, e.g. credit_card, qris, gopay", "credit_card")
  .option("--tamper", "send an INVALID signature on purpose (verify your handler rejects it)")
  .action(async (options: Record<string, string | boolean | undefined>) => {
    try {
      const creds = resolveCredentials();
      const status = String(options.status) as NotificationStatus;
      if (!STATUSES.includes(status)) {
        console.error(pc.red(`✗ --status must be one of: ${STATUSES.join(", ")}`));
        process.exitCode = 1;
        return;
      }

      const notification = buildNotification({
        transactionStatus: status,
        orderId: options.orderId ? String(options.orderId) : undefined,
        amount: Number(options.amount ?? 10000),
        fraudStatus: options.fraudStatus ? String(options.fraudStatus) : undefined,
        paymentType: options.paymentType ? String(options.paymentType) : undefined,
        serverKey: creds.serverKey,
        tamper: Boolean(options.tamper),
      });

      console.error(`${envBanner(creds.environment)} ${pc.bold("Webhook test")}\n`);
      console.error(pc.dim("Payload being POSTed:"));
      console.error(JSON.stringify(notification, null, 2));
      console.error("");

      let response: Awaited<ReturnType<typeof sendNotification>>;
      try {
        response = await sendNotification(String(options.url), notification);
      } catch (error) {
        console.error(
          pc.red(`✗ Could not reach ${options.url}: ${(error as Error).message}`),
        );
        console.error(
          pc.dim(
            "Is your dev server running at that address? Pass --url to point somewhere else, e.g.\n" +
              "  midtrans webhook:test --url http://localhost:3000/api/payment/webhook",
          ),
        );
        process.exitCode = 1;
        return;
      }

      const verdict = options.tamper
        ? response.status >= 400
          ? pc.green(`✓ Handler correctly REJECTED the tampered signature (HTTP ${response.status})`)
          : pc.red(`✗ Handler ACCEPTED a tampered signature (HTTP ${response.status}) — your signature check is missing or broken!`)
        : response.ok
          ? pc.green(`✓ Handler accepted the notification (HTTP ${response.status}, ${response.durationMs}ms)`)
          : pc.yellow(`⚠ Handler returned HTTP ${response.status} — Midtrans would retry this notification.`);

      console.error(`${verdict}`);
      if (response.body) console.error(pc.dim(`\nResponse body:\n${response.body}`));
      console.error(
        pc.dim(
          "\nReminder: a production handler should (1) verify signature_key, (2) treat settlement or\n" +
            "capture+fraud_status=accept as paid, (3) be idempotent — Midtrans retries and can double-send.",
        ),
      );
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  });

export const webhookVerifyCommand = new Command("webhook:verify")
  .description("Verify the signature of a notification payload (file or stdin) against your server key")
  .option("--file <path>", "path to a JSON payload file ('-' or omitted = stdin)")
  .action(async (options: { file?: string }) => {
    try {
      const creds = resolveCredentials();
      let raw: string;
      if (options.file && options.file !== "-") {
        raw = readFileSync(options.file, "utf8");
      } else if (!process.stdin.isTTY) {
        raw = readFileSync(0, "utf8");
      } else {
        console.error(pc.red("✗ Pass a payload file: midtrans webhook:verify --file payload.json (or pipe JSON via stdin)."));
        process.exitCode = 1;
        return;
      }

      let payload: SyntheticNotification;
      try {
        payload = JSON.parse(raw) as SyntheticNotification;
      } catch {
        console.error(pc.red("✗ That file is not valid JSON."));
        process.exitCode = 1;
        return;
      }

      const isValid = verifySignature({
        orderId: String(payload.order_id ?? ""),
        statusCode: String(payload.status_code ?? ""),
        grossAmount: String(payload.gross_amount ?? ""),
        signatureKey: String(payload.signature_key ?? ""),
        serverKey: creds.serverKey,
      });

      if (isValid) {
        console.error(pc.green(`✓ Signature is VALID for order "${payload.order_id}".`));
      } else {
        console.error(
          pc.red(`✗ Signature is INVALID for order "${payload.order_id}".`) +
            pc.dim(
              "\n  Checklist:\n" +
                "  - Same environment? A sandbox notification verified with a production server key fails.\n" +
                "  - gross_amount must be hashed exactly as received (string, e.g. \"10000.00\").\n" +
                "  - Formula: sha512(order_id + status_code + gross_amount + server_key).",
            ),
        );
      }

      if (payload.transaction_status) {
        console.error(
          pc.dim(
            `Fulfillment mapping: transaction_status=${payload.transaction_status}` +
              `${payload.fraud_status ? ` fraud_status=${payload.fraud_status}` : ""} → ${mapTransactionStatus(payload)}`,
          ),
        );
        console.error(pc.dim(explainTransactionStatus(payload.transaction_status)));
      }
      process.exitCode = isValid ? 0 : 1;
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  });
