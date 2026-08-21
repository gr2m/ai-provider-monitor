import yaml from "js-yaml";

const DEFAULT_RETRY_DELAYS_MS = [5_000, 30_000];

/**
 * Downloads text with bounded retries for HTTP errors, network failures, and
 * response-body read errors.
 */
export async function downloadText(
  url,
  {
    fetchImpl = globalThis.fetch,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    timeoutMs = 120_000,
    onRetry = ({ attempt, error, delayMs }) => {
      console.error(
        `Download attempt ${attempt} failed (${error.message}); retrying in ${delayMs / 1_000}s...`,
      );
    },
  } = {},
) {
  const attempts = retryDelaysMs.length + 1;
  let lastError;

  for (let index = 0; index < attempts; index++) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
        );
      }

      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (index === attempts - 1) {
        break;
      }

      const delayMs = retryDelaysMs[index];
      onRetry({ attempt: index + 1, error: lastError, delayMs, url });
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Failed to download ${url} after ${attempts} attempts: ${lastError.message}`,
    { cause: lastError },
  );
}

/**
 * Reads a dot-separated property from YAML/JSON metadata and validates that it
 * resolves to an HTTP(S) URL.
 */
export function resolveUrlFromMetadata(content, property, metadataUrl) {
  let metadata;
  try {
    metadata = yaml.load(content);
  } catch (error) {
    throw new Error(`Failed to parse metadata from ${metadataUrl}`, {
      cause: error,
    });
  }

  let value = metadata;
  for (const segment of property.split(".")) {
    value = value?.[segment];
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Metadata property ${property} from ${metadataUrl} is not a non-empty string`,
    );
  }

  const resolvedUrl = new URL(value, metadataUrl);
  if (resolvedUrl.protocol !== "http:" && resolvedUrl.protocol !== "https:") {
    throw new Error(
      `Metadata property ${property} from ${metadataUrl} does not resolve to an HTTP(S) URL`,
    );
  }

  return resolvedUrl.href;
}
