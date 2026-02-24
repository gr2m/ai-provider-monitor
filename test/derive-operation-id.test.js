import test from "ava";

import { deriveOperationId } from "../scripts/lib/derive-operation-id.js";

test("extracts operationId from JSON content", (t) => {
  const content = JSON.stringify({ operationId: "listBatches", description: "List batches" });
  const result = deriveOperationId("batches/get.json", content);
  t.is(result, "listBatches");
});

test("generates operationId from method + path when missing", (t) => {
  const content = JSON.stringify({ description: "List all batch jobs" });
  const result = deriveOperationId("batches/get.json", content);
  t.is(result, "get_batches");
});

test("generates operationId filtering out path parameters", (t) => {
  const content = JSON.stringify({ description: "Get a batch" });
  const result = deriveOperationId("batches/{id}/get.json", content);
  t.is(result, "get_batches");
});

test("generates operationId for nested paths", (t) => {
  const content = JSON.stringify({ description: "Cancel a batch" });
  const result = deriveOperationId("batches/{id}/cancel/post.json", content);
  t.is(result, "post_batches_cancel");
});

test("returns null for parameters.json", (t) => {
  const result = deriveOperationId("v1/messages/parameters.json", "{}");
  t.is(result, null);
});

test("returns null for servers.json", (t) => {
  const result = deriveOperationId("v1/servers.json", "{}");
  t.is(result, null);
});

test("returns null for description.json", (t) => {
  const result = deriveOperationId("v1/description.json", "{}");
  t.is(result, null);
});

test("handles invalid JSON gracefully", (t) => {
  const result = deriveOperationId("batches/get.json", "not json");
  t.is(result, "get_batches");
});

test("generates operationId for deep nested route without operationId", (t) => {
  const content = JSON.stringify({ description: "Get operation status" });
  const result = deriveOperationId(
    "rl/training-sessions/{session_id}/operations/forward-backward/{operation_id}/get.json",
    content
  );
  t.is(result, "get_rl_training-sessions_operations_forward-backward");
});

test("handles URL-encoded query string in path", (t) => {
  const content = JSON.stringify({ description: "Query endpoint" });
  const result = deriveOperationId("v1/files_QMARK_beta_EQ_true/get.json", content);
  t.is(result, "get_v1_files");
});

test("generates method-only operationId for root path", (t) => {
  const content = JSON.stringify({ description: "Root" });
  const result = deriveOperationId("post.json", content);
  t.is(result, "post");
});
