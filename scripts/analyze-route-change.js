#!/usr/bin/env node

/**
 * Analyzes a single route change by comparing old and new dereferenced specs.
 *
 * Usage:
 *   node scripts/analyze-route-change.js <status> <route> <date> [old-file] [new-file]
 *
 * Arguments:
 *   status   - A (added), M (modified), D (deleted)
 *   route    - e.g. "POST /v1/chat/completions"
 *   date     - ISO date, e.g. "2026-02-19"
 *   old-file - path to the old route spec (required for M and D)
 *   new-file - path to the new route spec (required for M and A)
 *
 * Environment:
 *   AI_GATEWAY_API_KEY - AI Gateway API key
 *
 * Outputs JSON to stdout: { changes: [...], summary: "..." }
 */

import { readFile } from "node:fs/promises";

import { analyzeRouteChange } from "./lib/analyze-route-change.js";

const status = process.argv[2];
const route = process.argv[3];
const date = process.argv[4];
const oldFile = process.argv[5];
const newFile = process.argv[6];

if (!status || !route || !date) {
  console.error(
    "Usage: node scripts/analyze-route-change.js <status> <route> <date> [old-file] [new-file]"
  );
  process.exit(1);
}

async function readFileOrEmpty(filePath) {
  if (!filePath) return "";
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

const oldContent = await readFileOrEmpty(oldFile);
const newContent = await readFileOrEmpty(newFile);

const result = await analyzeRouteChange({
  status,
  route,
  date,
  oldContent,
  newContent,
});

console.log(JSON.stringify(result));
