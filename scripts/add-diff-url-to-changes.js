#!/usr/bin/env node

import { addDiffUrlToChanges } from "./lib/add-diff-url-to-changes.js";

const provider = process.argv[2];
const prNumber = process.argv[3];
const repo = process.argv[4];

if (!provider || !prNumber || !repo) {
  console.error(
    "Usage: node scripts/add-diff-url-to-changes.js <provider> <pr-number> <repo>"
  );
  process.exit(1);
}

await addDiffUrlToChanges(provider, Number(prNumber), repo);
