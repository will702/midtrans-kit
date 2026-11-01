import { NextResponse } from "next/server";
import { getMidtransStatus } from "@/lib/midtrans";
import { getOrder, settleOrder } from "@/lib/orders";

/**
 * GET /api/payment/status?order_id=SHOP-…
 *
 * The webhook is the primary signal, but notifications can lag or fail.
 * This endpoint reconciles: while the ledger says pending, ask Midtrans
 * directly (the status API is always the source of truth).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("order_id");
  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }

  const order = getOrder(orderId);
  if (!order) {
    return NextResponse.json({ status: "unknown" }, { status: 404 });
  }

  if (order.status === "pending") {
    try {
      const midtrans = await getMidtransStatus(orderId);
      if (midtrans) {
        const transactionStatus = String(midtrans.transaction_status ?? "");
        const fraudStatus = midtrans.fraud_status ? String(midtrans.fraud_status) : undefined;
        const paid = transactionStatus === "settlement" ||
          (transactionStatus === "capture" && fraudStatus === "accept");
        const failed = transactionStatus === "deny" || transactionStatus === "cancel" || transactionStatus === "expire";

        if (paid || failed) {
          settleOrder({
            orderId,
            transactionStatus,
            fraudStatus,
            grossAmount: midtrans.gross_amount
              ? Math.round(Number(midtrans.gross_amount))
              : undefined,
            paymentMethod: midtrans.payment_type ? String(midtrans.payment_type) : undefined,
          });
        }
      }
    } catch (error) {
      // Polling is best-effort; the webhook remains the authoritative path.
      console.error("[payment/status] reconcile failed", orderId, error);
    }
  }

  const fresh = getOrder(orderId)!;
  return NextResponse.json({
    order_id: fresh.orderId,
    item_name: fresh.itemName,
    amount_idr: fresh.amountIdr,
    status: fresh.status,
    paid_at: fresh.paidAt ?? null,
  });
}
