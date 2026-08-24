const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000];

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * Returns true when an AI SDK or Gateway error represents a transient failure.
 * Gateway errors wrap the retryable APICallError, so inspect the complete cause
 * chain instead of relying only on the top-level error type.
 */
export function isTransientAiError(error) {
  const seen = new Set();

  function visit(value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return false;
    }
    if (seen.has(value)) return false;
    seen.add(value);

    if (value.isRetryable === true) return true;

    if (
      typeof value.statusCode === "number" &&
      (value.statusCode === 408 ||
        value.statusCode === 429 ||
        value.statusCode >= 500)
    ) {
      return true;
    }

    if (
      typeof value.code === "string" &&
      TRANSIENT_ERROR_CODES.has(value.code)
    ) {
      return true;
    }

    if (
      typeof value.message === "string" &&
      /\b(?:ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|UND_ERR_[A-Z_]+)\b/.test(
        value.message,
      )
    ) {
      return true;
    }

    // A malformed Gateway generation can omit finishReason or usage and make
    // AI SDK v6 throw before it can surface a typed provider error.
    if (
      typeof value.message === "string" &&
      /Cannot read properties of undefined \(reading ['"](?:unified|inputTokens)['"]\)/.test(
        value.message,
      )
    ) {
      return true;
    }

    if (visit(value.cause)) return true;

    if (value.lastError) {
      return visit(value.lastError);
    }

    if (Array.isArray(value.errors) && value.errors.length > 0) {
      return visit(value.errors.at(-1));
    }

    return false;
  }

  return visit(error);
}

/**
 * Retries transient AI provider and Gateway failures that the AI SDK cannot
 * retry itself, such as retryable APICallErrors wrapped in GatewayError.
 */
export async function retryAiCall(
  fn,
  {
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    onRetry = ({ attempt, attempts, delayMs, error }) => {
      console.error(
        `Transient AI call failure on attempt ${attempt}/${attempts} (${error.message}); retrying in ${delayMs / 1_000}s`,
      );
    },
  } = {},
) {
  const attempts = retryDelaysMs.length + 1;

  for (let index = 0; index < attempts; index++) {
    try {
      return await fn();
    } catch (error) {
      if (index === attempts - 1 || !isTransientAiError(error)) {
        throw error;
      }

      const delayMs = retryDelaysMs[index];
      onRetry({
        attempt: index + 1,
        attempts,
        delayMs,
        error,
      });
      await sleep(delayMs);
    }
  }
}
