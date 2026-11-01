import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapTransactionStatus } from "../src/core/status.js";

describe("mapTransactionStatus", () => {
  const cases: Array<[string, string | null | undefined, string]> = [
    ["settlement", undefined, "paid"],
    ["settlement", "accept", "paid"],
    ["capture", "accept", "paid"],
    ["capture", "challenge", "pending"],
    ["capture", undefined, "pending"],
    ["pending", undefined, "pending"],
    ["deny", undefined, "failed"],
    ["cancel", undefined, "failed"],
    ["expire", undefined, "expired"],
    ["refund", undefined, "paid"],
    ["partial_refund", undefined, "paid"],
    ["something-new", undefined, "pending"], // unknown future statuses stay pending
    [undefined, undefined, "pending"], // missing status stays pending
  ];

  for (const [transactionStatus, fraudStatus, expected] of cases) {
    it(`${transactionStatus}${fraudStatus ? ` + fraud=${fraudStatus}` : ""} → ${expected}`, () => {
      const input = { transaction_status: transactionStatus, fraud_status: fraudStatus };
      assert.equal(mapTransactionStatus(input), expected);
    });
  }
});
