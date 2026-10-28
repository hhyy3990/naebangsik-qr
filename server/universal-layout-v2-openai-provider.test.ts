import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  UniversalLayoutV2JsonSchema,
  UniversalLayoutV2PlanProvider,
  UniversalLayoutV2PromptPayload,
} from "./universal-layout-generator-v2";
import {
  classifyUniversalLayoutV2OpenAIError,
  createUniversalLayoutV2OpenAIProvider,
  type UniversalLayoutV2OpenAIClient,
} from "./universal-layout-v2-openai-provider";

test("v2 OpenAI diagnostics classify allowlisted failure types without copying raw details", () => {
  const cases: Array<[unknown, Record<string, unknown>]> = [
    [{ name: "AuthenticationError", status: 401, code: "invalid_api_key" }, {
      sdkErrorType: "AuthenticationError", httpResponseReceived: true, httpStatus: 401,
      errorCategory: "authentication", timeout: false, networkException: false, schemaRejection: false,
    }],
    [{ name: "PermissionDeniedError", status: 403 }, {
      sdkErrorType: "PermissionDeniedError", httpResponseReceived: true, httpStatus: 403,
      errorCategory: "permission", timeout: false, networkException: false, schemaRejection: false,
    }],
    [{ name: "RateLimitError", status: 429, code: "rate_limit_exceeded" }, {
      sdkErrorType: "RateLimitError", httpResponseReceived: true, httpStatus: 429,
      errorCategory: "rate_limit", timeout: false, networkException: false, schemaRejection: false,
    }],
    [{ name: "BadRequestError", status: 400, code: "invalid_request_error" }, {
      sdkErrorType: "BadRequestError", httpResponseReceived: true, httpStatus: 400,
      errorCategory: "bad_request", timeout: false, networkException: false, schemaRejection: false,
    }],
    [{ name: "InternalServerError", status: 500 }, {
      sdkErrorType: "InternalServerError", httpResponseReceived: true, httpStatus: 500,
      errorCategory: "server_error", timeout: false, networkException: false, schemaRejection: false,
    }],
    [{ name: "APIConnectionTimeoutError" }, {
      sdkErrorType: "APIConnectionTimeoutError", httpResponseReceived: false, httpStatus: null,
      errorCategory: "timeout", timeout: true, networkException: false, schemaRejection: false,
    }],
    [{ name: "APIConnectionError", cause: { code: "ENOTFOUND" } }, {
      sdkErrorType: "APIConnectionError", httpResponseReceived: false, httpStatus: null,
      errorCategory: "network", timeout: false, networkException: true, schemaRejection: false,
    }],
    [{ name: "BadRequestError", status: 400, code: "invalid_json_schema" }, {
      sdkErrorType: "BadRequestError", httpResponseReceived: true, httpStatus: 400,
      errorCategory: "schema_rejected", timeout: false, networkException: false, schemaRejection: true,
    }],
    [{ name: "NotFoundError", status: 404, code: "model_not_found" }, {
      sdkErrorType: "unknown", httpResponseReceived: true, httpStatus: 404,
      errorCategory: "model_error", timeout: false, networkException: false, schemaRejection: false,
    }],
    [{ name: "PrivateErrorName", status: 418, code: "private-code", message: "private message" }, {
      sdkErrorType: "unknown", httpResponseReceived: true, httpStatus: null,
      errorCategory: "unknown", timeout: false, networkException: false, schemaRejection: false,
    }],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(classifyUniversalLayoutV2OpenAIError(input), expected);
    const serialized = JSON.stringify(classifyUniversalLayoutV2OpenAIError(input));
    assert.equal(serialized.includes("private"), false);
  }
});

test("v2 OpenAI adapter emits safe diagnostics and makes no adapter retry", async () => {
  let calls = 0;
  const diagnostics: unknown[] = [];
  const provider = createUniversalLayoutV2OpenAIProvider({
    client: {
      responses: {
        create: async () => {
          calls += 1;
          throw Object.assign(new Error("private URL and body"), {
            name: "RateLimitError",
            status: 429,
            code: "rate_limit_exceeded",
          });
        },
      },
    } as unknown as UniversalLayoutV2OpenAIClient,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const input: Parameters<UniversalLayoutV2PlanProvider["generate"]>[0] = {
    systemInstruction: "test",
    payload: {} as UniversalLayoutV2PromptPayload,
    responseSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
  };
  await assert.rejects(provider.generate(input));
  assert.equal(calls, 1);
  assert.deepEqual(diagnostics, [{
    sdkErrorType: "RateLimitError",
    httpResponseReceived: true,
    httpStatus: 429,
    errorCategory: "rate_limit",
    timeout: false,
    networkException: false,
    schemaRejection: false,
  }]);
  assert.equal(JSON.stringify(diagnostics).includes("private"), false);
});

test("v2 OpenAI adapter uses the v2 strict schema, existing model setting, and no response storage", async () => {
  const previousModel = process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL;
  process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL = "gpt-6-luna";
  let captured: Record<string, unknown> | undefined;
  const client = {
    responses: {
      create: async (args: Record<string, unknown>) => {
        captured = args;
        return { output_text: "{\"fake\":\"response\"}", output: [] };
      },
    },
  } as unknown as UniversalLayoutV2OpenAIClient;

  try {
    const provider = createUniversalLayoutV2OpenAIProvider({ client });
    const payload = {
      schemaVersion: 2,
      contractVersion: "universal-layout.v2",
      hostId: "democoffee",
      screenId: "cafe.menu",
      structureVersion: "menu.v2",
      structureHash: "a".repeat(64),
      constraintHash: "b".repeat(64),
      viewportClass: "regular" as const,
      accessibility: {
        textScale: "standard" as const,
        buttonScale: "standard" as const,
        contrast: "standard" as const,
        viewportMode: null,
      },
      layoutCapabilities: [],
      allowedOperations: ["selectLayoutOption" as const],
      components: [{
        id: "menu.product-list",
        kind: "repeated-card-list",
        role: "ordered-menu-list",
        operations: ["selectLayoutOption" as const],
        allowedColumns: [1, 2],
        optionGroups: [{ id: "arrangement", optionIds: ["compact-grid"] }],
        minimumTouchTargetPx: 44,
        protectedProperties: ["items", "order"],
      }],
    } satisfies UniversalLayoutV2PromptPayload;
    const schema: UniversalLayoutV2JsonSchema = {
      type: "object",
      additionalProperties: false,
      required: ["operations"],
      properties: { operations: { type: "array" } },
    };

    const output = await provider.generate({
      systemInstruction: "Generate only a v2 plan.",
      payload,
      responseSchema: schema,
    });
    assert.equal(output, "{\"fake\":\"response\"}");
    assert.ok(captured);
    assert.equal(captured.model, "gpt-6-luna");
    assert.equal(captured.store, false);
    assert.equal(captured.max_output_tokens, 500);
    assert.deepEqual(captured.reasoning, { effort: "none" });
    const text = captured.text as { format: { name: string; strict: boolean; schema: unknown } };
    assert.equal(text.format.name, "universal_layout_plan_v2");
    assert.equal(text.format.strict, true);
    assert.deepEqual(text.format.schema, schema);
    const serialized = JSON.stringify(captured);
    assert.equal(serialized.includes("itemCount"), false);
    assert.equal(serialized.includes("itemOrderHash"), false);
  } finally {
    if (previousModel === undefined) delete process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL;
    else process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL = previousModel;
  }
});

test("v2 OpenAI adapter rejects provider refusal and empty responses", async () => {
  const refusalClient = {
    responses: {
      create: async () => ({
        output_text: "",
        output: [{
          type: "message",
          content: [{ type: "refusal", refusal: "private detail" }],
        }],
      }),
    },
  } as unknown as UniversalLayoutV2OpenAIClient;
  const provider = createUniversalLayoutV2OpenAIProvider({ client: refusalClient });
  const input: Parameters<UniversalLayoutV2PlanProvider["generate"]>[0] = {
    systemInstruction: "test",
    payload: {} as UniversalLayoutV2PromptPayload,
    responseSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  };
  await assert.rejects(
    provider.generate(input),
    (error: unknown) => error instanceof Error &&
      error.message === "UNIVERSAL_LAYOUT_V2_PROVIDER_REFUSED",
  );

  const emptyProvider = createUniversalLayoutV2OpenAIProvider({
    client: {
      responses: {
        create: async () => ({ output_text: "", output: [] }),
      },
    } as unknown as UniversalLayoutV2OpenAIClient,
  });
  await assert.rejects(
    emptyProvider.generate(input),
    (error: unknown) => error instanceof Error &&
      error.message === "EMPTY_UNIVERSAL_LAYOUT_V2_RESPONSE",
  );
});
