import { createHash, randomBytes } from "node:crypto";

/**
 * Midtrans payment-notification signature:
 *   sha512(order_id + status_code + gross_amount + server_key)
 *
 * IMPORTANT: `grossAmount` must be hashed exactly as it appears in the
 * notification payload (a string, usually with decimals, e.g. "10000.00").
 * Hashing the numeric value 10000 would produce a different signature.
 */
export function buildSignatureKey(params: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  serverKey: string;
}): string {
  const raw = `${params.orderId}${params.statusCode}${params.grossAmount}${params.serverKey}`;
  return createHash("sha512").update(raw).digest("hex");
}

/** Verify a notification's signature_key. Case-insensitive hex compare. */
export function verifySignature(params: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
  serverKey: string;
}): boolean {
  if (!params.signatureKey) return false;
  const expected = buildSignatureKey({
    orderId: params.orderId,
    statusCode: params.statusCode,
    grossAmount: params.grossAmount,
    serverKey: params.serverKey,
  });
  return expected.toLowerCase() === params.signatureKey.toLowerCase();
}

/** Order id in the same battle-tested format used in production AmbisCamp
 * integrations: `<PREFIX>-<base36 timestamp>-<random hex>`, e.g. KIT-MZABC123-X9F2KQ. */
export function generateOrderId(prefix = "KIT"): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(5).toString("hex").toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}
