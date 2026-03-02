import { readFile, writeFile } from "node:fs/promises";
import { glob } from "node:fs/promises";

import yaml from "js-yaml";

/**
 * Adds diff_url to change records that are missing it.
 *
 * @param {string} provider - e.g. "openai"
 * @param {number} prNumber - the PR number
 * @param {string} repo - e.g. "gr2m/ai-provider-api-changes"
 */
export async function addDiffUrlToChanges(provider, prNumber, repo) {
  const diffUrl = `https://github.com/${repo}/pull/${prNumber}`;
  let filesUpdated = 0;

  for await (const filePath of glob(`changes/${provider}/**/*.yml`)) {
    const content = await readFile(filePath, "utf8");
    const records = yaml.load(content);

    if (!Array.isArray(records)) continue;

    let changed = false;
    for (const record of records) {
      if (!record.diff_url) {
        record.diff_url = diffUrl;
        changed = true;
      }
    }

    if (changed) {
      await writeFile(filePath, yaml.dump(records, { lineWidth: -1 }));
      filesUpdated++;
    }
  }

  console.error(
    `${provider}: updated ${filesUpdated} file(s) with diff_url for PR #${prNumber}`
  );
}
