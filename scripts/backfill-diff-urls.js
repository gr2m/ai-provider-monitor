#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import yaml from "js-yaml";

const exec = promisify(execFile);
const DRY_RUN = process.argv.includes("--dry-run");
const REPO = "gr2m/ai-provider-api-changes";

/**
 * For each YAML file in changes/, walk git history to map each record
 * to its originating PR using commit messages with (#NNN) pattern.
 */
async function backfill() {
  let totalUpdated = 0;
  let totalSkipped = 0;

  for await (const filePath of glob("changes/**/*.yml")) {
    const currentContent = await readFile(filePath, "utf8");
    const records = yaml.load(currentContent);
    if (!Array.isArray(records) || records.length === 0) continue;

    // Skip if all records already have diff_url
    if (records.every((r) => r.diff_url)) {
      totalSkipped += records.length;
      continue;
    }

    // Get ordered commits that touched this file
    const { stdout: logOutput } = await exec("git", [
      "log",
      "--reverse",
      "--format=%H %s",
      "--",
      filePath,
    ]);

    const commits = logOutput
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const spaceIndex = line.indexOf(" ");
        const hash = line.substring(0, spaceIndex);
        const subject = line.substring(spaceIndex + 1);
        const prMatch = subject.match(/\(#(\d+)\)/);
        return {
          hash,
          subject,
          prNumber: prMatch ? Number(prMatch[1]) : null,
        };
      });

    // Track record count per commit to know which records are new
    let previousCount = 0;

    for (const commit of commits) {
      let fileContent;
      try {
        const { stdout } = await exec("git", [
          "show",
          `${commit.hash}:${filePath}`,
        ]);
        fileContent = stdout;
      } catch {
        // File might not exist at this commit (e.g., deleted and recreated)
        continue;
      }

      const commitRecords = yaml.load(fileContent);
      if (!Array.isArray(commitRecords)) continue;

      const currentCount = commitRecords.length;
      const newRecordCount = currentCount - previousCount;

      if (newRecordCount > 0 && commit.prNumber) {
        const diffUrl = `https://github.com/${REPO}/pull/${commit.prNumber}`;

        // The new records are the ones at the end (append-only)
        for (let i = previousCount; i < currentCount; i++) {
          // Find matching record in current records by note + date fingerprint
          const commitRecord = commitRecords[i];
          const matchIndex = records.findIndex(
            (r) =>
              r.note === commitRecord.note &&
              r.date === commitRecord.date &&
              !r.diff_url
          );

          if (matchIndex !== -1) {
            records[matchIndex].diff_url = diffUrl;
            totalUpdated++;
          }
        }
      }

      previousCount = currentCount;
    }

    if (DRY_RUN) {
      const withUrl = records.filter((r) => r.diff_url).length;
      const withoutUrl = records.filter((r) => !r.diff_url).length;
      console.log(
        `${filePath}: ${withUrl} mapped, ${withoutUrl} unmapped`
      );
    } else {
      await writeFile(filePath, yaml.dump(records, { lineWidth: -1 }));
      console.error(`${filePath}: updated`);
    }
  }

  if (DRY_RUN) {
    console.log(`\nDry run complete: ${totalUpdated} records would be updated, ${totalSkipped} already had diff_url`);
  } else {
    console.error(`\nBackfill complete: ${totalUpdated} records updated, ${totalSkipped} already had diff_url`);
  }
}

backfill();
