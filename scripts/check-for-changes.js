#!/usr/bin/env node

/**
 * Orchestrator script that detects, analyzes, and records API changes for a provider.
 *
 * Usage:
 *   node scripts/check-for-changes.js <provider> <openapi_url> <filename>
 *
 * Arguments:
 *   provider    - e.g. "openai"
 *   openapi_url - URL to download the OpenAPI spec from
 *   filename    - local filename for the spec, e.g. "openapi.yml"
 *
 * Environment:
 *   AI_GATEWAY_API_KEY - AI Gateway API key (required when changes are detected)
 *
 * Outputs JSON to stdout:
 *   { has_changes: boolean, first_run: boolean, title: string, body: string }
 *
 * Progress messages are written to stderr.
 */

import { readFile, writeFile, mkdir, rm, glob } from "node:fs/promises";
import { basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import yaml from "js-yaml";

import { analyzeRouteChange } from "./lib/analyze-route-change.js";
import { appendChanges } from "./lib/append-changes.js";
import { deriveOperationId } from "./lib/derive-operation-id.js";
import { isIdenticalAfterNormalizingTimestamps } from "./lib/normalize-examples.js";

const exec = promisify(execFile);

const provider = process.argv[2];
const openapiUrl = process.argv[3];
const filename = process.argv[4];

if (!provider || !openapiUrl || !filename) {
  console.error(
    "Usage: node scripts/check-for-changes.js <provider> <openapi_url> <filename>"
  );
  process.exit(1);
}

// --- Step 1: Read existing route files into a Map ---
const oldRoutes = new Map();
for await (const filePath of glob(`cache/${provider}/routes/**/*.json`)) {
  const relativePath = filePath.replace(`cache/${provider}/routes/`, "");
  const content = await readFile(filePath, "utf8");
  oldRoutes.set(relativePath, content);
}
console.error(`Read ${oldRoutes.size} existing route files`);

// --- Step 2: Detect first run ---
const specPath = `cache/${provider}/${filename}`;
let isFirstRun = false;
try {
  await readFile(specPath);
} catch {
  isFirstRun = true;
}

// --- Step 3: Download fresh spec ---
await mkdir(`cache/${provider}`, { recursive: true });
console.error(`Downloading spec from ${openapiUrl}`);
let response;
for (let attempt = 1; attempt <= 3; attempt++) {
  response = await fetch(openapiUrl);
  if (response.ok) break;
  if (attempt < 3) {
    const delay = attempt === 1 ? 5000 : 30000;
    console.error(`Attempt ${attempt} failed (${response.status}), retrying in ${delay / 1000}s...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
if (!response.ok) {
  throw new Error(
    `Failed to download spec after 3 attempts: ${response.status} ${response.statusText}`
  );
}
const specContent = await response.text();
await writeFile(specPath, specContent);

// --- Step 4: Sort keys and format ---
console.error("Sorting keys with yq");
await exec("yq", ["-i", "-P", "sort_keys(..) | explode(.)", specPath]);

console.error("Formatting with prettier");
await exec("npx", ["prettier", "--write", specPath]);

// --- Step 5: Bundle and split into route files ---
console.error("Bundling and splitting into route files");
await rm(`cache/${provider}/routes`, { recursive: true, force: true });

const processedContent = await readFile(specPath, "utf8");
const schema = specPath.endsWith(".json")
  ? JSON.parse(processedContent)
  : yaml.load(processedContent);

removeXPrefix(schema);
// Don't dereference — keep $ref pointers to avoid duplicating shared schemas.
// yq's explode() already resolved YAML anchors in step 4.

const newRoutes = new Map();
if (schema.paths) {
  for (const [path, operations] of Object.entries(schema.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      const safePath = path.replaceAll("?", "_QMARK_").replaceAll("=", "_EQ_");
      const relativePath = `${safePath.slice(1)}/${method}.json`;
      const bundled = buildBundledRoute(operation, schema);
      const content = JSON.stringify(bundled, null, 2) + "\n";
      newRoutes.set(relativePath, content);

      const routeDir = `cache/${provider}/routes${safePath}`;
      await mkdir(routeDir, { recursive: true });
      await writeFile(`${routeDir}/${method}.json`, content);
    }
  }
}
console.error(`Generated ${newRoutes.size} route files`);

// --- Step 6: First run — skip analysis ---
if (isFirstRun) {
  console.error("First run detected, skipping analysis");
  console.log(
    JSON.stringify({ has_changes: false, first_run: true, title: "", body: "", changed_routes: [] })
  );
  process.exit(0);
}

// --- Step 7: Compare old vs new routes ---
const changedRoutes = [];

for (const [relativePath, newContent] of newRoutes) {
  const oldContent = oldRoutes.get(relativePath);
  if (!oldContent) {
    changedRoutes.push({
      relativePath,
      status: "A",
      oldContent: "",
      newContent,
    });
  } else if (oldContent !== newContent) {
    // Check if the only changes are timestamps in examples
    const onlyTimestampsChanged = isIdenticalAfterNormalizingTimestamps(
      oldContent,
      newContent
    );
    if (!onlyTimestampsChanged) {
      changedRoutes.push({
        relativePath,
        status: "M",
        oldContent,
        newContent,
      });
    } else {
      console.error(
        `Skipping ${relativePath} - only timestamps changed in examples`
      );
    }
  }
}

for (const [relativePath, oldContent] of oldRoutes) {
  if (!newRoutes.has(relativePath)) {
    changedRoutes.push({
      relativePath,
      status: "D",
      oldContent,
      newContent: "",
    });
  }
}

if (changedRoutes.length === 0) {
  console.error("No changes detected");
  console.log(
    JSON.stringify({
      has_changes: false,
      first_run: false,
      title: "",
      body: "",
      changed_routes: [],
    })
  );
  process.exit(0);
}

console.error(`Found ${changedRoutes.length} changed routes`);

// --- Step 8: Analyze each changed route ---
const today = new Date().toISOString().split("T")[0];

async function withConcurrency(items, limit, fn) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const p = fn(item).then((result) => {
      executing.delete(p);
      return result;
    });
    executing.add(p);
    results.push(p);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

function deriveRoute(relativePath) {
  const parts = relativePath.split("/");
  const methodFile = parts.pop();
  const method = basename(methodFile, ".json").toUpperCase();
  const routePath =
    "/" +
    parts
      .join("/")
      .replaceAll("_QMARK_", "?")
      .replaceAll("_EQ_", "=");
  return `${method} ${routePath}`;
}

const analysisResults = await withConcurrency(
  changedRoutes,
  5,
  async ({ relativePath, status, oldContent, newContent }) => {
    const route = deriveRoute(relativePath);
    console.error(`Analyzing: ${route} (${status})`);

    const result = await analyzeRouteChange({
      status,
      route,
      date: today,
      oldContent,
      newContent,
    });
    return result;
  }
);

const allChanges = [];
for (const result of analysisResults) {
  allChanges.push(...result.changes);
}

// --- Step 9: Append change records ---
await appendChanges(provider, allChanges);

// --- Step 10: Build PR title and body ---
let title;
if (allChanges.length === 1) {
  title = allChanges[0].note.substring(0, 100);
} else {
  title = `update ${provider} API specification (${allChanges.length} changes)`;
}

let body = "";
const breaking = allChanges.filter((c) => c.breaking);
const features = allChanges.filter(
  (c) => !c.breaking && c.change !== "removed" && !c.doc_only
);
const docFixes = allChanges.filter((c) => c.doc_only);

if (breaking.length > 0) {
  body += "### Breaking changes\n\n";
  for (const c of breaking) {
    body += `- **${c.route}**: ${c.note}\n`;
  }
  body += "\n";
}

if (features.length > 0) {
  body += "### New features\n\n";
  for (const c of features) {
    body += `- **${c.route}**: ${c.note}\n`;
  }
  body += "\n";
}

if (docFixes.length > 0) {
  body += "### Documentation fixes\n\n";
  for (const c of docFixes) {
    body += `- **${c.route}**: ${c.note}\n`;
  }
}

// --- Step 11: Build changed_routes for notifications ---
const changed_routes = changedRoutes.map(({ relativePath, status, oldContent, newContent }) => {
  // Use oldContent for deleted routes, newContent for added/modified
  const content = status === "D" ? oldContent : newContent;
  const operationId = deriveOperationId(relativePath, content);
  return { relativePath, status, operationId };
});

// --- Step 12: Output result ---
console.log(JSON.stringify({ has_changes: true, first_run: false, title, body, changed_routes }));

// --- Helpers ---

/**
 * Resolves a JSON pointer (e.g. "#/components/schemas/Foo") against a root object.
 */
function resolveRef(root, refPath) {
  const parts = refPath.replace("#/", "").split("/");
  let current = root;
  for (const part of parts) {
    current = current?.[part];
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * Walks an object and collects all $ref paths transitively.
 * Returns a Map of refPath -> resolved value.
 */
function collectRefsTransitively(root, obj) {
  const refs = new Map();
  const visited = new Set();
  const queue = [];

  function findRefs(obj) {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const item of obj) findRefs(item);
      return;
    }
    if (obj.$ref && typeof obj.$ref === "string" && !visited.has(obj.$ref)) {
      visited.add(obj.$ref);
      queue.push(obj.$ref);
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key !== "$ref") findRefs(value);
    }
  }

  findRefs(obj);
  while (queue.length > 0) {
    const refPath = queue.shift();
    const resolved = resolveRef(root, refPath);
    if (resolved) {
      refs.set(refPath, resolved);
      findRefs(resolved);
    }
  }
  return refs;
}

/**
 * Builds a self-contained route file that keeps $ref pointers but bundles
 * only the referenced schemas. The $ref paths (e.g. "#/components/schemas/X")
 * resolve correctly because schemas are placed at the same relative path.
 */
function buildBundledRoute(operation, fullSpec) {
  const refs = collectRefsTransitively(fullSpec, operation);
  if (refs.size === 0) return operation;

  // Group referenced values by their path in the spec
  // e.g. "#/components/schemas/Response" -> components.schemas.Response
  const extra = {};
  for (const [refPath, value] of refs) {
    const parts = refPath.replace("#/", "").split("/");
    let target = extra;
    for (let i = 0; i < parts.length - 1; i++) {
      target[parts[i]] = target[parts[i]] || {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
  }

  return { ...operation, ...extra };
}

function removeXPrefix(obj) {
  if (obj === null || typeof obj !== "object") {
    return;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      removeXPrefix(item);
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith("x-")) {
        delete obj[key];
      } else {
        removeXPrefix(value);
      }
    }
  }
}
