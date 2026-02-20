import { readFile, rm, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import test from "ava";
import yaml from "js-yaml";

const exec = promisify(execFile);
const SCRIPT = "scripts/append-changes.js";
const CHANGES_DIR = "changes";

test.afterEach(async () => {
  // Clean up changes directory after each test
  await rm(CHANGES_DIR, { recursive: true, force: true });
});

test("creates new file for a single change", async (t) => {
  const changes = [
    {
      route: "POST /v1/chat/completions",
      date: "2026-02-19",
      change: "changed",
      target: "request",
      breaking: true,
      deprecated: false,
      doc_only: false,
      note: "sample_rate type changed",
      paths: [
        {
          path: "schema.properties.sample_rate.type",
          before: "number",
          after: "integer",
        },
      ],
    },
  ];

  await exec("node", [SCRIPT, "openai", JSON.stringify(changes)]);

  const content = await readFile(
    "changes/openai/v1/chat/completions/post.yml",
    "utf8"
  );
  const records = yaml.load(content);

  t.is(records.length, 1);
  t.is(records[0].date, "2026-02-19");
  t.is(records[0].change, "changed");
  t.is(records[0].target, "request");
  t.is(records[0].breaking, true);
  t.is(records[0].paths[0].before, "number");
  t.is(records[0].paths[0].after, "integer");
  // route field should be stripped from the record
  t.is(records[0].route, undefined);
});

test("appends to existing file", async (t) => {
  // Create existing file
  await mkdir("changes/openai/v1/models", { recursive: true });
  const existing = [
    {
      date: "2026-01-01",
      change: "added",
      target: "response",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "Added gpt-5 model",
      paths: [],
    },
  ];
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    "changes/openai/v1/models/get.yml",
    yaml.dump(existing, { lineWidth: -1 })
  );

  const changes = [
    {
      route: "GET /v1/models",
      date: "2026-02-19",
      change: "added",
      target: "response",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "Added gpt-5-turbo model",
      paths: [],
    },
  ];

  await exec("node", [SCRIPT, "openai", JSON.stringify(changes)]);

  const content = await readFile("changes/openai/v1/models/get.yml", "utf8");
  const records = yaml.load(content);

  t.is(records.length, 2);
  t.is(records[0].note, "Added gpt-5 model");
  t.is(records[1].note, "Added gpt-5-turbo model");
});

test("handles multiple routes in one call", async (t) => {
  const changes = [
    {
      route: "POST /v1/chat/completions",
      date: "2026-02-19",
      change: "changed",
      target: "request",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "Added new parameter",
      paths: [],
    },
    {
      route: "GET /v1/models",
      date: "2026-02-19",
      change: "added",
      target: "route",
      breaking: false,
      deprecated: false,
      doc_only: false,
      note: "New models endpoint",
      paths: [],
    },
  ];

  await exec("node", [SCRIPT, "openai", JSON.stringify(changes)]);

  const chatContent = await readFile(
    "changes/openai/v1/chat/completions/post.yml",
    "utf8"
  );
  const modelsContent = await readFile(
    "changes/openai/v1/models/get.yml",
    "utf8"
  );

  t.is(yaml.load(chatContent).length, 1);
  t.is(yaml.load(modelsContent).length, 1);
});

test("handles empty changes array", async (t) => {
  const { stderr } = await exec("node", [SCRIPT, "openai", "[]"]);
  t.true(stderr.includes("No changes to append"));
});

test("route-level add has no route field in output", async (t) => {
  const changes = [
    {
      route: "POST /v1/new-endpoint",
      date: "2026-02-19",
      change: "added",
      target: "route",
      breaking: false,
      deprecated: true,
      doc_only: false,
      note: "New deprecated endpoint",
      paths: [],
    },
  ];

  await exec("node", [SCRIPT, "openai", JSON.stringify(changes)]);

  const content = await readFile(
    "changes/openai/v1/new-endpoint/post.yml",
    "utf8"
  );
  const records = yaml.load(content);

  t.is(records[0].deprecated, true);
  t.is(records[0].route, undefined);
});
