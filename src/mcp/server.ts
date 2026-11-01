#!/usr/bin/env node
/**
 * midtrans-kit MCP server (stdio).
 *
 * Start directly:  midtrans mcp
 * Agent config:    claude mcp add midtrans -- npx midtrans-kit mcp
 *
 * Shares the exact same core library and ~/.midtrans/config.toml profiles as
 * the CLI — one login works for both surfaces.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";

import { MidtransClient } from "../core/client.js";
import { resolveCredentials } from "../core/config.js";
import { buildNotification, sendNotification } from "../core/notification.js";
import type { NotificationStatus } from "../core/notification.js";
import { generateOrderId, verifySignature } from "../core/signature.js";
import { explainTransactionStatus, mapTransactionStatus } from "../core/status.js";
import { DOC_TOPICS, listTopics, searchDocs } from "../core/docs.js";
import { MissingCredentialsError } from "../core/errors.js";

const require = createRequire(import.meta.url);
const version = (() => {
  try {
    return require("../../package.json").version as string;
  } catch {
    return "0.0.0-dev";
  }
})();

function textResult(data: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  const message =
    error instanceof MissingCredentialsError
      ? `${error.message} (MCP servers can't run interactive login — run \`midtrans login\` in a terminal, or pass MIDTRANS_SERVER_KEY in this server's env.)`
      : error instanceof Error
        ? error.message
        : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Client + context; throws MissingCredentialsError when unconfigured. */
function session() {
  const creds = resolveCredentials();
  return {
    creds,
    client: new MidtransClient({ serverKey: creds.serverKey, environment: creds.environment }),
  };
}

/** Production money-changing ops need an explicit confirm:true from the agent. */
function productionGuard(
  creds: { environment: "sandbox" | "production" },
  confirm: boolean,
): string | null {
  if (creds.environment === "production" && !confirm) {
    return (
      "Refusing to run against PRODUCTION without confirmation. " +
      "Re-call this tool with confirm: true if you really mean it."
    );
  }
  return null;
}

const notificationStatuses = z.enum([
  "pending",
  "capture",
  "settlement",
  "deny",
  "cancel",
  "expire",
]);

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: "midtrans-kit", version });

  server.registerTool(
    "create_snap_payment",
    {
      title: "Create Snap payment",
      description:
        "Create a Midtrans Snap hosted-checkout payment. Returns order_id, snap token and a payment URL the user can open to pay (sandbox test card: 4811 1111 1111 1114, CVV 123, OTP 112233).",
      inputSchema: {
        amount: z.number().int().positive().describe("Amount in IDR (whole rupiah)"),
        order_id: z.string().optional().describe("Your order id — auto-generated when omitted"),
        item_name: z.string().optional().describe("Item name shown on the payment page"),
        customer_name: z.string().optional(),
        customer_email: z.string().optional(),
        customer_phone: z.string().optional(),
      },
    },
    async ({ amount, order_id, item_name, customer_name, customer_email, customer_phone }) => {
      try {
        const { creds, client } = session();
        const orderId = order_id ?? generateOrderId("KIT");
        const result = await client.snapCreate({
          transaction_details: { order_id: orderId, gross_amount: amount },
          item_details: [{ id: "item-1", price: amount, quantity: 1, name: item_name ?? "Payment" }],
          customer_details: {
            first_name: customer_name,
            email: customer_email,
            phone: customer_phone,
          },
        });
        return textResult({
          environment: creds.environment,
          order_id: orderId,
          token: result.token,
          payment_url: result.redirect_url,
          amount_idr: amount,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_transaction_status",
    {
      title: "Get transaction status",
      description:
        "Fetch a transaction from Midtrans by order_id. Returns the raw status plus a safe fulfillment decision (paid/pending/failed/expired) and an explanation.",
      inputSchema: {
        order_id: z.string().describe("Order id the transaction was created with"),
      },
    },
    async ({ order_id }) => {
      try {
        const { creds, client } = session();
        const status = await client.status(order_id);
        const mapped = mapTransactionStatus(status);
        return textResult({
          environment: creds.environment,
          order_id,
          fulfillment: mapped,
          safe_to_fulfill: mapped === "paid",
          explanation: explainTransactionStatus(status.transaction_status ?? ""),
          raw: status,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  interface GuardedAction {
    name: string;
    description: string;
    run: (client: MidtransClient, orderId: string) => Promise<Record<string, unknown>>;
  }

  const guardedActions: GuardedAction[] = [
    { name: "approve_transaction", description: "Approve a challenged card transaction (fraud_status 'challenge').", run: (c, id) => c.approve(id) },
    { name: "deny_transaction", description: "Deny a challenged card transaction.", run: (c, id) => c.deny(id) },
    { name: "cancel_transaction", description: "Cancel/void an unsettled transaction.", run: (c, id) => c.cancel(id) },
    { name: "expire_transaction", description: "Force-expire a pending transaction (frees the order_id for reuse).", run: (c, id) => c.expire(id) },
  ];

  for (const action of guardedActions) {
    server.registerTool(
      action.name,
      {
        title: action.name.replace(/_/g, " "),
        description:
          action.description +
          " Requires confirm:true when the active credentials are production.",
        inputSchema: {
          order_id: z.string(),
          confirm: z.boolean().optional().describe("Must be true when running against production"),
        },
      },
      async ({ order_id, confirm }) => {
        try {
          const { creds, client } = session();
          const refusal = productionGuard(creds, Boolean(confirm));
          if (refusal) return errorResult(new Error(refusal));
          const result = await action.run(client, order_id);
          return textResult({ environment: creds.environment, order_id, result });
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }

  server.registerTool(
    "refund_transaction",
    {
      title: "Refund transaction",
      description:
        "Refund a settled transaction (full refund by default, partial with amount). Requires confirm:true against production.",
      inputSchema: {
        order_id: z.string(),
        amount: z.number().int().positive().optional().describe("Partial refund amount in IDR"),
        reason: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async ({ order_id, amount, reason, confirm }) => {
      try {
        const { creds, client } = session();
        const refusal = productionGuard(creds, Boolean(confirm));
        if (refusal) return errorResult(new Error(refusal));
        const result = await client.refund(order_id, { amount, reason });
        return textResult({ environment: creds.environment, order_id, result });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "verify_webhook_signature",
    {
      title: "Verify webhook signature",
      description:
        "Verify a Midtrans payment-notification payload's signature_key against the configured server key, and get the fulfillment mapping for it. Use this to check webhook payloads your app received.",
      inputSchema: {
        payload: z.record(z.unknown()).describe("The notification JSON payload as an object"),
      },
    },
    async ({ payload }) => {
      try {
        const { creds } = session();
        const get = (key: string) => String((payload as Record<string, unknown>)[key] ?? "");
        const isValid = verifySignature({
          orderId: get("order_id"),
          statusCode: get("status_code"),
          grossAmount: get("gross_amount"),
          signatureKey: get("signature_key"),
          serverKey: creds.serverKey,
        });
        const transactionStatus = get("transaction_status");
        return textResult({
          environment: creds.environment,
          valid: isValid,
          ...(transactionStatus
            ? {
                fulfillment: mapTransactionStatus({
                  transaction_status: transactionStatus,
                  fraud_status: get("fraud_status") || null,
                }),
                explanation: explainTransactionStatus(transactionStatus),
              }
            : {}),
          hint: isValid
            ? undefined
            : "Check: sandbox payload vs production key (or vice versa), gross_amount hashed as the exact string, formula sha512(order_id+status_code+gross_amount+server_key).",
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "send_test_webhook_notification",
    {
      title: "Send test webhook notification",
      description:
        "POST a correctly-signed fake payment notification to a webhook endpoint (e.g. a dev server on localhost) — lets the developer test their handler without exposing a public URL. Use tamper:true to check the handler REJECTS bad signatures.",
      inputSchema: {
        url: z.string().describe("Endpoint to hit, e.g. http://localhost:3000/api/payment/webhook"),
        status: notificationStatuses.optional().describe("transaction_status to simulate"),
        order_id: z.string().optional(),
        amount: z.number().int().positive().optional(),
        payment_type: z.string().optional(),
        tamper: z.boolean().optional().describe("Send an invalid signature on purpose"),
      },
    },
    async ({ url, status, order_id, amount, payment_type, tamper }) => {
      try {
        const { creds } = session();
        const notification = buildNotification({
          transactionStatus: (status ?? "settlement") as NotificationStatus,
          orderId: order_id,
          amount,
          paymentType: payment_type,
          serverKey: creds.serverKey,
          tamper,
        });
        const response = await sendNotification(url, notification);
        const verdict = tamper
          ? response.status >= 400
            ? "GOOD: handler rejected the tampered signature"
            : "BAD: handler accepted a tampered signature — signature verification is missing or broken"
          : response.ok
            ? "OK: handler accepted the notification"
            : "NOTE: non-2xx response — Midtrans would retry this notification";
        return textResult({
          environment: creds.environment,
          http_status: response.status,
          duration_ms: response.durationMs,
          verdict,
          response_body: response.body,
          payload_sent: notification,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "search_midtrans_docs",
    {
      title: "Search Midtrans docs",
      description:
        "Search the offline Midtrans quick-reference: sandbox test cards, status lifecycle, signature formula, webhook handling, retry schedule, simulators, payment methods. Pass an empty query to list all topics.",
      inputSchema: {
        query: z.string().default("").describe("Search words, or empty to list topics"),
      },
    },
    async ({ query }) => {
      const topics = query ? searchDocs(query) : DOC_TOPICS;
      if (topics.length === 0) {
        return textResult({ topics: listTopics(), note: `No match for "${query}" — all topics listed.` });
      }
      return textResult({
        matches: topics.map((t) => ({ topic: t.name, title: t.title, body: t.body })),
      });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is the MCP protocol channel.
  console.error(`midtrans-kit MCP server v${version} running (stdio)`);
}
