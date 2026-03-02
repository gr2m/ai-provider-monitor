import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import test from "ava";
import yaml from "js-yaml";

const exec = promisify(execFile);
const SCRIPT = "scripts/add-diff-url-to-changes.js";
const CHANGES_DIR = "changes";

test.afterEach(async () => {
  await rm(CHANGES_DIR, { recursive: true, force: true });
});

test("adds diff_url to records missing it", async (t) => {
  await mkdir("changes/openai/v1/chat/completions", { recursive: true });
  const records = [
    {
      change: "added",
      target: "response",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "Added new field",
      paths: [],
      date: "2026-02-19",
    },
  ];
  await writeFile(
    "changes/openai/v1/chat/completions/post.yml",
    yaml.dump(records, { lineWidth: -1 })
  );

  await exec("node", [SCRIPT, "openai", "42", "gr2m/ai-provider-api-changes"]);

  const content = await readFile(
    "changes/openai/v1/chat/completions/post.yml",
    "utf8"
  );
  const result = yaml.load(content);

  t.is(result.length, 1);
  t.is(
    result[0].diff_url,
    "https://github.com/gr2m/ai-provider-api-changes/pull/42"
  );
});

test("does not overwrite existing diff_url", async (t) => {
  await mkdir("changes/openai/v1/models", { recursive: true });
  const records = [
    {
      change: "added",
      target: "response",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "Old record",
      paths: [],
      date: "2026-01-01",
      diff_url: "https://github.com/gr2m/ai-provider-api-changes/pull/10",
    },
    {
      change: "added",
      target: "response",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "New record",
      paths: [],
      date: "2026-02-19",
    },
  ];
  await writeFile(
    "changes/openai/v1/models/get.yml",
    yaml.dump(records, { lineWidth: -1 })
  );

  await exec("node", [SCRIPT, "openai", "42", "gr2m/ai-provider-api-changes"]);

  const content = await readFile("changes/openai/v1/models/get.yml", "utf8");
  const result = yaml.load(content);

  t.is(result.length, 2);
  t.is(
    result[0].diff_url,
    "https://github.com/gr2m/ai-provider-api-changes/pull/10"
  );
  t.is(
    result[1].diff_url,
    "https://github.com/gr2m/ai-provider-api-changes/pull/42"
  );
});

test("handles multiple files across nested paths", async (t) => {
  await mkdir("changes/openai/v1/chat/completions", { recursive: true });
  await mkdir("changes/openai/v1/models", { recursive: true });

  const chatRecords = [
    {
      change: "changed",
      target: "request",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "Chat change",
      paths: [],
      date: "2026-02-19",
    },
  ];
  const modelRecords = [
    {
      change: "added",
      target: "route",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "Model change",
      paths: [],
      date: "2026-02-19",
    },
  ];

  await writeFile(
    "changes/openai/v1/chat/completions/post.yml",
    yaml.dump(chatRecords, { lineWidth: -1 })
  );
  await writeFile(
    "changes/openai/v1/models/get.yml",
    yaml.dump(modelRecords, { lineWidth: -1 })
  );

  await exec("node", [SCRIPT, "openai", "42", "gr2m/ai-provider-api-changes"]);

  const chatContent = await readFile(
    "changes/openai/v1/chat/completions/post.yml",
    "utf8"
  );
  const modelContent = await readFile(
    "changes/openai/v1/models/get.yml",
    "utf8"
  );

  t.is(
    yaml.load(chatContent)[0].diff_url,
    "https://github.com/gr2m/ai-provider-api-changes/pull/42"
  );
  t.is(
    yaml.load(modelContent)[0].diff_url,
    "https://github.com/gr2m/ai-provider-api-changes/pull/42"
  );
});

test("only updates specified provider", async (t) => {
  await mkdir("changes/openai/v1/models", { recursive: true });
  await mkdir("changes/anthropic/v1/messages", { recursive: true });

  const openaiRecords = [
    {
      change: "added",
      target: "response",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "OpenAI change",
      paths: [],
      date: "2026-02-19",
    },
  ];
  const anthropicRecords = [
    {
      change: "added",
      target: "response",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "Anthropic change",
      paths: [],
      date: "2026-02-19",
    },
  ];

  await writeFile(
    "changes/openai/v1/models/get.yml",
    yaml.dump(openaiRecords, { lineWidth: -1 })
  );
  await writeFile(
    "changes/anthropic/v1/messages/post.yml",
    yaml.dump(anthropicRecords, { lineWidth: -1 })
  );

  await exec("node", [SCRIPT, "openai", "42", "gr2m/ai-provider-api-changes"]);

  const openaiContent = await readFile(
    "changes/openai/v1/models/get.yml",
    "utf8"
  );
  const anthropicContent = await readFile(
    "changes/anthropic/v1/messages/post.yml",
    "utf8"
  );

  t.is(
    yaml.load(openaiContent)[0].diff_url,
    "https://github.com/gr2m/ai-provider-api-changes/pull/42"
  );
  t.is(yaml.load(anthropicContent)[0].diff_url, undefined);
});

test("prints usage on missing arguments", async (t) => {
  const error = await t.throwsAsync(() => exec("node", [SCRIPT]));
  t.true(error.stderr.includes("Usage:"));
});
