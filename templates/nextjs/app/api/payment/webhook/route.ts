import { NextResponse } from "next/server";
import { verifyMidtransSignature } from "@/lib/midtrans";
import { settleOrder } from "@/lib/orders";

/**
 * POST /api/payment/webhook — Midtrans Payment Notification endpoint.
 *
 * REGISTER THIS URL: Midtrans Dashboard → Settings → Configuration →
 * "Payment Notification URL" → https://your-domain.com/api/payment/webhook
 *
 * (Local testing without a public URL:  midtrans webhook:test )
 *
 * Response contract with Midtrans:
 *   200 → delivered.  500 → Midtrans will retry (2/10/30/90/210 min).
 * Always answer FAST — heavy work belongs after the response.
 */
export async function POST(request: Request) {
  let notification: Record<string, unknown>;
  try {
    notification = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Malformed notification" }, { status: 400 });
  }

  const orderId = String(notification.order_id ?? "");
  const signatureKey = String(notification.signature_key ?? "");
  if (!orderId || !signatureKey) {
    return NextResponse.json({ error: "Malformed notification" }, { status: 400 });
  }

  // 1) Verify the signature BEFORE trusting anything in the payload.
  const valid = verifyMidtransSignature({
    orderId,
    statusCode: String(notification.status_code ?? ""),
    // Hash the gross_amount string EXACTLY as received ("10000.00", not 10000).
    grossAmount: String(notification.gross_amount ?? ""),
    signatureKey,
  });
  if (!valid) {
    console.warn("[payment/webhook] invalid signature for", orderId);
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  // 2) Settle — idempotent, amount-checked, status-mapped inside the ledger.
  try {
    const ledger = settleOrder({
      orderId,
      transactionStatus: String(notification.transaction_status ?? ""),
      fraudStatus: notification.fraud_status ? String(notification.fraud_status) : undefined,
      grossAmount: notification.gross_amount ? Math.round(Number(notification.gross_amount)) : undefined,
      paymentMethod: notification.payment_type ? String(notification.payment_type) : undefined,
    });
    // "unknown" = notification for an order we never created → still 200 so
    // Midtrans stops retrying (another app on this merchant may own it).
    return NextResponse.json({ status: "ok", ledger });
  } catch (error) {
    // Amount mismatch etc. → 500 so Midtrans retries and you can investigate.
    console.error("[payment/webhook] settle failed", orderId, error);
    return NextResponse.json({ error: "Settle failed" }, { status: 500 });
  }
}
