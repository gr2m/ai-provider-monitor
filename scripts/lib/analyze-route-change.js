import { generateText, Output, jsonSchema } from "ai";

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

    // Retry with stripped descriptions/examples to fit within context window
    console.error(`Context window exceeded for ${route}, retrying with stripped spec`);

    const oldSpec = oldContent ? JSON.stringify(stripDocsFromSpec(JSON.parse(oldContent)), null, 2) : "";
    const newSpec = newContent ? JSON.stringify(stripDocsFromSpec(JSON.parse(newContent)), null, 2) : "";

    const strippedPrompt = buildPrompt(status, route, oldSpec, newSpec);

    ({ output: result } = await generateText({
      model: "openai/gpt-5",
      prompt: strippedPrompt,
      output: Output.object({ schema: SCHEMA }),
      temperature: 0.1,
    }));
  }

  for (const change of result.changes) {
    change.route = route;
    change.date = date;
  }

  return result;
}
