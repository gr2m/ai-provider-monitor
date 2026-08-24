import test from "ava";

import {
  isTransientAiError,
  retryAiCall,
} from "../scripts/lib/retry-ai-call.js";

test("isTransientAiError recognizes retryable errors wrapped by the Gateway", (t) => {
  const error = Object.assign(new Error("Gateway request failed"), {
    statusCode: 500,
    cause: Object.assign(new Error("read ECONNRESET"), {
      isRetryable: true,
    }),
  });

  t.true(isTransientAiError(error));
});

test("isTransientAiError rejects permanent errors", (t) => {
  const error = Object.assign(new Error("insufficient funds"), {
    statusCode: 402,
  });

  t.false(isTransientAiError(error));
});

test("isTransientAiError uses the final error from an exhausted retry", (t) => {
  const error = Object.assign(new Error("retry failed"), {
    errors: [
      Object.assign(new Error("temporary"), { statusCode: 500 }),
      Object.assign(new Error("insufficient funds"), { statusCode: 402 }),
    ],
    lastError: Object.assign(new Error("insufficient funds"), {
      statusCode: 402,
    }),
  });

  t.false(isTransientAiError(error));
});

test("retryAiCall retries transient failures", async (t) => {
  const delays = [];
  const retries = [];
  let calls = 0;

  const result = await retryAiCall(
    async () => {
      calls++;
      if (calls < 3) {
        throw Object.assign(
          new Error("Cannot connect to API: read ECONNRESET"),
          {
            statusCode: 500,
          },
        );
      }
      return "success";
    },
    {
      retryDelaysMs: [10, 20],
      sleep: async (delayMs) => delays.push(delayMs),
      onRetry: ({ attempt }) => retries.push(attempt),
    },
  );

  t.is(result, "success");
  t.is(calls, 3);
  t.deepEqual(delays, [10, 20]);
  t.deepEqual(retries, [1, 2]);
});

test("retryAiCall does not retry permanent failures", async (t) => {
  const error = Object.assign(new Error("insufficient funds"), {
    statusCode: 402,
  });
  let calls = 0;

  const thrown = await t.throwsAsync(
    retryAiCall(
      async () => {
        calls++;
        throw error;
      },
      {
        retryDelaysMs: [0, 0],
        sleep: async () => {},
      },
    ),
  );

  t.is(thrown, error);
  t.is(calls, 1);
});

test("retryAiCall throws the final transient failure after bounded retries", async (t) => {
  const errors = [
    Object.assign(new Error("first"), { statusCode: 500 }),
    Object.assign(new Error("second"), { statusCode: 500 }),
  ];
  let calls = 0;

  const thrown = await t.throwsAsync(
    retryAiCall(
      async () => {
        throw errors[calls++];
      },
      {
        retryDelaysMs: [0],
        sleep: async () => {},
        onRetry: () => {},
      },
    ),
  );

  t.is(thrown, errors[1]);
  t.is(calls, 2);
});
