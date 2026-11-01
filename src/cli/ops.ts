import { exec } from "node:child_process";
import { Command } from "commander";
import pc from "picocolors";
import { MidtransClient } from "../core/client.js";
import type { SnapTransactionPayload, TransactionStatus } from "../core/client.js";
import { resolveCredentials } from "../core/config.js";
import type { Environment } from "../core/config.js";
import { generateOrderId } from "../core/signature.js";
import { explainTransactionStatus, mapTransactionStatus } from "../core/status.js";
import { printError, envBanner } from "./ui.js";

/** Resolve credentials once and hand back both creds + a ready client. */
function resolve(): ReturnType<typeof resolveCredentials> & { client: MidtransClient } {
  const creds = resolveCredentials();
  return { ...creds, client: new MidtransClient(creds) };
}

/** Destructive ops on production need an explicit --production flag. */
function guardProduction(environment: Environment, confirmed: boolean): boolean {
  if (environment === "production" && !confirmed) {
    console.error(
      pc.bgRed(pc.bold(" PRODUCTION ")) +
        pc.red(" This command changes live money state. Re-run with --production to confirm."),
    );
    return false;
  }
  return true;
}

function openUrl(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? `open "${url}"` : platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* best effort — if no opener exists, the URL is still printed */
  });
}

export const snapCreateCommand = new Command("snap:create")
  .description("Create a Snap payment — returns a payment link you can open and pay")
  .requiredOption("--amount <number>", "amount in IDR (integer)")
  .option("--order-id <id>", "your own order id (default: auto-generated KIT-…)")
  .option("--item-name <name>", "item name shown on the payment page", "Test Item")
  .option("--name <name>", "customer first name")
  .option("--email <email>", "customer email")
  .option("--phone <phone>", "customer phone")
  .option("--open", "open the payment page in your browser")
  .option("--json", "print raw JSON only")
  .action(async (options: Record<string, string | boolean | undefined>) => {
    try {
      const { client, environment } = resolve();
      const amount = Math.round(Number(options.amount));
      if (!Number.isFinite(amount) || amount < 1) {
        console.error(pc.red("✗ --amount must be a positive integer (IDR, no decimals)."));
        process.exitCode = 1;
        return;
      }

      const orderId = (options.orderId as string) || generateOrderId("KIT");
      const payload: SnapTransactionPayload = {
        transaction_details: { order_id: orderId, gross_amount: amount },
        item_details: [{ id: "item-1", price: amount, quantity: 1, name: String(options.itemName) }],
      };
      const customer: Record<string, string> = {};
      if (options.name) customer.first_name = String(options.name);
      if (options.email) customer.email = String(options.email);
      if (options.phone) customer.phone = String(options.phone);
      if (Object.keys(customer).length > 0) payload.customer_details = customer;

      const result = await client.snapCreate(payload);

      if (options.json) {
        console.log(JSON.stringify({ orderId, ...result }, null, 2));
      } else {
        console.error(`${envBanner(environment)} ${pc.dim("Snap payment created")}\n`);
        console.error(`  Order ID     : ${pc.bold(orderId)}`);
        console.error(`  Amount       : ${pc.bold(`Rp ${amount.toLocaleString("id-ID")}`)}`);
        console.error(`  Token        : ${pc.dim(result.token)}`);
        console.error(`  Payment link : ${pc.cyan(result.redirect_url)}\n`);
        console.error(
          pc.dim(`Pay with sandbox test card 4811 1111 1111 1114, CVV 123, OTP 112233\n` +
            (environment === "sandbox"
              ? `Then check it: midtrans status ${orderId}`
              : `Then check it: midtrans status ${orderId}`)),
        );
      }
      if (options.open) openUrl(result.redirect_url);
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  });

export const statusCommand = new Command("status")
  .description("Check a transaction and see whether it is safe to fulfill")
  .argument("<orderId>", "order id you created the transaction with")
  .option("--json", "print raw JSON only")
  .action(async (orderId: string, options: { json?: boolean }) => {
    try {
      const { client, environment } = resolve();
      const status = await client.status(orderId);

      if (options.json) {
        console.log(JSON.stringify({ ...status, fulfillment: mapTransactionStatus(status) }, null, 2));
        return;
      }

      const mapped = mapTransactionStatus(status);
      const badge =
        mapped === "paid" ? pc.green("PAID — safe to fulfill") :
        mapped === "pending" ? pc.yellow("PENDING — do not fulfill yet") :
        mapped === "expired" ? pc.yellow("EXPIRED — do not fulfill") :
        pc.red("FAILED — do not fulfill");

      console.error(`${envBanner(environment)} ${pc.bold(`Status for ${orderId}`)}\n`);
      console.error(`  Fulfillment   : ${badge}`);
      console.error(`  Status        : ${status.transaction_status ?? "?"}${status.fraud_status ? ` (fraud: ${status.fraud_status})` : ""}`);
      console.error(`  Payment type  : ${status.payment_type ?? "?"}`);
      console.error(`  Gross amount  : Rp ${Number(status.gross_amount ?? 0).toLocaleString("id-ID")}`);
      if (status.settlement_time) console.error(`  Settled at    : ${status.settlement_time}`);
      if (status.expiry_time) console.error(`  Expires at    : ${status.expiry_time}`);
      console.error(pc.dim(`\n  ${explainTransactionStatus(status.transaction_status ?? "")}`));
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  });

function registerActionCommand(
  name: string,
  description: string,
  action: (client: MidtransClient, orderId: string) => Promise<Record<string, unknown>>,
): Command {
  return new Command(name)
    .description(description)
    .argument("<orderId>", "order id")
    .option("--production", "required confirmation flag when running against production")
    .action(async (orderId: string, options: { production?: boolean }) => {
      try {
        const { client, environment } = resolve();
        if (!guardProduction(environment, Boolean(options.production))) {
          process.exitCode = 1;
          return;
        }
        const result = await action(client, orderId);
        console.error(
          `${envBanner(environment)} ${pc.green("✓")} ${name} → ${orderId}\n` +
            JSON.stringify(result, null, 2),
        );
      } catch (error) {
        printError(error);
        process.exitCode = 1;
      }
    });
}

export const approveCommand = registerActionCommand(
  "approve",
  "Approve a challenged card transaction (fraud_status 'challenge')",
  (client, orderId) => client.approve(orderId),
);

export const denyCommand = registerActionCommand(
  "deny",
  "Deny a challenged card transaction",
  (client, orderId) => client.deny(orderId),
);

export const cancelCommand = registerActionCommand(
  "cancel",
  "Cancel/void an unsettled transaction",
  (client, orderId) => client.cancel(orderId),
);

export const expireCommand = registerActionCommand(
  "expire",
  "Force-expire a pending transaction (the order id becomes reusable)",
  (client, orderId) => client.expire(orderId),
);

export const refundCommand = new Command("refund")
  .description("Refund a settled transaction (full refund by default)")
  .argument("<orderId>", "order id")
  .option("--amount <number>", "partial refund amount in IDR (default: full refund)")
  .option("--reason <reason>", "reason, e.g. 'customer request'", "midtrans-kit refund")
  .option("--production", "required confirmation flag when running against production")
  .action(async (orderId: string, options: { amount?: string; reason?: string; production?: boolean }) => {
    try {
      const { client, environment } = resolve();
      if (!guardProduction(environment, Boolean(options.production))) {
        process.exitCode = 1;
        return;
      }
      const amount = options.amount !== undefined ? Math.round(Number(options.amount)) : undefined;
      if (amount !== undefined && (!Number.isFinite(amount) || amount < 1)) {
        console.error(pc.red("✗ --amount must be a positive integer (IDR)."));
        process.exitCode = 1;
        return;
      }
      const result = await client.refund(orderId, { amount, reason: options.reason });
      console.error(
        `${envBanner(environment)} ${pc.green("✓")} refund → ${orderId}\n` + JSON.stringify(result, null, 2),
      );
    } catch (error) {
      printError(error);
      process.exitCode = 1;
    }
  });

export type { TransactionStatus };
