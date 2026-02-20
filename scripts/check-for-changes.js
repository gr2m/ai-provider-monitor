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
import { dirname, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import yaml from "js-yaml";
import $RefParser from "@apidevtools/json-schema-ref-parser";

import { analyzeRouteChange } from "./lib/analyze-route-change.js";
import { appendChanges } from "./lib/append-changes.js";

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
const response = await fetch(openapiUrl);
if (!response.ok) {
  throw new Error(
    `Failed to download spec: ${response.status} ${response.statusText}`
  );
}
const specContent = await response.text();
await writeFile(specPath, specContent);

// --- Step 4: Sort keys and format ---
console.error("Sorting keys with yq");
await exec("yq", ["-i", "-P", "sort_keys(..) | explode(.)", specPath]);

console.error("Formatting with prettier");
await exec("npx", ["prettier", "--write", specPath]);

// --- Step 5: Dereference and split into route files ---
console.error("Dereferencing and splitting into route files");
await rm(`cache/${provider}/routes`, { recursive: true, force: true });

const processedContent = await readFile(specPath, "utf8");
const schema = specPath.endsWith(".json")
  ? JSON.parse(processedContent)
  : yaml.load(processedContent);

removeXPrefix(schema);
await $RefParser.dereference(schema);

const newRoutes = new Map();
if (schema.paths) {
  for (const [path, operations] of Object.entries(schema.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      const safePath = path.replaceAll("?", "_QMARK_").replaceAll("=", "_EQ_");
      const relativePath = `${safePath.slice(1)}/${method}.json`;
      const content = JSON.stringify(operation, null, 2) + "\n";
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
    JSON.stringify({ has_changes: false, first_run: true, title: "", body: "" })
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
    changedRoutes.push({
      relativePath,
      status: "M",
      oldContent,
      newContent,
    });
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

// --- Step 11: Output result ---
console.log(JSON.stringify({ has_changes: true, first_run: false, title, body }));

// --- Helpers ---

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
