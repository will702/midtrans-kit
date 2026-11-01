/**
 * Maps Midtrans `transaction_status` (+ `fraud_status`) to a simple
 * fulfillment decision: should you hand over the goods or not?
 *
 * Semantics mirror the hardened `web_settle_order` RPC used in production:
 *   settlement                        → paid
 *   capture + fraud_status "accept"   → paid   (card captured & not challenged)
 *   capture + challenge/other         → pending (waiting for your approve/deny)
 *   deny, cancel                      → failed
 *   expire                            → expired
 *   refund / partial_refund           → paid   (payment did succeed; the refund
 *                                                is a separate money movement)
 *   anything else (pending, ...)      → pending
 */
export type FulfillmentStatus = "paid" | "pending" | "failed" | "expired";

export interface StatusInput {
  transaction_status?: string | null;
  fraud_status?: string | null;
}

export function mapTransactionStatus(input: StatusInput): FulfillmentStatus {
  switch (input.transaction_status ?? "") {
    case "settlement":
    case "refund":
    case "partial_refund":
      return "paid";
    case "capture":
      return input.fraud_status === "accept" ? "paid" : "pending";
    case "deny":
    case "cancel":
      return "failed";
    case "expire":
      return "expired";
    default:
      return "pending";
  }
}

/** Short human explanation for each raw status — used in CLI output. */
export function explainTransactionStatus(status: string): string {
  const explanations: Record<string, string> = {
    pending: "Transaction is created, waiting for the customer to pay (VA/QR/e-wallet still open).",
    capture: "Card transaction is captured. Check fraud_status: 'accept' = safe to fulfill, 'challenge' = you must approve or deny.",
    settlement: "Money has settled to your account. Safe to fulfill the order.",
    deny: "The payment was denied by the bank/provider. Do not fulfill.",
    cancel: "The transaction was cancelled (by you, the customer, or the provider). Do not fulfill.",
    expire: "The customer never paid and the transaction expired. Do not fulfill.",
    refund: "The transaction was fully refunded after settling.",
    partial_refund: "The transaction was partially refunded after settling.",
  };
  return explanations[status] ?? "Unknown status. Treat as pending and re-check via the status API before fulfilling.";
}
