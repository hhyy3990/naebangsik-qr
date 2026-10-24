import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Pool } from "pg";
import type OpenAI from "openai";
import { createApp } from "./app";
import {
  DEMO_OPTIONS_GROUP_ID,
  DEMO_OPTIONS_STRUCTURE_HASH,
  demoOptionsHash,
  generateDemoOptionsPlan,
  validateDemoOptionsModel,
  validateDemoOptionsPlan,
  type DemoOptionsModel,
  type DemoOptionsPlan,
} from "./demo-options-layout";

function model(viewportClass: "compact" | "regular", large = false): DemoOptionsModel {
  const constraints = {
    textScale: large ? "large" as const : "standard" as const,
    buttonScale: large ? "large" as const : "standard" as const,
    defaultColumns: viewportClass === "compact" || large ? 1 as const : 2 as const,
    allowedColumns: (viewportClass === "compact" || large ? [1] : [1, 2]) as (1 | 2)[],
  };
  return {
    schemaVersion: 1,
    hostId: "democoffee",
    screenId: "cafe.product-options",
    structureVersion: "options.v1",
    structureHash: DEMO_OPTIONS_STRUCTURE_HASH,
    constraintHash: demoOptionsHash(JSON.stringify(constraints)),
    viewportClass,
    groups: [{ id: DEMO_OPTIONS_GROUP_ID, role: "option-button-group", mutableProperties: ["columns"] }],
    requiredIds: [DEMO_OPTIONS_GROUP_ID],
    protectedProperties: [
      "option.items", "option.order", "option.names", "option.selection", "option.requiredness",
      "option.additionalPrice", "quantity", "cart", "order", "payment", "navigation",
    ],
    allowedOperations: ["setGroupColumns"],
    constraints,
  };
}

const plan = (input: DemoOptionsModel, columns: 1 | 2): DemoOptionsPlan => ({
  schemaVersion: 1,
  screenId: input.screenId,
  structureHash: input.structureHash,
  constraintHash: input.constraintHash,
  viewportClass: input.viewportClass,
  operations: [{ type: "setGroupColumns", targetId: DEMO_OPTIONS_GROUP_ID, columns }],
});

test("options.v1 draft hash and model policy accept compact, standard, and large accessibility models", () => {
  assert.equal(DEMO_OPTIONS_STRUCTURE_HASH, "f808446c");
  assert.doesNotThrow(() => validateDemoOptionsModel(model("compact")));
  assert.deepEqual(validateDemoOptionsModel(model("regular")).constraints.allowedColumns, [1, 2]);
  assert.deepEqual(validateDemoOptionsModel(model("regular", true)).constraints.allowedColumns, [1]);
});

test("options.v1 validates allowed columns and rejects accessibility-incompatible plans", () => {
  const regular = validateDemoOptionsModel(model("regular"));
  assert.doesNotThrow(() => validateDemoOptionsPlan(plan(regular, 1), regular));
  assert.doesNotThrow(() => validateDemoOptionsPlan(plan(regular, 2), regular));

  const compact = validateDemoOptionsModel(model("compact"));
  assert.throws(() => validateDemoOptionsPlan(plan(compact, 2), compact), /DISALLOWED_OPTION_COLUMN_COUNT/);
  const large = validateDemoOptionsModel(model("regular", true));
  assert.throws(() => validateDemoOptionsPlan(plan(large, 2), large), /DISALLOWED_OPTION_COLUMN_COUNT/);
});

test("options.v1 rejects unknown groups, operations, hashes, and extra plan fields", () => {
  const regular = model("regular");
  assert.throws(() => validateDemoOptionsModel({ ...regular, structureHash: "deadbeef" }), /OPTIONS_STRUCTURE_HASH_MISMATCH/);
  assert.throws(() => validateDemoOptionsModel({ ...regular, constraintHash: "deadbeef" }), /OPTIONS_CONSTRAINT_HASH_MISMATCH/);
  assert.throws(() => validateDemoOptionsModel({
    ...regular,
    groups: [{ ...regular.groups[0], id: "options.unknown" }],
  }));
  assert.throws(() => validateDemoOptionsPlan({ ...plan(regular, 1), extra: true }, regular));
});

test("options.v1 OpenAI adapter validates a mocked response without network access", async () => {
  const regular = model("regular");
  const expected = plan(regular, 2);
  let captured: Record<string, unknown> | undefined;
  let mockCalls = 0;
  const client = {
    responses: {
      create: async (params: Record<string, unknown>) => {
        captured = params;
        mockCalls += 1;
        return { output_text: JSON.stringify(expected) };
      },
    },
  } as unknown as OpenAI;
  const events: string[] = [];
  assert.deepEqual(await generateDemoOptionsPlan(regular, client, (event) => events.push(event)), expected);
  assert.equal(mockCalls, 1);
  assert.equal(captured?.store, false);
  assert.deepEqual(events, [
    "openai_attempt", "openai_response", "json_parse_started", "json_parsed",
    "plan_validation_started", "plan_validated",
  ]);
});

test("central plan endpoint routes options.v1 to its isolated mocked policy and generator", async () => {
  const input = model("regular");
  const token = "options-layout-test-token-not-a-real-secret";
  let generatorCalls = 0;
  const expected = plan(input, 1);
  const app = createApp({} as Pool, undefined, {
    serviceToken: token,
    demoOptionsPlanGenerator: async () => {
      generatorCalls += 1;
      return expected;
    },
  });
  const response = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send(input);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, expected);
  assert.equal(generatorCalls, 1);

  const unsupported = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send({ ...input, screenId: "cafe.unknown-options" });
  assert.equal(unsupported.status, 404);
  assert.equal(generatorCalls, 1);
});
