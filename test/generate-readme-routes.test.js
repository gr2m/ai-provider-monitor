import { execFile } from "node:child_process";
import { promisify } from "node:util";

import test from "ava";

const exec = promisify(execFile);
const script = "scripts/generate-readme-routes.js";

test("committed README routes match the generator", async (t) => {
  await t.notThrowsAsync(exec("node", [script, "--check"]));
});

test("only HTTP methods are listed and spec URLs are encoded", async (t) => {
  const { stdout } = await exec("node", [script]);

  t.false(stdout.includes("- [`PARAMETERS "));
  t.false(stdout.includes("- [`QUERY "));
  t.true(stdout.includes("audio/transcriptions%23stream/post.json"));
  t.false(stdout.includes("audio/transcriptions#stream/post.json"));
});
