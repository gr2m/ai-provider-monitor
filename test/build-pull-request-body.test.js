import test from "ava";

import { buildPullRequestBody } from "../scripts/lib/build-pull-request-body.js";

test("buildPullRequestBody groups provider changes", (t) => {
  const body = buildPullRequestBody("example", [
    {
      route: "POST /breaking",
      note: "Removed a required field",
      breaking: true,
      change: "removed",
      doc_only: false,
    },
    {
      route: "GET /feature",
      note: "Added a response field",
      breaking: false,
      change: "added",
      doc_only: false,
    },
    {
      route: "GET /docs",
      note: "Clarified a description",
      breaking: false,
      change: "changed",
      doc_only: true,
    },
  ]);

  t.is(
    body,
    `### Breaking changes

- **POST /breaking**: Removed a required field

### New features

- **GET /feature**: Added a response field

### Documentation fixes

- **GET /docs**: Clarified a description
`,
  );
});

test("buildPullRequestBody truncates oversized summaries on a line boundary", (t) => {
  const changes = Array.from({ length: 20 }, (_, index) => ({
    route: `GET /route-${index}`,
    note: "🚀 A detailed provider change that would make the action input too large",
    breaking: false,
    change: "added",
    doc_only: false,
  }));

  const body = buildPullRequestBody("large-provider", changes, {
    maxBytes: 240,
  });

  t.true(Buffer.byteLength(body, "utf8") <= 240);
  t.regex(body, /PR description truncated/);
  t.true(body.endsWith("`changes/large-provider/`._"));
  t.false(body.includes("GET /route-19"));
});
