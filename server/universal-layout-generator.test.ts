import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNIVERSAL_LAYOUT_CONTRACT_VERSION,
  UNIVERSAL_LAYOUT_SCHEMA_VERSION,
  createUniversalLayoutModel,
  universalSha256,
  type UniversalLayoutModel,
  type UniversalLayoutPolicy,
} from "./universal-layout-contract";
import {
  CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY,
  DEMO_COFFEE_UNIVERSAL_MOCK_POLICY,
  UNIVERSAL_LAYOUT_MOCK_POLICIES,
} from "./universal-layout-mock-policies";
import {
  UNIVERSAL_LAYOUT_SYSTEM_INSTRUCTION,
  UniversalLayoutGenerationError,
  createUniversalLayoutPlanJsonSchema,
  generateUniversalLayoutPlan,
  type UniversalLayoutPlanProvider,
  type UniversalLayoutPromptPayload,
} from "./universal-layout-generator";

const standardAccessibility = {
  textScale: "standard" as const,
  buttonScale: "standard" as const,
  contrast: "standard" as const,
  viewportMode: null,
};

function makeModel(
  policy: UniversalLayoutPolicy,
  viewportClass: "compact" | "regular" | "wide" = "regular",
): UniversalLayoutModel {
  return createUniversalLayoutModel(policy, {
    viewportClass,
    accessibility: standardAccessibility,
    componentState: policy.components.map((component) => ({
      id: component.id,
      itemCount: component.id === "civil.certificate-grid" ? 18 : 12,
      itemOrderHash: universalSha256({ fixtureOrder: component.id }),
    })),
  });
}

function mockProvider(
  choose: (payload: UniversalLayoutPromptPayload) => unknown,
  onCall?: (input: Parameters<UniversalLayoutPlanProvider["generate"]>[0]) => void,
): UniversalLayoutPlanProvider {
  return {
    async generate(input) {
      onCall?.(input);
      return choose(input.payload);
    },
  };
}

function validPlan(payload: UniversalLayoutPromptPayload, columns: number) {
  return {
    schemaVersion: UNIVERSAL_LAYOUT_SCHEMA_VERSION,
    contractVersion: UNIVERSAL_LAYOUT_CONTRACT_VERSION,
    hostId: payload.hostId,
    screenId: payload.screenId,
    structureVersion: payload.structureVersion,
    structureHash: payload.structureHash,
    constraintHash: payload.constraintHash,
    viewportClass: payload.viewportClass,
    operations: [{ type: "setColumns", targetId: payload.components[0].id, columns }],
  };
}

test("one generator function uses the same schema and validator for both host policies", async () => {
  const instructions: string[] = [];
  for (const policy of [DEMO_COFFEE_UNIVERSAL_MOCK_POLICY, CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY]) {
    const model = makeModel(policy);
    for (const columns of [1, 2]) {
      let calls = 0;
      const plan = await generateUniversalLayoutPlan({
        model,
        policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
        provider: mockProvider((payload) => validPlan(payload, columns), ({ systemInstruction }) => {
          calls += 1;
          instructions.push(systemInstruction);
        }),
      });
      assert.equal(calls, 1);
      assert.equal(plan.operations[0].columns, columns);
      assert.equal(plan.hostId, policy.hostId);
      assert.equal(plan.screenId, policy.screenId);
    }
  }
  assert.equal(instructions.length, 4);
  assert.deepEqual(new Set(instructions), new Set([UNIVERSAL_LAYOUT_SYSTEM_INSTRUCTION]));
});

test("the common structured schema derives target IDs and allowed columns from policy", () => {
  const menuSchema = createUniversalLayoutPlanJsonSchema(makeModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY));
  const menuOperations = menuSchema.properties.operations as {
    items: { properties: Record<string, { const?: string; enum?: number[] }> };
  };
  assert.equal(menuOperations.items.properties.targetId.const, "menu.product-list");
  assert.deepEqual(menuOperations.items.properties.columns.enum, [1, 2]);
  assert.equal(menuSchema.additionalProperties, false);

  const civilSchema = createUniversalLayoutPlanJsonSchema(makeModel(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY));
  const civilOperations = civilSchema.properties.operations as {
    items: { properties: Record<string, { const?: string; enum?: number[] }> };
  };
  assert.equal(civilOperations.items.properties.targetId.const, "civil.certificate-grid");
  assert.deepEqual(civilOperations.items.properties.columns.enum, [1, 2]);

  const civilWideSchema = createUniversalLayoutPlanJsonSchema(
    makeModel(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY, "wide"),
  );
  const civilWideOperations = civilWideSchema.properties.operations as {
    items: { properties: Record<string, { const?: string; enum?: number[] }> };
  };
  assert.deepEqual(civilWideOperations.items.properties.columns.enum, [1, 2]);
});

test("disallowed values, cross-host plans, and extra fields fail without repair or retry", async () => {
  const menuModel = makeModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY);
  let providerCalls = 0;
  const expectRejected = async (output: unknown, code: string) => {
    await assert.rejects(
      generateUniversalLayoutPlan({
        model: menuModel,
        policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
        provider: mockProvider(() => {
          providerCalls += 1;
          return output;
        }),
      }),
      (error: unknown) => error instanceof UniversalLayoutGenerationError &&
        error.code === "PLAN_REJECTED" && error.validationCode === code,
    );
  };
  await expectRejected(validPlan({
    schemaVersion: 1,
    contractVersion: "universal-layout.v1",
    hostId: "democoffee",
    screenId: "cafe.menu",
    structureVersion: "menu.v2",
    structureHash: menuModel.structureHash,
    constraintHash: menuModel.constraintHash,
    viewportClass: "regular",
    accessibility: menuModel.accessibility,
    components: [{ ...menuModel.components[0], allowedColumns: [1, 2] }],
  }, 3), "DISALLOWED_COLUMN_COUNT");

  const civilModel = makeModel(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY);
  await assert.rejects(
    generateUniversalLayoutPlan({
      model: civilModel,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider((payload) => validPlan(payload, 3), () => { providerCalls += 1; }),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError &&
      error.code === "PLAN_REJECTED" && error.validationCode === "DISALLOWED_COLUMN_COUNT",
  );
  const civilWideModel = makeModel(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY, "wide");
  await assert.rejects(
    generateUniversalLayoutPlan({
      model: civilWideModel,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider((payload) => validPlan(payload, 3), () => { providerCalls += 1; }),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError &&
      error.code === "PLAN_REJECTED" && error.validationCode === "DISALLOWED_COLUMN_COUNT",
  );

  await expectRejected({
    ...validPlan({
      schemaVersion: 1,
      contractVersion: "universal-layout.v1",
      hostId: "democoffee",
      screenId: "cafe.menu",
      structureVersion: "menu.v2",
      structureHash: menuModel.structureHash,
      constraintHash: menuModel.constraintHash,
      viewportClass: "regular",
      accessibility: menuModel.accessibility,
      components: [{ ...menuModel.components[0], allowedColumns: [1, 2] }],
    }, 1),
    hostId: "civil-kiosk-mock",
  }, "PLAN_MODEL_MISMATCH");

  await assert.rejects(
    generateUniversalLayoutPlan({
      model: menuModel,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider((payload) => ({
        ...validPlan(payload, 1),
        generatedCss: ".unsafe { display: none }",
      }), () => { providerCalls += 1; }),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError &&
      error.code === "INVALID_STRUCTURED_OUTPUT",
  );
  assert.equal(providerCalls, 5);
});

test("private or business content is not copied into the generation payload", async () => {
  const sensitiveFixture = "PRIVATE-ORDER-ITEM-MUST-NOT-LEAK";
  const model = createUniversalLayoutModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY, {
    viewportClass: "regular",
    accessibility: standardAccessibility,
    componentState: [{
      id: "menu.product-list",
      itemCount: 12,
      itemOrderHash: universalSha256({ privateFixture: sensitiveFixture }),
    }],
  });
  const userSentinel = "PRIVATE-ORDER-ITEM-MUST-NOT-LEAK";
  const privateDigest = universalSha256({ privateFixture: sensitiveFixture });
  let promptPayload = "";
  const captureProvider = mockProvider((payload) => validPlan(payload, 1), ({ payload }) => {
    promptPayload = JSON.stringify(payload);
  });
  await generateUniversalLayoutPlan({
    model,
    policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
    provider: captureProvider,
  });
  assert.equal(promptPayload.includes(userSentinel), false);
  assert.equal(promptPayload.includes(privateDigest), false);
  assert.equal(promptPayload.includes("itemOrderHash"), false);
  assert.equal(promptPayload.includes("itemCount"), false);
  assert.equal(promptPayload.includes("PRIVATE"), false);
});

test("provider failures, malformed JSON, invalid schema, and abort are explicit and single-shot", async () => {
  const model = makeModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY);
  let calls = 0;
  await assert.rejects(
    generateUniversalLayoutPlan({
      model,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider(() => { calls += 1; throw new Error("provider detail not exposed"); }),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError && error.code === "PROVIDER_FAILURE",
  );
  await assert.rejects(
    generateUniversalLayoutPlan({
      model,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider(() => {
        calls += 1;
        const error = new Error("provider timed out");
        error.name = "TimeoutError";
        throw error;
      }),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError && error.code === "PROVIDER_TIMEOUT",
  );
  await assert.rejects(
    generateUniversalLayoutPlan({
      model,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider(() => { calls += 1; return "{bad json"; }),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError && error.code === "INVALID_JSON",
  );
  await assert.rejects(
    generateUniversalLayoutPlan({
      model,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider(() => { calls += 1; return { unexpected: true }; }),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError &&
      error.code === "INVALID_STRUCTURED_OUTPUT",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    generateUniversalLayoutPlan({
      model,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider(() => { calls += 1; return {}; }),
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError && error.code === "REQUEST_ABORTED",
  );
  assert.equal(calls, 4);
});

test("common provider rejects wrong operation, wrong target, wrong hashes, missing fields and stale policy", async () => {
  const model = makeModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY);
  const rejectAs = async (output: unknown, validationCode: string) => {
    await assert.rejects(
      generateUniversalLayoutPlan({
        model,
        policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
        provider: mockProvider(() => output),
      }),
      (error: unknown) => error instanceof UniversalLayoutGenerationError &&
        error.code === "PLAN_REJECTED" && error.validationCode === validationCode,
    );
  };

  await assert.rejects(
    generateUniversalLayoutPlan({
      model,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider((payload) => ({
        ...validPlan(payload, 1),
        operations: [{ type: "setSpacing", targetId: payload.components[0].id, columns: 1 }],
      })),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError &&
      error.code === "INVALID_STRUCTURED_OUTPUT",
  );
  await assert.rejects(
    generateUniversalLayoutPlan({
      model,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider((payload) => ({
        ...validPlan(payload, 1),
        schemaVersion: 2,
      })),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError &&
      error.code === "INVALID_STRUCTURED_OUTPUT",
  );
  await rejectAs({
    ...validPlan({
      schemaVersion: 1,
      contractVersion: "universal-layout.v1",
      hostId: model.hostId,
      screenId: model.screenId,
      structureVersion: model.structureVersion,
      structureHash: model.structureHash,
      constraintHash: model.constraintHash,
      viewportClass: model.viewportClass,
      accessibility: model.accessibility,
      components: [{ ...model.components[0], allowedColumns: [1, 2] }],
    }, 1),
    structureHash: "a".repeat(64),
  }, "PLAN_MODEL_MISMATCH");
  await rejectAs({
    ...validPlan({
      schemaVersion: 1,
      contractVersion: "universal-layout.v1",
      hostId: model.hostId,
      screenId: model.screenId,
      structureVersion: model.structureVersion,
      structureHash: model.structureHash,
      constraintHash: model.constraintHash,
      viewportClass: model.viewportClass,
      accessibility: model.accessibility,
      components: [{ ...model.components[0], allowedColumns: [1, 2] }],
    }, 1),
    constraintHash: "b".repeat(64),
  }, "PLAN_MODEL_MISMATCH");
  await rejectAs({
    ...validPlan({
      schemaVersion: 1,
      contractVersion: "universal-layout.v1",
      hostId: model.hostId,
      screenId: model.screenId,
      structureVersion: model.structureVersion,
      structureHash: model.structureHash,
      constraintHash: model.constraintHash,
      viewportClass: model.viewportClass,
      accessibility: model.accessibility,
      components: [{ ...model.components[0], allowedColumns: [1, 2] }],
    }, 1),
    structureVersion: "menu.v999",
  }, "PLAN_MODEL_MISMATCH");
  await rejectAs({
    ...validPlan({
      schemaVersion: 1,
      contractVersion: "universal-layout.v1",
      hostId: model.hostId,
      screenId: model.screenId,
      structureVersion: model.structureVersion,
      structureHash: model.structureHash,
      constraintHash: model.constraintHash,
      viewportClass: model.viewportClass,
      accessibility: model.accessibility,
      components: [{ ...model.components[0], allowedColumns: [1, 2] }],
    }, 1),
    operations: [{ type: "setColumns", targetId: "other.screen.component", columns: 1 }],
  }, "UNSUPPORTED_PLAN_OPERATION");
  await assert.rejects(
    generateUniversalLayoutPlan({
      model,
      policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
      provider: mockProvider((payload) => {
        const output = validPlan(payload, 1) as Record<string, unknown>;
        delete output.constraintHash;
        return output;
      }),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError &&
      error.code === "INVALID_STRUCTURED_OUTPUT",
  );

  const mutablePolicy: UniversalLayoutPolicy = {
    ...DEMO_COFFEE_UNIVERSAL_MOCK_POLICY,
    components: DEMO_COFFEE_UNIVERSAL_MOCK_POLICY.components.map((component) => ({
      ...component,
      allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    })),
  };
  const staleModel = makeModel(mutablePolicy);
  await assert.rejects(
    generateUniversalLayoutPlan({
      model: staleModel,
      policies: [mutablePolicy],
      provider: mockProvider((payload) => {
        (mutablePolicy.components[0].allowedColumnsByViewport as unknown as Record<string, number[]>).regular = [1];
        return validPlan(payload, 2);
      }),
    }),
    (error: unknown) => error instanceof UniversalLayoutGenerationError &&
      error.code === "PLAN_REJECTED" && error.validationCode === "COMPONENT_POLICY_MISMATCH",
  );
});
