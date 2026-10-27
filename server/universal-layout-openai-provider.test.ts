import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createUniversalLayoutModel,
  universalSha256,
} from "./universal-layout-contract";
import {
  DEMO_COFFEE_UNIVERSAL_MOCK_POLICY,
} from "./universal-layout-mock-policies";
import { UNIVERSAL_LAYOUT_MOCK_POLICIES } from "./universal-layout-mock-policies";
import {
  createUniversalLayoutPlanJsonSchema,
  UNIVERSAL_LAYOUT_SYSTEM_INSTRUCTION,
  UniversalLayoutGenerationError,
  generateUniversalLayoutPlan,
} from "./universal-layout-generator";
import {
  createUniversalLayoutOpenAIProvider,
  type UniversalLayoutOpenAIClient,
} from "./universal-layout-openai-provider";

test("OpenAI adapter sends only abstract payload with strict JSON schema and storage disabled", async () => {
  const model = createUniversalLayoutModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY, {
    viewportClass: "regular",
    accessibility: {
      textScale: "standard",
      buttonScale: "standard",
      contrast: "standard",
      viewportMode: null,
    },
    componentState: [{
      id: "menu.product-list",
      itemCount: 12,
      itemOrderHash: universalSha256({ source: "private item sequence sentinel" }),
    }],
  });
  const payload = {
    schemaVersion: model.schemaVersion,
    contractVersion: model.contractVersion,
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    accessibility: model.accessibility,
    components: model.components.map((component) => ({
      id: component.id,
      kind: component.kind,
      role: component.role,
      allowedColumns: component.allowedColumns,
      operations: component.operations,
      minimumTouchTargetPx: component.minimumTouchTargetPx,
      protectedProperties: component.protectedProperties,
    })),
  };
  let captured: Record<string, unknown> | undefined;
  const previousGlobalModel = process.env.OPENAI_MODEL;
  const previousUniversalModel = process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL;
  process.env.OPENAI_MODEL = "unrelated-global-model";
  delete process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL;
  const client = {
    responses: {
      create: async (args: Record<string, unknown>) => {
        captured = args;
        return { output_text: "{\"test\":\"fake\"}", output: [] };
      },
    },
  } as unknown as UniversalLayoutOpenAIClient;
  try {
    const provider = createUniversalLayoutOpenAIProvider({ client });
    const result = await provider.generate({
      systemInstruction: UNIVERSAL_LAYOUT_SYSTEM_INSTRUCTION,
      payload,
      responseSchema: createUniversalLayoutPlanJsonSchema(model),
    });

    assert.equal(result, "{\"test\":\"fake\"}");
    assert.ok(captured);
    assert.equal(captured.store, false);
    assert.equal(captured.model, "gpt-6-luna");
    assert.deepEqual(captured.reasoning, { effort: "none" });
    assert.equal(captured.max_output_tokens, 500);
    const text = JSON.stringify(captured);
    assert.equal(text.includes("private item sequence sentinel"), false);
    assert.equal(text.includes("itemOrderHash"), false);
    assert.equal(text.includes("itemCount"), false);
    const textOptions = captured.text as { format: { type: string; strict: boolean; schema: unknown } };
    assert.equal(textOptions.format.type, "json_schema");
    assert.equal(textOptions.format.strict, true);
    assert.deepEqual(
      (textOptions.format.schema as { additionalProperties: boolean }).additionalProperties,
      false,
    );
  } finally {
    if (previousGlobalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousGlobalModel;
    if (previousUniversalModel === undefined) delete process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL;
    else process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL = previousUniversalModel;
  }

});

test("provider refusal and incomplete output are rejected without exposing the refusal text", async () => {
  const model = createUniversalLayoutModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY, {
    viewportClass: "regular",
    accessibility: {
      textScale: "standard",
      buttonScale: "standard",
      contrast: "standard",
      viewportMode: null,
    },
    componentState: [{
      id: "menu.product-list",
      itemCount: 12,
      itemOrderHash: universalSha256({ order: "fixture" }),
    }],
  });
  const payload = {
    schemaVersion: model.schemaVersion,
    contractVersion: model.contractVersion,
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    accessibility: model.accessibility,
    components: model.components.map(({ id, kind, role, allowedColumns, operations, minimumTouchTargetPx, protectedProperties }) => ({
      id, kind, role, allowedColumns, operations, minimumTouchTargetPx, protectedProperties,
    })),
  };
  const refusalClient = {
    responses: {
      create: async () => ({
        output_text: "",
        output: [{
          type: "message",
          content: [{ type: "refusal", refusal: "private refusal detail" }],
        }],
      }),
    },
  } as unknown as UniversalLayoutOpenAIClient;
  const provider = createUniversalLayoutOpenAIProvider({ client: refusalClient });
  await assert.rejects(
    provider.generate({
      systemInstruction: UNIVERSAL_LAYOUT_SYSTEM_INSTRUCTION,
      payload,
      responseSchema: createUniversalLayoutPlanJsonSchema(model),
    }),
    (error: unknown) => error instanceof Error &&
      error.message === "UNIVERSAL_LAYOUT_PROVIDER_REFUSED" &&
      !error.message.includes("private refusal detail"),
  );
});

test("gpt-6-luna Fake Responses output uses the common validator and rejects malformed JSON", async () => {
  const model = createUniversalLayoutModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY, {
    viewportClass: "regular",
    accessibility: {
      textScale: "standard",
      buttonScale: "standard",
      contrast: "standard",
      viewportMode: null,
    },
    componentState: [{
      id: "menu.product-list",
      itemCount: 12,
      itemOrderHash: universalSha256({ order: "fixture" }),
    }],
  });
  let requestModel = "";
  const makeResponseProvider = (transform: (plan: Record<string, unknown>) => unknown) => {
    const client = {
      responses: {
        create: async (args: Record<string, unknown>) => {
          requestModel = String(args.model);
          const input = args.input as Array<{ role: string; content: string }>;
          const payload = JSON.parse(input[1].content) as {
            schemaVersion: number;
            contractVersion: string;
            hostId: string;
            screenId: string;
            structureVersion: string;
            structureHash: string;
            constraintHash: string;
            viewportClass: string;
            components: Array<{ id: string }>;
          };
          return {
            output_text: JSON.stringify(transform({
              schemaVersion: payload.schemaVersion,
              contractVersion: payload.contractVersion,
              hostId: payload.hostId,
              screenId: payload.screenId,
              structureVersion: payload.structureVersion,
              structureHash: payload.structureHash,
              constraintHash: payload.constraintHash,
              viewportClass: payload.viewportClass,
              operations: [{ type: "setColumns", targetId: payload.components[0].id, columns: 2 }],
            })),
            output: [],
          };
        },
      },
    } as unknown as UniversalLayoutOpenAIClient;
    return createUniversalLayoutOpenAIProvider({ client });
  };
  const provider = makeResponseProvider((plan) => plan);
  const plan = await generateUniversalLayoutPlan({
    model,
    policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
    provider,
  });
  assert.equal(requestModel, "gpt-6-luna");
  assert.equal(plan.operations[0].type, "setColumns");
  assert.equal(plan.operations[0].columns, 2);

  const invalidResponseCases = [
    {
      transform: (value: Record<string, unknown>) => ({ ...value, structureHash: "a".repeat(64) }),
      expected: "PLAN_REJECTED",
    },
    {
      transform: (value: Record<string, unknown>) => ({ ...value, schemaVersion: 2 }),
      expected: "INVALID_STRUCTURED_OUTPUT",
    },
    {
      transform: (value: Record<string, unknown>) => ({
        ...value,
        operations: [{ type: "setColumns", targetId: "menu.product-list", columns: 3 }],
      }),
      expected: "PLAN_REJECTED",
    },
  ];
  for (const { transform, expected } of invalidResponseCases) {
    await assert.rejects(
      generateUniversalLayoutPlan({
        model,
        policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
        provider: makeResponseProvider(transform),
      }),
      (error: unknown) => error instanceof UniversalLayoutGenerationError &&
        error.code === expected,
    );
    assert.equal(requestModel, "gpt-6-luna");
  }

  const malformedProvider = createUniversalLayoutOpenAIProvider({
    client: {
      responses: {
        create: async () => ({ output_text: "{invalid json", output: [] }),
      },
    } as unknown as UniversalLayoutOpenAIClient,
  });
  await assert.rejects(
    generateUniversalLayoutPlan({
      model,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: malformedProvider,
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError && error.code === "INVALID_JSON",
  );
});

test("gpt-6-luna Fake Responses timeout is stopped before plan validation", async () => {
  const model = createUniversalLayoutModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY, {
    viewportClass: "regular",
    accessibility: {
      textScale: "standard",
      buttonScale: "standard",
      contrast: "standard",
      viewportMode: null,
    },
    componentState: [{
      id: "menu.product-list",
      itemCount: 12,
      itemOrderHash: universalSha256({ order: "fixture" }),
    }],
  });
  const provider = createUniversalLayoutOpenAIProvider({
    client: {
      responses: {
        create: async () => {
          const error = new Error("fake timeout");
          error.name = "TimeoutError";
          throw error;
        },
      },
    } as unknown as UniversalLayoutOpenAIClient,
  });
  await assert.rejects(
    generateUniversalLayoutPlan({
      model,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider,
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError && error.code === "PROVIDER_TIMEOUT",
  );
});

test("OpenAI adapter fails explicitly when no API key or injected client exists", () => {
  assert.throws(
    () => createUniversalLayoutOpenAIProvider({ apiKey: "" }),
    /AI_NOT_CONFIGURED/,
  );
});
