import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import yaml from "js-yaml";

const SCHEMA = {
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
};

async function callOpenAI(prompt, schema) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5",
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "route_analysis", schema },
      },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OpenAI API error: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
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
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  let prompt;
  if (status === "A") {
    prompt = `A new API route was added: ${route}

Here is the full dereferenced OpenAPI specification for this route:

${newContent}

Produce change records for this addition. Since the entire route is new, create a single record with change "added" and target "route". Include a brief note describing what this endpoint does. The paths array should be empty for route-level additions.

Also provide a one-line summary (max 100 chars).`;
  } else if (status === "D") {
    prompt = `An API route was removed: ${route}

Here was the full dereferenced OpenAPI specification for this route:

${oldContent}

Produce change records for this removal. Create a single record with change "removed", target "route", breaking true. Include a brief note describing what this endpoint was. The paths array should be empty for route-level removals.

Also provide a one-line summary (max 100 chars).`;
  } else {
    prompt = `An API route was modified: ${route}

Here is the OLD dereferenced specification:

${oldContent}

Here is the NEW dereferenced specification:

${newContent}

Analyze the differences and produce change records. For each logical change, create a record with:
- change: "added" (new property/option), "changed" (type/value change), or "removed" (property/option gone)
- target: "request" or "response"
- breaking: true if the change could break existing consumers
- deprecated: true if something was marked as deprecated
- doc_only: true if only descriptions/examples changed, not schema structure
- note: human-readable description of the change
- paths: array of {path, before, after} with JSON-path-like notation relative to the route spec. Use "null" string for before on additions and after on removals.

Also provide a one-line summary of all changes to this route (max 100 chars).`;
  }

  const result = await callOpenAI(prompt, SCHEMA);

  for (const change of result.changes) {
    change.route = route;
    change.date = date;
  }

  return result;
}
