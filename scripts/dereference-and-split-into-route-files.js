import { writeFile, readFile, mkdir, glob } from "node:fs/promises";
import { dirname } from "node:path";

import yaml from "js-yaml";

console.log("");

const provider = process.argv[2];
if (!provider) {
  console.error("Usage: node scripts/dereference-and-split-into-route-files.js <provider>");
  process.exit(1);
}

try {
  console.log({ provider });
  for await (const filePath of glob(`cache/${provider}/openapi.{json,yaml,yml}`)) {
    const fileContents = await readFile(filePath, "utf8");
    const schema = filePath.endsWith(".json")
      ? JSON.parse(fileContents)
      : yaml.load(fileContents);

    console.log("\n");
    console.log(filePath);

    removeXPrefix(schema);

    for (const [path, operations] of Object.entries(schema.paths)) {
      for (const [method, operation] of Object.entries(operations)) {

        // Sanitize path for filesystem/artifact compatibility
        // ? and = are not allowed in GitHub Actions artifact paths
        const safePath = path.replaceAll("?", "_QMARK_").replaceAll("=", "_EQ_");
        const routeFilePath = `${dirname(filePath)}/routes${safePath}`;
        console.log(routeFilePath, method);
        await mkdir(routeFilePath, { recursive: true });
        const bundled = buildBundledRoute(operation, schema);
        await writeFile(
          `${routeFilePath}/${method}.json`,
          JSON.stringify(bundled, null, 2) + "\n"
        );
      }
    }
  }
} catch (err) {
  console.error(err);
}

function removeXPrefix(obj) {
  if (obj === null || typeof obj !== 'object') {
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

function resolveRef(root, refPath) {
  const parts = refPath.replace("#/", "").split("/");
  let current = root;
  for (const part of parts) {
    current = current?.[part];
    if (current === undefined) return undefined;
  }
  return current;
}

function collectRefsTransitively(root, obj) {
  const refs = new Map();
  const visited = new Set();
  const queue = [];

  function findRefs(obj) {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) { for (const item of obj) findRefs(item); return; }
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

function buildBundledRoute(operation, fullSpec) {
  const refs = collectRefsTransitively(fullSpec, operation);
  if (refs.size === 0) return operation;

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
