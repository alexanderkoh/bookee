/**
 * Typed Horizon failures.
 *
 * Sync errors reach the user as sentences, not stack traces, so each failure
 * mode carries the information the message needs. A failed request must never
 * be a reason to discard data that was already synced.
 */

export type StellarErrorKind =
  | "offline"
  | "timeout"
  | "account_not_found"
  | "rate_limited"
  | "server_error"
  | "bad_request"
  | "malformed_response"
  | "unknown";

export class StellarError extends Error {
  constructor(
    readonly kind: StellarErrorKind,
    message: string,
    readonly options: {
      status?: number | undefined;
      retryAfterSeconds?: number | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "StellarError";
  }

  /** Whether retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return (
      this.kind === "offline" ||
      this.kind === "timeout" ||
      this.kind === "rate_limited" ||
      this.kind === "server_error"
    );
  }

  /** A sentence suitable for showing directly in the sync status panel. */
  get userMessage(): string {
    switch (this.kind) {
      case "offline":
        return "Could not reach Horizon. Check your internet connection.";
      case "timeout":
        return "Horizon did not respond in time. Your synced data is unchanged.";
      case "account_not_found":
        return this.message;
      case "rate_limited":
        return this.options.retryAfterSeconds
          ? `Horizon temporarily rate-limited this request. Retrying in ${this.options.retryAfterSeconds}s.`
          : "Horizon temporarily rate-limited this request.";
      case "server_error":
        return "Horizon returned a server error. This is usually temporary.";
      case "bad_request":
        return `Horizon rejected the request: ${this.message}`;
      case "malformed_response":
        return "Horizon returned data in an unexpected format. The records were saved for diagnostics.";
      default:
        return this.message;
    }
  }
}

interface HttpLikeError {
  response?: { status?: number; headers?: Record<string, string>; data?: unknown };
  status?: number;
  message?: string;
  name?: string;
  code?: string;
}

/** Maps an SDK/network error onto a StellarError. */
export function toStellarError(
  error: unknown,
  context?: { accountId?: string; network?: string },
): StellarError {
  if (error instanceof StellarError) return error;

  const err = (error ?? {}) as HttpLikeError;
  const status = err.response?.status ?? err.status;
  const message = err.message ?? String(error);

  if (status === 404) {
    return new StellarError(
      "account_not_found",
      context?.accountId
        ? `Account does not exist on the ${context.network ?? "selected"} network: ${context.accountId}`
        : "Horizon returned 404 for this request.",
      { status, cause: error },
    );
  }

  if (status === 429) {
    const header = err.response?.headers?.["retry-after"];
    const retryAfterSeconds = header ? Number(header) : undefined;
    return new StellarError("rate_limited", "Horizon rate-limited this request.", {
      status,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
      cause: error,
    });
  }

  if (status !== undefined && status >= 500) {
    return new StellarError("server_error", `Horizon returned ${status}.`, {
      status,
      cause: error,
    });
  }

  if (status !== undefined && status >= 400) {
    return new StellarError("bad_request", message, { status, cause: error });
  }

  if (err.name === "AbortError" || err.code === "ETIMEDOUT" || /timeout/i.test(message)) {
    return new StellarError("timeout", "The request to Horizon timed out.", { cause: error });
  }

  if (/fetch|network|Failed to fetch|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    return new StellarError("offline", "Could not reach Horizon.", { cause: error });
  }

  return new StellarError("unknown", message, { cause: error });
}
