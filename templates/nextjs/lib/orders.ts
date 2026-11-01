/**
 * Order ledger — the template uses an in-memory Map so it runs with zero setup.
 *
 * TODO(production): replace this module with database-backed storage.
 * Keep the same contract (registerOrder / settleOrder / getOrder) and the rest
 * of the app keeps working. Production principles already applied here:
 *   1. Register the order BEFORE creating the Snap token (audit trail — a
 *      webhook for an unknown order id is treated as foreign and ignored).
 *   2. settleOrder is IDEMPOTENT — Midtrans retries notifications, and the
 *      status poll can race the webhook; neither may fulfill twice.
 *   3. Statuses only move forward: pending → paid | failed | expired.
 *   4. Amount must match what was recorded when the order was registered.
 */

export type LedgerStatus = "pending" | "paid" | "failed" | "expired";

export interface Order {
  orderId: string;
  itemId: string;
  itemName: string;
  amountIdr: number;
  customerEmail?: string;
  status: LedgerStatus;
  paymentMethod?: string;
  paidAt?: string;
  createdAt: string;
}

// Swap this Map for a DB table and you're production-ready.
const orders = new Map<string, Order>();

export function registerOrder(params: {
  orderId: string;
  itemId: string;
  itemName: string;
  amountIdr: number;
  customerEmail?: string;
}): Order {
  const order: Order = {
    ...params,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  orders.set(params.orderId, order);
  return order;
}

export function getOrder(orderId: string): Order | undefined {
  return orders.get(orderId);
}

/** Map a Midtrans notification/status to our ledger decision. */
export function mapMidtransToLedger(input: {
  transactionStatus: string;
  fraudStatus?: string | null;
}): LedgerStatus {
  switch (input.transactionStatus) {
    case "settlement":
      return "paid";
    case "capture":
      // Cards: only fulfill when fraud screening accepted the transaction.
      return input.fraudStatus === "accept" ? "paid" : "pending";
    case "deny":
    case "cancel":
      return "failed";
    case "expire":
      return "expired";
    default:
      return "pending";
  }
}

/**
 * Settle an order from a verified notification or status poll.
 * Idempotent: settling an already-settled order is a no-op.
 * Returns "unknown" for order ids we never registered (foreign notifications).
 */
export function settleOrder(params: {
  orderId: string;
  transactionStatus: string;
  fraudStatus?: string | null;
  grossAmount?: number;
  paymentMethod?: string;
}): LedgerStatus {
  const order = orders.get(params.orderId);
  if (!order) return "unknown";
  if (order.status !== "pending") return order.status; // already settled — idempotent

  const target = mapMidtransToLedger(params);
  if (target === "pending") {
    // Still waiting (e.g. VA created but unpaid, or card in fraud challenge).
    order.paymentMethod = params.paymentMethod;
    return "pending";
  }

  // Amount guard: the money must equal what we recorded.
  if (target === "paid" && params.grossAmount !== undefined && params.grossAmount !== order.amountIdr) {
    throw new Error(
      `Amount mismatch for ${params.orderId}: expected ${order.amountIdr}, got ${params.grossAmount}`,
    );
  }

  order.status = target;
  order.paymentMethod = params.paymentMethod;
  if (target === "paid") order.paidAt = new Date().toISOString();
  return order.status;
}
