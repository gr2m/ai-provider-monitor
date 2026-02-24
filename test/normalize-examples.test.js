import test from "ava";
import { isIdenticalAfterNormalizingTimestamps } from "../scripts/lib/normalize-examples.js";

test("identical objects should return true", (t) => {
  const obj1 = {
    properties: {
      created_at: {
        type: "integer",
        example: 1711471533,
      },
    },
  };

  const obj2 = {
    properties: {
      created_at: {
        type: "integer",
        example: 1711471533,
      },
    },
  };

  t.true(isIdenticalAfterNormalizingTimestamps(obj1, obj2));
});

test("only unix timestamp in example changed should return true", (t) => {
  const objOld = {
    properties: {
      created_at: {
        type: "integer",
        example: 1711471533,
      },
    },
  };

  const objNew = {
    properties: {
      created_at: {
        type: "integer",
        example: 1711471534,
      },
    },
  };

  t.true(isIdenticalAfterNormalizingTimestamps(objOld, objNew));
});

test("schema structure changed should return false", (t) => {
  const objOldSchema = {
    properties: {
      created_at: {
        type: "integer",
        example: 1711471533,
      },
    },
  };

  const objNewSchema = {
    properties: {
      created_at: {
        type: "string",
        example: 1711471534,
      },
    },
  };

  t.false(isIdenticalAfterNormalizingTimestamps(objOldSchema, objNewSchema));
});

test("only ISO date in examples changed should return true", (t) => {
  const objIsoOld = {
    examples: [
      {
        timestamp: "2024-12-31T23:59:59Z",
        value: 100,
      },
    ],
  };

  const objIsoNew = {
    examples: [
      {
        timestamp: "2025-01-01T00:00:00Z",
        value: 100,
      },
    ],
  };

  t.true(isIdenticalAfterNormalizingTimestamps(objIsoOld, objIsoNew));
});

test("real-world OpenAI case with only timestamps changed", (t) => {
  const realOldJson = JSON.stringify({
    properties: {
      created_at: {
        type: "integer",
        description:
          "The Unix timestamp (in seconds) for when the key was created.",
        example: 1711471533,
      },
      expires_at: {
        type: "integer",
        description: "The Unix timestamp (in seconds) for when the key expires.",
        example: 1711471534,
      },
      name: {
        type: "string",
        example: "my-key",
      },
    },
  });

  const realNewJson = JSON.stringify({
    properties: {
      created_at: {
        type: "integer",
        description:
          "The Unix timestamp (in seconds) for when the key was created.",
        example: 1711471599,
      },
      expires_at: {
        type: "integer",
        description: "The Unix timestamp (in seconds) for when the key expires.",
        example: 1711471699,
      },
      name: {
        type: "string",
        example: "my-key",
      },
    },
  });

  t.true(isIdenticalAfterNormalizingTimestamps(realOldJson, realNewJson));
});

test("real-world case with non-timestamp example change should return false", (t) => {
  const realOldJson = JSON.stringify({
    properties: {
      created_at: {
        type: "integer",
        example: 1711471533,
      },
      name: {
        type: "string",
        example: "my-key-old",
      },
    },
  });

  const realNewJson = JSON.stringify({
    properties: {
      created_at: {
        type: "integer",
        example: 1711471599,
      },
      name: {
        type: "string",
        example: "my-key-new",
      },
    },
  });

  t.false(isIdenticalAfterNormalizingTimestamps(realOldJson, realNewJson));
});

test("handles multiple timestamps in array examples", (t) => {
  const objOld = {
    examples: [1711471533, 1711471534, 1711471535],
  };

  const objNew = {
    examples: [1711471599, 1711471699, 1711471799],
  };

  t.true(isIdenticalAfterNormalizingTimestamps(objOld, objNew));
});

test("handles nested objects in examples", (t) => {
  const objOld = {
    properties: {
      data: {
        type: "object",
        examples: [
          {
            created_at: 1711471533,
            modified_at: 1711471534,
            name: "test",
          },
        ],
      },
    },
  };

  const objNew = {
    properties: {
      data: {
        type: "object",
        examples: [
          {
            created_at: 1711471599,
            modified_at: 1711471699,
            name: "test",
          },
        ],
      },
    },
  };

  t.true(isIdenticalAfterNormalizingTimestamps(objOld, objNew));
});

test("preserves non-example field changes", (t) => {
  const objOld = {
    properties: {
      created_at: {
        type: "integer",
        minimum: 0,
        example: 1711471533,
      },
    },
  };

  const objNew = {
    properties: {
      created_at: {
        type: "integer",
        minimum: 1,
        example: 1711471599,
      },
    },
  };

  t.false(isIdenticalAfterNormalizingTimestamps(objOld, objNew));
});
