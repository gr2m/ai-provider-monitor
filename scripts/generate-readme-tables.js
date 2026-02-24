#!/usr/bin/env node

/**
 * Generates Markdown tables per provider listing all routes and their
 * repository dispatch event types.
 *
 * Usage:
 *   node scripts/generate-readme-tables.js
 *
 * Output is written to stdout — paste into README.md.
 */

import { readFile, readdir } from "node:fs/promises";
import { basename } from "node:path";
import { glob } from "node:fs/promises";

import { deriveOperationId } from "./lib/derive-operation-id.js";

const cacheDir = "cache";
const providers = (await readdir(cacheDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const provider of providers) {
  const routes = [];

  for await (const filePath of glob(
    `${cacheDir}/${provider}/routes/**/*.json`
  )) {
    const relativePath = filePath.replace(
      `${cacheDir}/${provider}/routes/`,
      ""
    );

    // Derive method and route path from relativePath
    const parts = relativePath.split("/");
    const methodFile = parts.pop();
    const method = basename(methodFile, ".json").toUpperCase();
    const routePath =
      "/" +
      parts
        .join("/")
        .replaceAll("_QMARK_", "?")
        .replaceAll("_EQ_", "=");

    const content = await readFile(filePath, "utf8");
    const operationId = deriveOperationId(relativePath, content);

    if (!operationId) continue;

    const eventType = `api:${provider}:${operationId}`;

    routes.push({ method, routePath, eventType });
  }

  // Sort by route path, then method
  routes.sort((a, b) => {
    const pathCmp = a.routePath.localeCompare(b.routePath);
    if (pathCmp !== 0) return pathCmp;
    return a.method.localeCompare(b.method);
  });

  if (routes.length === 0) continue;

  console.log(`### ${provider}\n`);
  console.log("| Method | Route | Event Type |");
  console.log("| --- | --- | --- |");
  for (const { method, routePath, eventType } of routes) {
    console.log(`| ${method} | ${routePath} | \`${eventType}\` |`);
  }
  console.log();
}
