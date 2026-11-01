/**
 * Error type that surfaces Midtrans API errors readably.
 * Carries the HTTP status plus Midtrans-specific detail fields
 * (`status_message`, `validation_messages`) so CLI/MCP output can
 * show beginners exactly what the API complained about.
 */
export class MidtransError extends Error {
  readonly httpStatus?: number;
  readonly statusMessage?: string;
  readonly validationMessages: string[];

  constructor(
    message: string,
    options: {
      httpStatus?: number;
      statusMessage?: string;
      validationMessages?: string[];
    } = {},
  ) {
    super(message);
    this.name = "MidtransError";
    this.httpStatus = options.httpStatus;
    this.statusMessage = options.statusMessage;
    this.validationMessages = options.validationMessages ?? [];
  }

  /** Human-friendly, multi-line description for CLI output. */
  toDisplay(): string {
    const lines = [this.message];
    if (this.httpStatus !== undefined) lines.push(`  HTTP status: ${this.httpStatus}`);
    if (this.statusMessage) lines.push(`  Midtrans says: ${this.statusMessage}`);
    for (const v of this.validationMessages) lines.push(`  - ${v}`);
    return lines.join("\n");
  }
}

/** Thrown when no credentials could be resolved from flags/env/config. */
export class MissingCredentialsError extends Error {
  constructor(hint = "") {
    super(
      `No Midtrans credentials found.${hint ? ` ${hint}` : ""} Run \`midtrans login\` or set MIDTRANS_SERVER_KEY.`,
    );
    this.name = "MissingCredentialsError";
  }
}
