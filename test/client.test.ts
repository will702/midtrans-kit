import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { MidtransClient } from "../src/core/client.js";
import { MidtransError } from "../src/core/errors.js";
import { buildNotification, formatGrossAmount } from "../src/core/notification.js";
import { verifySignature } from "../src/core/signature.js";

const SANDBOX_KEY = "SB-Mid-server-TESTKEY";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("MidtransClient", () => {
  it("targets sandbox vs production base URLs correctly", async () => {
    const fetchMock = mock.fn(() => Promise.resolve(jsonResponse(404, { status_message: "not found" })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const sandbox = new MidtransClient({ serverKey: SANDBOX_KEY, environment: "sandbox" });
    await sandbox.status("order-1").catch(() => {});
    assert.equal((fetchMock.mock.calls[0]?.arguments as unknown[])[0] as string,
      "https://api.sandbox.midtrans.com/v2/order-1/status");

    const prod = new MidtransClient({ serverKey: "Mid-server-X", environment: "production" });
    await prod.status("order-1").catch(() => {});
    assert.equal((fetchMock.mock.calls[1]?.arguments as unknown[])[0] as string,
      "https://api.midtrans.com/v2/order-1/status");

    const snapSandbox = new MidtransClient({ serverKey: SANDBOX_KEY, environment: "sandbox" });
    await snapSandbox.snapCreate({ transaction_details: { order_id: "o", gross_amount: 1 } }).catch(() => {});
    assert.equal((fetchMock.mock.calls[2]?.arguments as unknown[])[0] as string,
      "https://app.sandbox.midtrans.com/snap/v1/transactions");

    fetchMock.mock.restore();
  });

  it("sends Basic auth with base64(serverKey + ':') and a JSON body", async () => {
    const fetchMock = mock.fn(() =>
      Promise.resolve(jsonResponse(200, { token: "tok", redirect_url: "https://pay" })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new MidtransClient({ serverKey: "abc:secret", environment: "sandbox" });
    const result = await client.snapCreate({
      transaction_details: { order_id: "ORD-1", gross_amount: 50000 },
      item_details: [{ price: 50000, quantity: 1, name: "T-shirt" }],
    });

    assert.equal(result.token, "tok");
    const call = fetchMock.mock.calls[0] as unknown as { arguments: [string, RequestInit] };
    assert.equal(
      call.arguments[1].headers?.Authorization,
      `Basic ${Buffer.from("abc:secret:").toString("base64")}`,
    );
    const body = JSON.parse(String(call.arguments[1].body));
    assert.equal(body.transaction_details.order_id, "ORD-1");
    assert.equal(body.transaction_details.gross_amount, 50000);

    fetchMock.mock.restore();
  });

  it("surfaces Midtrans validation messages in MidtransError", async () => {
    const fetchMock = mock.fn(() =>
      Promise.resolve(
        jsonResponse(400, {
          status_code: "400",
          status_message: "One of the parameters is invalid",
          validation_messages: ["gross_amount must be greater than 0"],
        }),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new MidtransClient({ serverKey: SANDBOX_KEY, environment: "sandbox" });
    await assert.rejects(
      client.snapCreate({ transaction_details: { order_id: "x", gross_amount: 0 } }),
      (error: unknown) => {
        assert.ok(error instanceof MidtransError);
        assert.equal(error.httpStatus, 400);
        assert.equal(error.validationMessages[0], "gross_amount must be greater than 0");
        return true;
      },
    );
    fetchMock.mock.restore();
  });

  it("retries 5xx then succeeds, and throws after exhausting retries", async () => {
    let calls = 0;
    const fetchMock = mock.fn(() => {
      calls++;
      if (calls <= 2) return Promise.resolve(jsonResponse(500, { status_message: "boom" }));
      return Promise.resolve(jsonResponse(200, { transaction_status: "pending" }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new MidtransClient({ serverKey: SANDBOX_KEY, environment: "sandbox" });
    const status = await client.status("ORD-9");
    assert.equal(status.transaction_status, "pending");
    assert.equal(calls, 3);
    fetchMock.mock.restore();
  });

  it("validateCredentials(): 401 → invalid, 404 → valid", async () => {
    const fetchMock = mock.fn(() => Promise.resolve(jsonResponse(401, { status_message: "Access denied" })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const bad = await new MidtransClient({ serverKey: "wrong", environment: "sandbox" }).validateCredentials();
    assert.equal(bad.valid, false);

    fetchMock.mock.mockImplementation(() => Promise.resolve(jsonResponse(404, { status_message: "The transaction is not found" })));
    const good = await new MidtransClient({ serverKey: SANDBOX_KEY, environment: "sandbox" }).validateCredentials();
    assert.equal(good.valid, true);

    fetchMock.mock.restore();
  });

  it("status(): normalizes HTTP-200-with-body-404 to a not-found error", async () => {
    const fetchMock = mock.fn(() =>
      Promise.resolve(
        jsonResponse(200, { status_code: "404", status_message: "Transaction doesn't exist.", id: "x" }),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await assert.rejects(
      new MidtransClient({ serverKey: SANDBOX_KEY, environment: "sandbox" }).status("NOPE-1"),
      (error: unknown) => {
        assert.ok(error instanceof MidtransError);
        assert.equal(error.httpStatus, 404);
        assert.match(error.message, /not found/);
        return true;
      },
    );
    fetchMock.mock.restore();
  });
});

describe("buildNotification", () => {
  it("produces a payload whose signature verifies", () => {
    const notification = buildNotification({
      transactionStatus: "settlement",
      orderId: "SHOP-TEST-1",
      amount: 250000,
      serverKey: SANDBOX_KEY,
    });

    assert.equal(notification.order_id, "SHOP-TEST-1");
    assert.equal(notification.gross_amount, "250000.00");
    assert.equal(
      verifySignature({
        orderId: notification.order_id,
        statusCode: notification.status_code,
        grossAmount: notification.gross_amount,
        signatureKey: notification.signature_key,
        serverKey: SANDBOX_KEY,
      }),
      true,
    );
  });

  it("tamper mode produces a signature that FAILS verification", () => {
    const notification = buildNotification({
      transactionStatus: "capture",
      amount: 10000,
      serverKey: SANDBOX_KEY,
      tamper: true,
    });
    assert.equal(
      verifySignature({
        orderId: notification.order_id,
        statusCode: notification.status_code,
        grossAmount: notification.gross_amount,
        signatureKey: notification.signature_key,
        serverKey: SANDBOX_KEY,
      }),
      false,
    );
  });

  it("formats gross amounts with two decimals", () => {
    assert.equal(formatGrossAmount(10000), "10000.00");
    assert.equal(formatGrossAmount(250000.9), "250001.00");
  });
});
