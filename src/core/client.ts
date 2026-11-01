import { randomBytes } from "node:crypto";
import { MidtransError } from "./errors.js";
import type { Environment } from "./config.js";

const SNAP_BASE: Record<Environment, string> = {
  sandbox: "https://app.sandbox.midtrans.com",
  production: "https://app.midtrans.com",
};

const API_BASE: Record<Environment, string> = {
  sandbox: "https://api.sandbox.midtrans.com",
  production: "https://api.midtrans.com",
};

/** Subset of the Snap /snap/v1/transactions payload we build for users. */
export interface SnapTransactionPayload {
  transaction_details: {
    order_id: string;
    gross_amount: number;
  };
  item_details?: Array<{
    id?: string;
    price: number;
    quantity: number;
    name: string;
  }>;
  customer_details?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  /** Page the customer lands on after finishing payment. */
  callbacks?: { finish?: string };
}

export interface SnapTransactionResult {
  token: string;
  redirect_url: string;
}

/** Well-known fields of GET /v2/{order_id}/status (payloads gain fields over
 * time — always keep unknown fields when relaying/storing). */
export interface TransactionStatus {
  transaction_time?: string;
  transaction_status?: string;
  transaction_id?: string;
  status_message?: string;
  status_code?: string;
  order_id?: string;
  payment_type?: string;
  gross_amount?: string;
  fraud_status?: string;
  currency?: string;
  merchant_id?: string;
  settlement_time?: string;
  expiry_time?: string;
  masked_card?: string;
  bank?: string;
  [key: string]: unknown;
}

export interface RefundResult {
  status_code?: string;
  status_message?: string;
  refund_chargeback_id?: number;
  refund_amount?: string;
  refund_key?: string;
  [key: string]: unknown;
}

export interface CredentialsValidation {
  valid: boolean;
  environment: Environment;
  httpStatus?: number;
  message: string;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/**
 * Minimal, dependency-free Midtrans API client.
 * Auth: HTTP Basic with the server key as username and empty password,
 * exactly like Midtrans SDKs: `Authorization: Basic base64(serverKey + ":")`.
 */
export class MidtransClient {
  constructor(
    private readonly creds: {
      serverKey: string;
      environment: Environment;
    },
  ) {}

  private snapUrl(path: string): string {
    return `${SNAP_BASE[this.creds.environment]}${path}`;
  }

  private apiUrl(path: string): string {
    return `${API_BASE[this.creds.environment]}${path}`;
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.creds.serverKey}:`).toString("base64")}`;
  }

  /** JSON request with Basic auth + retry/backoff on 429/5xx and network errors. */
  private async request<T>(
    url: string,
    init: RequestInit = {},
    context: { errorMessage: string },
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: this.authHeader(),
            ...init.headers,
          },
        });
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) {
          await delay(backoffMs(attempt));
          continue;
        }
        throw new MidtransError(
          `Network error talking to Midtrans (${context.errorMessage}): ${(error as Error).message}`,
        );
      }

      const text = await response.text();
      let body: unknown = undefined;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = { raw: text };
        }
      }

      if (response.ok) return body as T;

      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        await delay(backoffMs(attempt));
        continue;
      }

      const record = (body ?? {}) as Record<string, unknown>;
      throw new MidtransError(context.errorMessage, {
        httpStatus: response.status,
        statusMessage: typeof record.status_message === "string" ? record.status_message : undefined,
        validationMessages: Array.isArray(record.validation_messages)
          ? (record.validation_messages as string[])
          : [],
      });
    }
    throw lastError instanceof Error ? lastError : new MidtransError("Request failed");
  }

  /** POST /snap/v1/transactions → { token, redirect_url } */
  async snapCreate(payload: SnapTransactionPayload): Promise<SnapTransactionResult> {
    return this.request<SnapTransactionResult>(this.snapUrl("/snap/v1/transactions"), {
      method: "POST",
      body: JSON.stringify(payload),
    }, { errorMessage: "Failed to create Snap transaction" });
  }

  /** GET /v2/{order_id}/status */
  async status(orderId: string): Promise<TransactionStatus> {
    const body = await this.request<TransactionStatus>(
      this.apiUrl(`/v2/${encodeURIComponent(orderId)}/status`),
      { method: "GET" },
      { errorMessage: `Failed to fetch status for order "${orderId}"` },
    );
    // Some Midtrans deployments answer unknown orders with HTTP 200 and a
    // body-level {"status_code":"404","status_message":"Transaction doesn't exist."}.
    // Normalize that to a real not-found error so callers can't mistake it
    // for a pending transaction.
    if (body.status_code === "404") {
      throw new MidtransError(
        `Transaction not found for order "${orderId}" — no such order on this merchant.`,
        { httpStatus: 404, statusMessage: body.status_message },
      );
    }
    return body;
  }

  /** POST /v2/{order_id}/approve — accept a challenged card transaction. */
  async approve(orderId: string): Promise<Record<string, unknown>> {
    return this.request(this.apiUrl(`/v2/${encodeURIComponent(orderId)}/approve`), {
      method: "POST",
      body: JSON.stringify({}),
    }, { errorMessage: `Failed to approve order "${orderId}"` });
  }

  /** POST /v2/{order_id}/deny */
  async deny(orderId: string): Promise<Record<string, unknown>> {
    return this.request(this.apiUrl(`/v2/${encodeURIComponent(orderId)}/deny`), {
      method: "POST",
      body: JSON.stringify({}),
    }, { errorMessage: `Failed to deny order "${orderId}"` });
  }

  /** POST /v2/{order_id}/cancel — void an unsettled transaction. */
  async cancel(orderId: string): Promise<Record<string, unknown>> {
    return this.request(this.apiUrl(`/v2/${encodeURIComponent(orderId)}/cancel`), {
      method: "POST",
      body: JSON.stringify({}),
    }, { errorMessage: `Failed to cancel order "${orderId}"` });
  }

  /** POST /v2/{order_id}/expire — force-expire; the order_id becomes reusable. */
  async expire(orderId: string): Promise<Record<string, unknown>> {
    return this.request(this.apiUrl(`/v2/${encodeURIComponent(orderId)}/expire`), {
      method: "POST",
      body: JSON.stringify({}),
    }, { errorMessage: `Failed to expire order "${orderId}"` });
  }

  /** POST /v2/{order_id}/refund — unified refund, works for all channels. */
  async refund(
    orderId: string,
    options: { amount?: number; reason?: string; refundKey?: string } = {},
  ): Promise<RefundResult> {
    const body: Record<string, unknown> = {
      reason: options.reason ?? "midtrans-kit refund",
    };
    if (options.amount !== undefined) body.amount = Math.round(options.amount);
    body.refund_key = options.refundKey ?? `refund-${orderId}-${randomBytes(4).toString("hex")}`;
    return this.request<RefundResult>(
      this.apiUrl(`/v2/${encodeURIComponent(orderId)}/refund`),
      { method: "POST", body: JSON.stringify(body) },
      { errorMessage: `Failed to refund order "${orderId}"` },
    );
  }

  /**
   * Cheap live key check: query a guaranteed-nonexistent order.
   *   401/403 → key rejected (invalid)
   *   404     → auth accepted, order simply doesn't exist → key valid
   *   200     → (never happens for a random probe id) key valid
   */
  async validateCredentials(): Promise<CredentialsValidation> {
    const probeId = `midtrans-kit-probe-${randomBytes(6).toString("hex")}`;
    try {
      await this.status(probeId);
      return {
        valid: true,
        environment: this.creds.environment,
        message: "Key accepted by Midtrans.",
      };
    } catch (error) {
      if (error instanceof MidtransError) {
        if (error.httpStatus === 401 || error.httpStatus === 403) {
          return {
            valid: false,
            environment: this.creds.environment,
            httpStatus: error.httpStatus,
            message: "Midtrans rejected the key (unauthorized). Check the server key and environment.",
          };
        }
        if (error.httpStatus === 404) {
          return {
            valid: true,
            environment: this.creds.environment,
            httpStatus: 404,
            message: "Key accepted (probe order not found, as expected).",
          };
        }
        return {
          valid: false,
          environment: this.creds.environment,
          httpStatus: error.httpStatus,
          message: error.statusMessage ?? error.message,
        };
      }
      return {
        valid: false,
        environment: this.creds.environment,
        message: (error as Error).message,
      };
    }
  }
}

function backoffMs(attempt: number): number {
  return 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
