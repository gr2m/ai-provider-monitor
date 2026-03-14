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
 *   changed_routes_json - JSON array of { route, status, changes }
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

const eventType = `ai-provider-monitor:${provider}`;

/**
 * Attempts to send a dispatch event. If the payload is too large,
 * splits the routes array into smaller batches and retries.
 */
async function sendDispatch(octokit, repository, payload) {
  try {
    await octokit.request("POST /repos/{owner}/{repo}/dispatches", {
      owner: repository.owner.login,
      repo: repository.name,
      event_type: eventType,
      client_payload: payload,
    });
    return 1;
  } catch (error) {
    // GitHub returns 422 when the payload is too large
    if (error.status === 422 && payload.routes && payload.routes.length > 1) {
      console.error(
        `Payload too large for ${repository.full_name} (${payload.routes.length} routes), splitting...`
      );

      const routes = payload.routes;
      const mid = Math.ceil(routes.length / 2);

      const countA = await sendDispatch(octokit, repository, {
        ...payload,
        routes: routes.slice(0, mid),
      });
      const countB = await sendDispatch(octokit, repository, {
        ...payload,
        routes: routes.slice(mid),
      });
      return countA + countB;
    }
    throw error;
  }
}

let dispatchCount = 0;
let errorCount = 0;

await app.eachRepository(async ({ octokit, repository }) => {
  const repo = repository.full_name;

  try {
    const count = await sendDispatch(octokit, repository, {
      provider,
      routes: changedRoutes,
    });
    dispatchCount += count;
    console.error(`Dispatched ${eventType} to ${repo}`);
  } catch (error) {
    errorCount++;
    console.error(
      `Failed to dispatch ${eventType} to ${repo}: ${error.message}`
    );
  }
});

console.error(
  `Done. ${dispatchCount} dispatches sent, ${errorCount} failures.`
);

if (errorCount > 0) {
  process.exit(1);
}
