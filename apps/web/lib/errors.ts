import { showErrorToast } from "./toast";

/**
 * Discriminator used to categorize application errors.
 *
 * - `"network"` — connectivity, timeout, or fetch failures.
 * - `"contract"` — on-chain / smart-contract related errors.
 * - `"validation"` — input validation, missing fields, or disconnected wallet.
 * - `"unknown"` — fallback when no specific category applies.
 */
export type ErrorType = "network" | "contract" | "validation" | "unknown";

/**
 * Standardized error class that wraps any caught error with extra context.
 *
 * All fields are set at construction time and remain read-only afterward.
 *
 * @example
 * ```ts
 * const err = new AppError({
 *   type: "contract",
 *   context: "useProfile",
 *   message: "Transaction rejected",
 *   originalError: rawError,
 * });
 * ```
 */
export class AppError extends Error {
  readonly type: ErrorType;
  readonly context: string;
  readonly timestamp: number;
  readonly originalError: unknown;

  /**
   * @param params - Error configuration.
   *   - `type` — The error category.
   *   - `context` — Name of the module or hook that produced the error.
   *   - `message` — Human-readable description of what went wrong.
   *   - `originalError` — The raw error object, if any, that was caught.
   */
  constructor(params: {
    type: ErrorType;
    context: string;
    message: string;
    originalError?: unknown;
  }) {
    super(params.message);
    this.name = "AppError";
    this.type = params.type;
    this.context = params.context;
    this.timestamp = Date.now();
    this.originalError = params.originalError;
  }
}

/**
 * Determines the {@link ErrorType} category for a given error value.
 *
 * Classification rules (in order):
 * 1. If the error is an {@link AppError}, its own `type` is returned.
 * 2. `TypeError` instances are classified as `"network"`.
 * 3. `Error` instances whose message contains "network", "fetch", or
 *    "timeout" are classified as `"network"`.
 * 4. `Error` instances whose message contains "invalid", "required", or
 *    "not connected" are classified as `"validation"`.
 * 5. Everything else falls back to `"contract"`.
 *
 * @param err - The error value to classify.
 * @returns The {@link ErrorType} that best describes the error.
 *
 * @example
 * ```ts
 * classifyError(new TypeError("Failed to fetch")); // "network"
 * classifyError(new Error("Amount is required"));   // "validation"
 * ```
 */
export function classifyError(err: unknown): ErrorType {
  if (err instanceof AppError) return err.type;
  if (err instanceof TypeError) return "network";
  if (
    err instanceof Error &&
    (err.message.toLowerCase().includes("network") ||
      err.message.toLowerCase().includes("fetch") ||
      err.message.toLowerCase().includes("timeout"))
  ) {
    return "network";
  }
  if (
    err instanceof Error &&
    (err.message.toLowerCase().includes("invalid") ||
      err.message.toLowerCase().includes("required") ||
      err.message.toLowerCase().includes("not connected"))
  ) {
    return "validation";
  }
  return "contract";
}

/**
 * Extracts a human-readable message from an unknown error value.
 *
 * `AppError` and `Error` instances use their `message` property, string
 * values are returned as-is, and everything else falls back to a generic
 * message. Note: `extractMessage` uses `err.message` for `Error` instances,
 * whereas {@link getErrorMessage} also checks for a `message` property on
 * plain objects.
 *
 * @param err - The error value to extract a message from.
 * @returns A string message describing the error.
 */
function extractMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unexpected error occurred";
}

const KNOWN_ERRORS: Record<string, string> = {
  "Wallet not connected": "Please connect your wallet to perform this action",
  "tx_bad_auth": "Authorization failed. Reconnect your wallet and sign the transaction again.",
  "insufficient_resource": "The transaction exceeded its resource budget. Refresh the simulation and try again.",
  "no_such_contract": "This contract is not available on the selected network. Switch to Testnet and retry.",
};

/**
 * Extracts the message from an unknown error value.
 *
 * String errors are returned as-is, `Error` instances use their `message`
 * property, and plain objects with a string `message` property have it
 * returned. Any other value (including `null` and `undefined`) resolves to
 * the provided `fallback`.
 *
 * @param error - The error value to extract a message from.
 * @param fallback - Message returned when the error has no recognizable
 *   message. Defaults to `'An unexpected error occurred'`.
 * @returns The extracted error message, or `fallback` when none is available.
 *
 * @example
 * ```ts
 * getErrorMessage("Wallet not connected");          // "Wallet not connected"
 * getErrorMessage(new Error("Boom"), "Oops");       // "Boom"
 * getErrorMessage({ code: 404 }, "Oops");           // "Oops"
 * ```
 */
export function getErrorMessage(
  error: unknown,
  fallback = "An unexpected error occurred",
): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

/**
 * Converts an error into a user-friendly message.
 *
 * Resolves the raw message via {@link getErrorMessage} and, if it matches a
 * known error, replaces it with a friendlier equivalent. Unrecognized
 * messages are passed through unchanged.
 *
 * @param error - The error value to convert.
 * @returns The friendly message string for the error.
 *
 * @example
 * ```ts
 * getUserFriendlyMessage(new Error("Wallet not connected"));
 * // "Please connect your wallet to perform this action"
 * ```
 */
export function getUserFriendlyMessage(error: unknown): string {
  const message = getErrorMessage(error);
  return KNOWN_ERRORS[message] || message;
}

/**
 * Creates a scoped error handler for a given context.
 *
 * `captureError` classifies and formats any error into an {@link AppError}
 * (logging it to the console in the process). `handleError` additionally
 * shows a toast when an `action` is provided, while `handleMutationError`
 * always shows a toast.
 *
 * @param context - Name of the module or hook the handler is bound to; used
 *   as the context label of every produced {@link AppError} and console log.
 * @returns An object containing:
 *   - `captureError` — `(error: unknown) => AppError` — Wraps an error into
 *     an {@link AppError}, logging it to the console.
 *   - `handleError` — `(error: unknown, action?: string) => AppError` —
 *     Wraps the error and shows a toast when `action` is provided.
 *   - `handleMutationError` — `(error: unknown, action: string) => void` —
 *     Wraps the error and always shows a toast.
 *
 * @example
 * ```ts
 * const { captureError, handleError } = createErrorHandler("useProfile");
 * const appError = captureError(err);
 * handleError(err, "Failed to load profile");
 * ```
 */
export function createErrorHandler(context: string) {
  function captureError(error: unknown) {
    const type = classifyError(error);
    const message = extractMessage(error);
    console.error(
      `[${new Date().toISOString()}] [${context}] [${type}] ${message}`,
      error,
    );
    return new AppError({ type, context, message, originalError: error });
  }

  function handleError(error: unknown, action?: string): AppError {
    const appError = captureError(error);
    if (action) {
      showErrorToast(action, appError);
    }
    return appError;
  }

  function handleMutationError(error: unknown, action: string) {
    const appError = captureError(error);
    showErrorToast(action, appError);
  }

  return { captureError, handleError, handleMutationError };
}
