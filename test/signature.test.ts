import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSignatureKey, generateOrderId, verifySignature } from "../src/core/signature.js";

const SERVER_KEY = "SB-Mid-server-TESTKEY";

// Independent vector: sha512("TEST-ORDER-1" + "200" + "10000.00" + SERVER_KEY)
const KNOWN_VECTOR =
  "44b158fd7d9e0dac5bd38f68a0c757323cf26c24fd674819530873a0b9a6ce6d97810c89b1a47de7e4a4bd7f2d8da46f15cef0affa903915ee5fdd480e725837";

describe("buildSignatureKey", () => {
  it("matches a precomputed sha512 vector", () => {
    const got = buildSignatureKey({
      orderId: "TEST-ORDER-1",
      statusCode: "200",
      grossAmount: "10000.00",
      serverKey: SERVER_KEY,
    });
    assert.equal(got, KNOWN_VECTOR);
  });

  it("treats gross_amount '10000' and '10000.00' as different strings", () => {
    const a = buildSignatureKey({ orderId: "O", statusCode: "200", grossAmount: "10000", serverKey: SERVER_KEY });
    const b = buildSignatureKey({ orderId: "O", statusCode: "200", grossAmount: "10000.00", serverKey: SERVER_KEY });
    assert.notEqual(a, b);
  });
});

describe("verifySignature", () => {
  it("accepts a correct signature case-insensitively", () => {
    assert.equal(
      verifySignature({
        orderId: "TEST-ORDER-1",
        statusCode: "200",
        grossAmount: "10000.00",
        signatureKey: KNOWN_VECTOR.toUpperCase(),
        serverKey: SERVER_KEY,
      }),
      true,
    );
  });

  it("rejects a tampered payload field", () => {
    assert.equal(
      verifySignature({
        orderId: "TEST-ORDER-2", // swapped order id
        statusCode: "200",
        grossAmount: "10000.00",
        signatureKey: KNOWN_VECTOR,
        serverKey: SERVER_KEY,
      }),
      false,
    );
  });

  it("rejects a signature signed with a different server key (sandbox vs production)", () => {
    assert.equal(
      verifySignature({
        orderId: "TEST-ORDER-1",
        statusCode: "200",
        grossAmount: "10000.00",
        signatureKey: KNOWN_VECTOR,
        serverKey: "Mid-server-PRODKEY",
      }),
      false,
    );
  });

  it("rejects empty signature keys", () => {
    assert.equal(
      verifySignature({
        orderId: "TEST-ORDER-1",
        statusCode: "200",
        grossAmount: "10000.00",
        signatureKey: "",
        serverKey: SERVER_KEY,
      }),
      false,
    );
  });
});

describe("generateOrderId", () => {
  it("formats as PREFIX-BASE36TS-HEX and is unique", () => {
    const a = generateOrderId("KIT");
    const b = generateOrderId("KIT");
    assert.match(a, /^KIT-[0-9A-Z]+-[0-9A-F]{10}$/);
    assert.notEqual(a, b);
  });
});
