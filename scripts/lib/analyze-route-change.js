import { generateText, Output, jsonSchema } from "ai";
import { isIdenticalAfterNormalizingTimestamps } from "./normalize-examples.js";

/**
 * Recursively strips "description", "example", and "examples" keys from an object.
 * Returns a new object with only the structural schema properties.
 */
function stripDocsFromSpec(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripDocsFromSpec);

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "description" || key === "example" || key === "examples") continue;
    result[key] = stripDocsFromSpec(value);
  }
  return result;
}

const SCHEMA = jsonSchema({
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          change: { type: "string", enum: ["added", "changed", "removed"] },
          target: { type: "string", enum: ["route", "request", "response"] },
          breaking: { type: "boolean" },
          deprecated: { type: "boolean" },
          doc_only: { type: "boolean" },
          note: { type: "string" },
          paths: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                before: { type: "string" },
                after: { type: "string" },
              },
              required: ["path", "before", "after"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "change",
          "target",
          "breaking",
          "deprecated",
          "doc_only",
          "note",
          "paths",
        ],
        additionalProperties: false,
      },
    },
    summary: {
      type: "string",
      description: "One-line summary of changes to this route (max 100 chars)",
    },
  },
  required: ["changes", "summary"],
  additionalProperties: false,
});

function buildPrompt(status, route, oldSpec, newSpec) {
  if (status === "A") {
    return `A new API route was added: ${route}

Here is the full dereferenced OpenAPI specification for this route:

${newSpec}

Produce change records for this addition. Since the entire route is new, create a single record with change "added" and target "route". Include a brief note describing what this endpoint does. The paths array should be empty for route-level additions.

Also provide a one-line summary (max 100 chars).`;
  } else if (status === "D") {
    return `An API route was removed: ${route}

Here was the full dereferenced OpenAPI specification for this route:

${oldSpec}

Produce change records for this removal. Create a single record with change "removed", target "route", breaking true. Include a brief note describing what this endpoint was. The paths array should be empty for route-level removals.

Also provide a one-line summary (max 100 chars).`;
  } else {
    return `An API route was modified: ${route}

Here is the OLD dereferenced specification:

${oldSpec}

Here is the NEW dereferenced specification:

${newSpec}

Analyze the differences and produce change records. For each logical change, create a record with:
- change: "added" (new property/option), "changed" (type/value change), or "removed" (property/option gone)
- target: "request" or "response"
- breaking: true if the change could break existing consumers
- deprecated: true if something was marked as deprecated
- doc_only: true if only descriptions/examples changed, not schema structure. Ignore if only examples changed.
- note: human-readable description of the change
- paths: array of {path, before, after} with JSON-path-like notation relative to the route spec. Use "null" string for before on additions and after on removals.

Also provide a one-line summary of all changes to this route (max 100 chars).`;
  }
}

/**
 * Computes a structural diff between two JSON objects.
 * Returns an array of {path, type, old?, new?} entries.
 */
function computeStructuralDiff(oldObj, newObj, path = "") {
  const diffs = [];

  if (oldObj === newObj) return diffs;
  if (oldObj === null || newObj === null || typeof oldObj !== typeof newObj) {
    diffs.push({ path: path || "(root)", type: "changed", old: summarizeValue(oldObj), new: summarizeValue(newObj) });
    return diffs;
  }
  if (typeof oldObj !== "object") {
    if (oldObj !== newObj) diffs.push({ path, type: "changed", old: summarizeValue(oldObj), new: summarizeValue(newObj) });
    return diffs;
  }

  if (Array.isArray(oldObj) && Array.isArray(newObj)) {
    const maxLen = Math.max(oldObj.length, newObj.length);
    for (let i = 0; i < maxLen; i++) {
      if (i >= oldObj.length) {
        diffs.push({ path: `${path}[${i}]`, type: "added", new: summarizeValue(newObj[i]) });
      } else if (i >= newObj.length) {
        diffs.push({ path: `${path}[${i}]`, type: "removed", old: summarizeValue(oldObj[i]) });
      } else {
        diffs.push(...computeStructuralDiff(oldObj[i], newObj[i], `${path}[${i}]`));
      }
    }
    return diffs;
  }

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  for (const key of allKeys) {
    const newPath = path ? `${path}.${key}` : key;
    if (!(key in oldObj)) {
      diffs.push({ path: newPath, type: "added", new: summarizeValue(newObj[key]) });
    } else if (!(key in newObj)) {
      diffs.push({ path: newPath, type: "removed", old: summarizeValue(oldObj[key]) });
    } else {
      diffs.push(...computeStructuralDiff(oldObj[key], newObj[key], newPath));
    }
  }
  return diffs;
}

function summarizeValue(val) {
  if (val === null || val === undefined) return String(val);
  if (typeof val !== "object") return String(val);
  const s = JSON.stringify(val);
  if (s.length <= 300) return s;
  return s.substring(0, 300) + "...";
}

function buildDiffPrompt(status, route, oldContent, newContent) {
  if (status !== "M") {
    // For additions/deletions, strip docs and use standard prompt
    const spec = status === "A" ? newContent : oldContent;
    const stripped = JSON.stringify(stripDocsFromSpec(JSON.parse(spec)), null, 2);
    return buildPrompt(status, route, status === "D" ? stripped : "", status === "A" ? stripped : "");
  }

  const oldObj = JSON.parse(oldContent);
  const newObj = JSON.parse(newContent);
  const diffs = computeStructuralDiff(oldObj, newObj);

  const diffText = diffs.map(d => {
    if (d.type === "added") return `ADDED ${d.path}: ${d.new}`;
    if (d.type === "removed") return `REMOVED ${d.path}: ${d.old}`;
    return `CHANGED ${d.path}: ${d.old} → ${d.new}`;
  }).join("\n");

  return `An API route was modified: ${route}

Here is a structural diff of the changes (${diffs.length} differences found):

${diffText}

Analyze the differences and produce change records. For each logical change, create a record with:
- change: "added" (new property/option), "changed" (type/value change), or "removed" (property/option gone)
- target: "request" or "response"
- breaking: true if the change could break existing consumers
- deprecated: true if something was marked as deprecated
- doc_only: true if only descriptions/examples changed, not schema structure. Ignore if only examples changed.
- note: human-readable description of the change
- paths: array of {path, before, after} with JSON-path-like notation relative to the route spec. Use "null" string for before on additions and after on removals.

Also provide a one-line summary of all changes to this route (max 100 chars).`;
}

/**
 * Analyzes a single route change by comparing old and new content.
 *
 * @param {object} options
 * @param {string} options.status - A (added), M (modified), D (deleted)
 * @param {string} options.route - e.g. "POST /v1/chat/completions"
 * @param {string} options.date - ISO date, e.g. "2026-02-19"
 * @param {string} options.oldContent - old route spec content (empty for additions)
 * @param {string} options.newContent - new route spec content (empty for deletions)
 * @returns {Promise<{changes: Array, summary: string}>}
 */
export async function analyzeRouteChange({
  status,
  route,
  date,
  oldContent,
  newContent,
}) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error("AI_GATEWAY_API_KEY environment variable is required");
  }

  // Check if only timestamps changed in examples (for modified routes)
  if (
    status === "M" &&
    oldContent &&
    newContent &&
    isIdenticalAfterNormalizingTimestamps(oldContent, newContent)
  ) {
    // Return a doc_only change indicating only timestamps/examples changed
    return {
      changes: [
        {
          route,
          date,
          change: "changed",
          target: "response",
          breaking: false,
          deprecated: false,
          doc_only: true,
          note: "Example timestamp values updated",
          paths: [
            {
              path: "examples",
              before: "[timestamps]",
              after: "[timestamps]",
            },
          ],
        },
      ],
      summary: "Example timestamps updated",
    };
  }

  const prompt = buildPrompt(status, route, oldContent, newContent);

  let result;
  try {
    ({ output: result } = await generateText({
      model: "openai/gpt-5",
      prompt,
      output: Output.object({ schema: SCHEMA }),
      temperature: 0.1,
    }));
  } catch (error) {
    if (!error.message?.includes("exceeds the context window")) {
      throw error;
    }

    // Tier 2: Retry with stripped descriptions/examples to fit within context window
    console.error(`Context window exceeded for ${route}, retrying with stripped spec`);

    const oldSpec = oldContent ? JSON.stringify(stripDocsFromSpec(JSON.parse(oldContent)), null, 2) : "";
    const newSpec = newContent ? JSON.stringify(stripDocsFromSpec(JSON.parse(newContent)), null, 2) : "";

    const strippedPrompt = buildPrompt(status, route, oldSpec, newSpec);

    try {
      ({ output: result } = await generateText({
        model: "openai/gpt-5",
        prompt: strippedPrompt,
        output: Output.object({ schema: SCHEMA }),
        temperature: 0.1,
      }));
    } catch (strippedError) {
      if (!strippedError.message?.includes("exceeds the context window")) {
        throw strippedError;
      }

      // Tier 3: Compute a structural diff and send only that
      console.error(`Context window still exceeded for ${route}, retrying with diff-only`);

      const diffPrompt = buildDiffPrompt(status, route, oldContent, newContent);

      ({ output: result } = await generateText({
        model: "openai/gpt-5",
        prompt: diffPrompt,
        output: Output.object({ schema: SCHEMA }),
        temperature: 0.1,
      }));
    }
  }

  for (const change of result.changes) {
    change.route = route;
    change.date = date;
  }

  return result;
}
