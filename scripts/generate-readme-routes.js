#!/usr/bin/env node

/**
 * Generates Markdown route lists per provider.
 *
 * Usage:
 *   node scripts/generate-readme-routes.js
 *
 * Output is written to stdout — paste into README.md.
 */

import { readdir } from "node:fs/promises";
import { basename } from "node:path";
import { glob } from "node:fs/promises";

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

    const parts = relativePath.split("/");
    const methodFile = parts.pop();
    const method = basename(methodFile, ".json").toUpperCase();
    const routePath =
      "/" +
      parts
        .join("/")
        .replaceAll("_QMARK_", "?")
        .replaceAll("_EQ_", "=");

    const specUrl = `https://github.com/gr2m/ai-provider-monitor/blob/main/cache/${provider}/routes/${relativePath}`;
    routes.push({ method, routePath, specUrl });
  }

  routes.sort((a, b) => {
    const pathCmp = a.routePath.localeCompare(b.routePath);
    if (pathCmp !== 0) return pathCmp;
    return a.method.localeCompare(b.method);
  });

  if (routes.length === 0) continue;

  console.log(`### ${provider}\n`);
  console.log(`Event type: \`ai-provider-monitor:${provider}\`\n`);
  for (const { method, routePath, specUrl } of routes) {
    console.log(`- [\`${method} ${routePath}\`](${specUrl})`);
  }
  console.log();
}
