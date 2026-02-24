#!/usr/bin/env node

/**
 * Sends repository dispatch events to all repositories with the ai-provider-monitor
 * GitHub App installed.
 *
 * Usage:
 *   node scripts/send-notifications.js <provider> '<changed_routes_json>'
 *
 * Arguments:
 *   provider           - e.g. "openai"
 *   changed_routes_json - JSON array of { relativePath, status, operationId }
 *
 * Environment:
 *   APP_ID          - GitHub App ID
 *   APP_PRIVATE_KEY - GitHub App private key (PEM)
 */

import { App } from "octokit";

const provider = process.argv[2];
const changedRoutesJson = process.argv[3];

if (!provider || !changedRoutesJson) {
  console.error(
    "Usage: node scripts/send-notifications.js <provider> '<changed_routes_json>'"
  );
  process.exit(1);
}

const { APP_ID, APP_PRIVATE_KEY } = process.env;
if (!APP_ID || !APP_PRIVATE_KEY) {
  console.error("APP_ID and APP_PRIVATE_KEY environment variables are required");
  process.exit(1);
}

const changedRoutes = JSON.parse(changedRoutesJson);

if (changedRoutes.length === 0) {
  console.error("No changed routes to notify about");
  process.exit(0);
}

const app = new App({
  appId: APP_ID,
  privateKey: APP_PRIVATE_KEY,
});

let dispatchCount = 0;
let errorCount = 0;

await app.eachRepository(async ({ octokit, repository }) => {
  const repo = repository.full_name;

  for (const route of changedRoutes) {
    const { relativePath, status, operationId } = route;

    if (!operationId) {
      console.error(`Skipping ${relativePath} — no operationId`);
      continue;
    }

    const eventType = `api:${provider}:${operationId}`;

    try {
      await octokit.request("POST /repos/{owner}/{repo}/dispatches", {
        owner: repository.owner.login,
        repo: repository.name,
        event_type: eventType,
        client_payload: {
          provider,
          operationId,
          status,
          relativePath,
        },
      });
      dispatchCount++;
      console.error(`Dispatched ${eventType} to ${repo}`);
    } catch (error) {
      errorCount++;
      console.error(
        `Failed to dispatch ${eventType} to ${repo}: ${error.message}`
      );
    }
  }
});

console.error(
  `Done. ${dispatchCount} dispatches sent, ${errorCount} failures.`
);

if (errorCount > 0) {
  process.exit(1);
}
