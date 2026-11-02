import { gzipSync } from "node:zlib";

import test from "ava";

import {
  downloadText,
  resolveUrlFromMetadata,
} from "../scripts/lib/download.js";

test("downloadText returns a successful response body", async (t) => {
  const body = await downloadText("https://example.test/openapi.json", {
    fetchImpl: async () => new Response('{"openapi":"3.1.0"}'),
    retryDelaysMs: [],
  });

  t.is(body, '{"openapi":"3.1.0"}');
});

test("downloadText decodes a gzip spec artifact", async (t) => {
  const spec = '{"openapi":"3.1.0","info":{"title":"Anthropic API"}}';
  const body = await downloadText("https://example.test/mock-spec.json.gz", {
    fetchImpl: async () => new Response(gzipSync(spec)),
    retryDelaysMs: [],
  });

  t.is(body, spec);
});

test("downloadText accepts a gzip response already decoded by fetch", async (t) => {
  const spec = "openapi: 3.1.0\n";
  const body = await downloadText("https://example.test/openapi.yml.gz", {
    fetchImpl: async () =>
      new Response(spec, { headers: { "content-encoding": "gzip" } }),
    retryDelaysMs: [],
  });

  t.is(body, spec);
});

test("downloadText retries a truncated gzip artifact", async (t) => {
  const spec = '{"openapi":"3.1.0"}';
  const compressed = gzipSync(spec);
  const responses = [
    new Response(compressed.subarray(0, 10)),
    new Response(compressed),
  ];
  const retries = [];

  const body = await downloadText("https://example.test/mock-spec.json.gz", {
    fetchImpl: async () => responses.shift(),
    retryDelaysMs: [0],
    sleep: async () => {},
    onRetry: (retry) => retries.push(retry),
  });

  t.is(body, spec);
  t.is(retries.length, 1);
  t.is(retries[0].error.code, "Z_BUF_ERROR");
});

test("downloadText retries network and HTTP failures", async (t) => {
  const responses = [
    new TypeError("socket reset"),
    new Response("temporarily unavailable", {
      status: 503,
      statusText: "Service Unavailable",
    }),
    new Response("openapi: 3.1.0"),
  ];
  const retries = [];

  const body = await downloadText("https://example.test/openapi.yml", {
    fetchImpl: async () => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    retryDelaysMs: [0, 0],
    sleep: async () => {},
    onRetry: (retry) => retries.push(retry),
  });

  t.is(body, "openapi: 3.1.0");
  t.deepEqual(
    retries.map(({ attempt, error }) => [attempt, error.message]),
    [
      [1, "socket reset"],
      [2, "HTTP 503 Service Unavailable"],
    ],
  );
});

test("downloadText reports the URL and final failure", async (t) => {
  const error = await t.throwsAsync(
    downloadText("https://example.test/missing.yml", {
      fetchImpl: async () => new Response("missing", { status: 404 }),
      retryDelaysMs: [],
    }),
  );

  t.regex(
    error.message,
    /Failed to download https:\/\/example\.test\/missing\.yml after 1 attempts: HTTP 404/,
  );
});

test("resolveUrlFromMetadata reads a nested YAML property", (t) => {
  const url = resolveUrlFromMetadata(
    "spec:\n  url: /generated/openapi.yml\n",
    "spec.url",
    "https://example.test/metadata.yml",
  );

  t.is(url, "https://example.test/generated/openapi.yml");
});

test("resolveUrlFromMetadata rejects missing and non-HTTP URLs", (t) => {
  t.throws(
    () =>
      resolveUrlFromMetadata(
        "other: value\n",
        "openapi_spec_url",
        "https://example.test/metadata.yml",
      ),
    { message: /is not a non-empty string/ },
  );

  t.throws(
    () =>
      resolveUrlFromMetadata(
        "openapi_spec_url: file:\/\/\/tmp\/openapi.yml\n",
        "openapi_spec_url",
        "https://example.test/metadata.yml",
      ),
    { message: /does not resolve to an HTTP\(S\) URL/ },
  );
});
