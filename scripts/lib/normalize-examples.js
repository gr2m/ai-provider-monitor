/**
 * Utility for normalizing examples by replacing timestamps with placeholders.
 * This helps detect when the only changes in an example are timestamp values.
 */

/**
 * Matches Unix timestamps (10-13 digit numbers typically representing seconds or milliseconds).
 * Unix timestamp range: 10^9 (Sept 2001) to 10^10 (Sept 2286)
 * We match 10-13 digit numbers as potential timestamps.
 */
const TIMESTAMP_PATTERN = /\b\d{10,13}\b/g;

/**
 * Matches ISO 8601 date formats like:
 * 2024-12-31T23:59:59Z
 * 2024-12-31T23:59:59.123Z
 * 2024-12-31T23:59:59+00:00
 */
const ISO_DATE_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})/g;

/**
 * Normalizes timestamps and dates in string values.
 * This helper is used within example/examples context.
 */
function normalizeTimestampsInValue(value) {
  if (typeof value === "string") {
    return value
      .replace(TIMESTAMP_PATTERN, "[TIMESTAMP]")
      .replace(ISO_DATE_PATTERN, "[ISO_DATE]");
  } else if (typeof value === "number") {
    // Check if the number looks like a timestamp (Unix timestamp in seconds/ms)
    if (/^\d{10,13}$/.test(String(value))) {
      return "[TIMESTAMP]";
    }
  }
  return value;
}

/**
 * Recursively normalize timestamps in all example/examples fields within an object.
 * When inside an example/examples context, normalizes all string and number values.
 */
function normalizeTimestampsInExamples(obj, inExampleContext = false) {
  if (obj === null || typeof obj !== "object") {
    if (inExampleContext) {
      return normalizeTimestampsInValue(obj);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) =>
      normalizeTimestampsInExamples(item, inExampleContext)
    );
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "example" || key === "examples") {
      // Enter example context for this subtree
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          normalizeTimestampsInExamples(item, true)
        );
      } else if (typeof value === "object" && value !== null) {
        result[key] = normalizeTimestampsInExamples(value, true);
      } else {
        result[key] = normalizeTimestampsInValue(value);
      }
    } else {
      // Recursively process other fields (not in example context unless already there)
      result[key] = normalizeTimestampsInExamples(value, inExampleContext);
    }
  }
  return result;
}

/**
 * Compares two JSON objects after normalizing timestamps in examples.
 * Returns true if the objects are identical after normalization.
 */
export function isIdenticalAfterNormalizingTimestamps(oldJson, newJson) {
  try {
    const oldObj = typeof oldJson === "string" ? JSON.parse(oldJson) : oldJson;
    const newObj = typeof newJson === "string" ? JSON.parse(newJson) : newJson;

    const normalizedOld = JSON.stringify(
      normalizeTimestampsInExamples(oldObj)
    );
    const normalizedNew = JSON.stringify(
      normalizeTimestampsInExamples(newObj)
    );

    return normalizedOld === normalizedNew;
  } catch {
    // If JSON parsing fails, fall back to string comparison
    return oldJson === newJson;
  }
}
