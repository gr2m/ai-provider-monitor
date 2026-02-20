#!/usr/bin/env node

import { appendChanges } from "./lib/append-changes.js";

const provider = process.argv[2];
const changesJson = process.argv[3];

if (!provider || !changesJson) {
  console.error(
    "Usage: node scripts/append-changes.js <provider> '<json-changes>'"
  );
  process.exit(1);
}

const changes = JSON.parse(changesJson);
await appendChanges(provider, changes);
