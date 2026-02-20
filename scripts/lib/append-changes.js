import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import yaml from "js-yaml";

/**
 * Appends change records to YAML files grouped by route.
 *
 * @param {string} provider - e.g. "openai"
 * @param {Array} changes - array of change records, each with a `route` field
 */
export async function appendChanges(provider, changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    console.log("No changes to append");
    return;
  }

  // Group changes by route (method + path)
  const byRoute = new Map();
  for (const change of changes) {
    const { route, ...record } = change;
    if (!route) {
      console.error("Change record missing 'route' field:", change);
      continue;
    }

    // Parse "POST /v1/chat/completions" into method + path
    const spaceIndex = route.indexOf(" ");
    if (spaceIndex === -1) {
      console.error("Invalid route format (expected 'METHOD /path'):", route);
      continue;
    }

    const method = route.substring(0, spaceIndex).toLowerCase();
    const path = route.substring(spaceIndex + 1);

    const filePath = `changes/${provider}${path}/${method}.yml`;
    if (!byRoute.has(filePath)) {
      byRoute.set(filePath, []);
    }
    byRoute.get(filePath).push(record);
  }

  for (const [filePath, records] of byRoute) {
    await mkdir(dirname(filePath), { recursive: true });

    // Read existing records if file exists
    let existing = [];
    try {
      const content = await readFile(filePath, "utf8");
      existing = yaml.load(content) || [];
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }

    const merged = [...existing, ...records];
    await writeFile(filePath, yaml.dump(merged, { lineWidth: -1 }));
    console.log(`${filePath}: appended ${records.length} record(s)`);
  }
}
