/**
 * Offline Midtrans quick-reference. Shared by `midtrans docs <topic>` (CLI)
 * and the MCP `search_midtrans_docs` tool so both surfaces stay in sync.
 */
export interface DocTopic {
  name: string;
  title: string;
  keywords: string[];
  body: string;
}

export const DOC_TOPICS: DocTopic[] = [
  {
    name: "test-cards",
    title: "Sandbox test cards",
    keywords: ["card", "credit card", "visa", "mastercard", "3ds", "otp", "testing", "sandbox", "cvv"],
    body: `Sandbox test cards (CVV 123, any future expiry, 3DS OTP 112233):

  APPROVE
  4811 1111 1111 1114   Visa (challenge by default, accept after OTP)
  5211 1111 1111 1117   Mastercard

  DENY
  4911 1111 1111 1113   Visa — denied by bank
  4711 1111 1111 1115   Visa — denied by bank
  4611 1111 1111 1116   Visa — flagged as fraud (fraud_status: deny)

  SPECIAL
  4411 1111 1111 1118   Attempted authentication, then accept
  4806 0000 0000 0081   Amount-based deny (RC 51) when > Rp 30.000
  4556 5579 5572 6624   3DS2 frictionless (no OTP prompt)
  4916 9940 6425 2017   3DS2 challenge flow

Non-card channels use the simulators — see \`midtrans docs simulators\`.`,
  },
  {
    name: "statuses",
    title: "Transaction status lifecycle",
    keywords: ["status", "lifecycle", "settlement", "capture", "pending", "expire", "deny", "cancel", "refund"],
    body: `Transaction status lifecycle (transaction_status field):

  pending     Created, awaiting payment (VA/QR/e-wallet open)
      ├── settlement   money settled → FULFILL THE ORDER
      ├── capture      card captured — check fraud_status:
      │       accept   → safe to fulfill
      │       challenge→ you must approve or deny (midtrans approve/deny)
      ├── deny         payment denied → do NOT fulfill
      ├── cancel       cancelled by customer/you/provider → do NOT fulfill
      └── expire       never paid → do NOT fulfill (order id becomes reusable)

  After settlement:
      settlement → refund / partial_refund

Rule of thumb: fulfill only on settlement, or capture with fraud_status=accept.
Always re-check via the status API if notifications arrive out of order.`,
  },
  {
    name: "signature",
    title: "Webhook signature verification",
    keywords: ["signature", "verify", "sha512", "webhook", "notification", "security"],
    body: `Every payment notification contains signature_key. Verify it before trusting anything:

  expected = SHA512(order_id + status_code + gross_amount + server_key)

Gotchas that cause most verification bugs:
  1. Hash the gross_amount EXACTLY as received — a string like "10000.00",
     not the number 10000.
  2. Compare case-insensitively (hex).
  3. Sandbox notifications verify against the SANDBOX server key; production
     against the production key. Mixing them always fails.
  4. Respond 200 quickly; if verification fails respond 403 and do nothing.

midtrans-kit can do this for you:
  midtrans webhook:verify --file payload.json`,
  },
  {
    name: "methods",
    title: "Payment methods / channels",
    keywords: ["payment type", "channels", "va", "qris", "gopay", "shopeepay", "bank transfer", "cstore", "akulaku"],
    body: `Common payment_type values seen in notifications and status payloads:

  Cards          credit_card, debit (bca_debit_account etc.)
  Bank transfer  bank_transfer (permata_va_number / va_numbers[{bank, va_number}])
  VA direct      bca_va, bni_va, bri_va, mandiri_va (biller_code + bill_key)
  QR             qris (QR string/URL; use the QRIS simulator to test)
  E-wallets      gopay, shopeepay, qris (dynamic QR), danamon_online, akulaku
  C-store        cstore (indomaret/alfamart — payment_code + store)

enabled_payments on a Snap transaction restricts the channels shown;
omit it to accept everything activated on your merchant account.`,
  },
  {
    name: "webhook",
    title: "Handling payment notifications (webhooks)",
    keywords: ["webhook", "notification", "handler", "idempotent", "retry", "endpoint", "https"],
    body: `Midtrans POSTs a JSON notification to your Payment Notification URL
(Dashboard → Settings → Configuration) on every status change.

Your handler must:
  1. Verify signature_key (see \`midtrans docs signature\`).
  2. Map status → fulfillment decision (see \`midtrans docs statuses\`).
  3. BE IDEMPOTENT. Midtrans retries: the same notification can arrive twice,
     and settlement + refund notifications share one order_id.
  4. Respond 200 fast (< 5s ideally; hard limit 15s). Do slow work after.

Endpoint requirements: public HTTPS, standard ports, no auth on the URL.
One notification URL per merchant — fan out internally if several apps share
a merchant (each consumer re-verifies the signature).

Test locally without any tunnel:
  midtrans webhook:test --status settlement --url http://localhost:3000/api/payment/webhook`,
  },
  {
    name: "retry",
    title: "Notification retry schedule",
    keywords: ["retry", "retries", "schedule", "timeout", "response codes"],
    body: `If your endpoint doesn't answer 2xx, Midtrans retries up to 5 times:

  Attempt 1  immediately
  Attempt 2  +~2 minutes
  Attempt 3  +~10 minutes
  Attempt 4  +~30 minutes
  Attempt 5  +~90 minutes
  Attempt 6  +~210 minutes (final)

Response-code effects:
  2xx            stop retrying (delivered)
  500            retry
  503            retry
  400/404        retry
  301/302/303    not followed (treated as delivered)
  307/308        followed up to 5 redirects

Design so that even if ALL retries fail, a status poll can still reconcile:
  GET https://api.midtrans.com/v2/{order_id}/status`,
  },
  {
    name: "simulators",
    title: "Sandbox simulators (non-card channels)",
    keywords: ["simulator", "qris", "va", "gopay", "ovo", "indomaret", "alfamart", "deeplink"],
    body: `Card payments can be tested with test cards, everything else has a simulator:

  QRIS       simulator.sandbox.midtrans.com/v2/qris/index
             (paste the QR image URL from the Snap payment page)
  Deeplink   simulator.sandbox.midtrans.com/v2/deeplink/index
  VA         simulator.sandbox.midtrans.com/va/index?bank=<bca|bni|bri|permata|…>
  C-store    simulator.sandbox.midtrans.com/indomaret/phoenix/index  (also alfamart, kioson)

  GoPay/ShopeePay on mobile sandbox auto-redirect to the simulator.
  OVO uses magic phone numbers, e.g.:
    +628271939753  → user cancels
    +628123456789  → succeeds after OTP (check Midtrans docs for the full list)

Warnings:
  - NEVER pay a sandbox transaction with real money (unrecoverable).
  - Sandbox QRIS paid with a REAL wallet app may route to your PRODUCTION
    merchant — use the simulator.`,
  },
];

export function listTopics(): string {
  return DOC_TOPICS.map((t) => `${t.name.padEnd(14)} ${t.title}`).join("\n");
}

/** Naive but effective search across titles, keywords, and body text. */
export function searchDocs(query: string): DocTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  return DOC_TOPICS.map((topic) => {
    const haystack = `${topic.name} ${topic.title} ${topic.keywords.join(" ")} ${topic.body}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    return { topic, score };
  })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ topic }) => topic);
}
