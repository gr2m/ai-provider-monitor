import { writeFile, readFile, mkdir, glob } from "node:fs/promises";
import { dirname } from "node:path";

import yaml from "js-yaml";
import $RefParser from "@apidevtools/json-schema-ref-parser";

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

    await $RefParser.dereference(schema);
    for (const [path, operations] of Object.entries(schema.paths)) {
      for (const [method, operation] of Object.entries(operations)) {

        // Sanitize path for filesystem/artifact compatibility
        // ? and = are not allowed in GitHub Actions artifact paths
        const safePath = path.replaceAll("?", "%3F").replaceAll("=", "%3D");
        const routeFilePath = `${dirname(filePath)}/routes${safePath}`;
        console.log(routeFilePath, method);
        await mkdir(routeFilePath, { recursive: true });
        await writeFile(
          `${routeFilePath}/${method}.json`,
          JSON.stringify(operation, null, 2) + "\n"
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
};