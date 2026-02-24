/**
 * Derives an operationId from a route's JSON content.
 *
 * - Returns the `operationId` field if present in the parsed JSON.
 * - For non-operation files (parameters.json, servers.json, description.json), returns null.
 * - When `operationId` is missing, generates one from method + path segments:
 *   e.g. GET /batches/{id} → "get_batches"
 *
 * @param {string} relativePath - Route relative path like "batches/{id}/get.json"
 * @param {string} jsonContent  - The JSON content of the route file
 * @returns {string|null} The operationId or null for non-operation files
 */
export function deriveOperationId(relativePath, jsonContent) {
  // Non-operation files don't have an operationId
  const filename = relativePath.split("/").pop();
  const nonOperationFiles = [
    "parameters.json",
    "servers.json",
    "description.json",
  ];
  if (nonOperationFiles.includes(filename)) {
    return null;
  }

  // Try to extract operationId from the JSON content
  try {
    const parsed = JSON.parse(jsonContent);
    if (parsed.operationId) {
      return parsed.operationId;
    }
  } catch {
    // If JSON parsing fails, fall through to generation
  }

  // Generate operationId from method + path segments
  const parts = relativePath.split("/");
  const methodFile = parts.pop(); // e.g. "get.json"
  const method = methodFile.replace(".json", "").toLowerCase();

  // Filter out path parameter segments like {id}
  const pathSegments = parts.filter((p) => !p.startsWith("{"));

  // Strip query string encoding (_QMARK_ onwards) from segments
  const cleanSegments = pathSegments.map((s) => {
    const qmarkIndex = s.indexOf("_QMARK_");
    return qmarkIndex >= 0 ? s.slice(0, qmarkIndex) : s;
  });

  if (cleanSegments.length === 0) {
    return method;
  }

  return `${method}_${cleanSegments.join("_")}`;
}
