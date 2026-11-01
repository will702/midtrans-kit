/**
 * Minimal, dependency-free Midtrans client for server code.
 * Ported from the hardened patterns of production AmbisCamp integrations.
 */
import { createHash } from "node:crypto";

const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";

const SNAP_URL = isProduction ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
const API_URL = isProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";

export interface MidtransConfig {
  serverKey: string;
  clientKey: string;
  isProduction: boolean;
}

export function getMidtransConfig(): MidtransConfig {
  const serverKey = process.env.MIDTRANS_SERVER_KEY ?? "";
  const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? "";
  return { serverKey, clientKey, isProduction };
}

function authHeader(): string {
  const { serverKey } = getMidtransConfig();
  // Midtrans auth: Basic base64("<server key>:") — the key is the username.
  return `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`;
}

export interface SnapCustomerDetails {
  first_name?: string;
  email?: string;
  phone?: string;
}

/** Create a Snap payment → { token, redirect_url }. */
export async function createSnapTransaction(params: {
  orderId: string;
  grossAmount: number;
  itemName: string;
  customer?: SnapCustomerDetails;
  finishUrl?: string;
}): Promise<{ token: string; redirect_url: string }> {
  const response = await fetch(`${SNAP_URL}/snap/v1/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authHeader(),
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: params.orderId,
        gross_amount: Math.round(params.grossAmount),
      },
      item_details: [
        {
          id: params.orderId,
          price: Math.round(params.grossAmount),
          quantity: 1,
          // Snap truncates item names around 50 chars
          name: params.itemName.slice(0, 50),
        },
      ],
      customer_details: params.customer ?? {},
      ...(params.finishUrl ? { callbacks: { finish: params.finishUrl } } : {}),
    }),
  });

  const body = (await response.json()) as { token?: string; redirect_url?: string };
  if (!response.ok || !body.token || !body.redirect_url) {
    throw new Error(`Snap create failed (HTTP ${response.status}): ${JSON.stringify(body)}`);
  }
  return { token: body.token, redirect_url: body.redirect_url };
}

/**
 * Verify a payment notification signature.
 * Formula: sha512(order_id + status_code + gross_amount + server_key)
 *
 * IMPORTANT: gross_amount must be hashed EXACTLY as received — a string like
 * "10000.00", not the number 10000.
 */
export function verifyMidtransSignature(params: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
}): boolean {
  const { serverKey } = getMidtransConfig();
  if (!serverKey) return false;
  const raw = `${params.orderId}${params.statusCode}${params.grossAmount}${serverKey}`;
  const expected = createHash("sha512").update(raw).digest("hex");
  return expected.toLowerCase() === params.signatureKey.toLowerCase();
}

/** GET /v2/{order_id}/status — the source of truth when webhooks lag. */
export async function getMidtransStatus(
  orderId: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${API_URL}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: { Accept: "application/json", Authorization: authHeader() },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Midtrans status check failed (HTTP ${response.status})`);
  }
  return (await response.json()) as Record<string, unknown>;
}
