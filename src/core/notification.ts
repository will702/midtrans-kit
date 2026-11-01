import { randomUUID } from "node:crypto";
import { buildSignatureKey, generateOrderId } from "./signature.js";

export type NotificationStatus =
  | "pending"
  | "capture"
  | "settlement"
  | "deny"
  | "cancel"
  | "expire";

/** Full Midtrans payment-notification payload as Midtrans POSTs it to your
 * webhook URL — with a correctly computed signature_key. */
export interface SyntheticNotification {
  transaction_time: string;
  gross_amount: string;
  currency: string;
  order_id: string;
  payment_type: string;
  signature_key: string;
  status_code: string;
  transaction_id: string;
  transaction_status: NotificationStatus;
  fraud_status: string;
  status_message: string;
  merchant_id: string;
  masked_card: string;
  card_type: string;
  bank: string;
  approval_code: string;
  [key: string]: unknown;
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** Midtrans sends gross_amount as a string with two decimals ("10000.00").
 * The signature hash depends on this exact string. */
export function formatGrossAmount(amount: number): string {
  return `${Math.round(amount)}.00`;
}

export interface BuildNotificationOptions {
  transactionStatus: NotificationStatus;
  /** Default: auto-generated `TEST-…` order id. */
  orderId?: string;
  /** Default 10000. */
  amount?: number;
  /** Default "200" (Midtrans' most common notification status_code). */
  statusCode?: string;
  /** Default "accept". Only meaningful for card capture flows. */
  fraudStatus?: string;
  /** Default "credit_card". */
  paymentType?: string;
  serverKey: string;
  /** When true, corrupt the signature on purpose (test that handlers REJECT). */
  tamper?: boolean;
}

export function buildNotification(options: BuildNotificationOptions): SyntheticNotification {
  const orderId = options.orderId ?? generateOrderId("TEST");
  const amount = options.amount ?? 10000;
  const grossAmount = formatGrossAmount(amount);
  const statusCode = options.statusCode ?? "200";
  const fraudStatus = options.fraudStatus ?? "accept";
  const paymentType = options.paymentType ?? "credit_card";

  const payload: SyntheticNotification = {
    transaction_time: formatTimestamp(new Date()),
    gross_amount: grossAmount,
    currency: "IDR",
    order_id: orderId,
    payment_type: paymentType,
    signature_key: "",
    status_code: statusCode,
    transaction_id: randomUUID(),
    transaction_status: options.transactionStatus,
    fraud_status: fraudStatus,
    status_message: "midtrans payment notification",
    merchant_id: "MIDTRANS-KIT-TEST",
    masked_card: "4811 1111-1114",
    card_type: "credit",
    bank: "bni",
    approval_code: String(Math.floor(Math.random() * 1_000_000_000_000)),
  };

  const valid = buildSignatureKey({
    orderId,
    statusCode,
    grossAmount,
    serverKey: options.serverKey,
  });

  payload.signature_key = options.tamper ? `${valid.slice(0, -4)}dead` : valid;
  return payload;
}

/** POST a notification to a webhook endpoint the way Midtrans does. */
export async function sendNotification(
  url: string,
  payload: SyntheticNotification,
  timeoutMs = 10000,
): Promise<{ status: number; ok: boolean; body: string; durationMs: number }> {
  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.text()).slice(0, 2000);
  return {
    status: response.status,
    ok: response.ok,
    body,
    durationMs: Date.now() - started,
  };
}
