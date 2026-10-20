import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import type { Pool } from "pg";
import request from "supertest";
import { createApp } from "./app";
import { generateLayoutPlan } from "./ai-layout";
import {
  computeLayoutStructureHash,
  validateLayoutPlan,
  validateLayoutPlanRequest,
  type LayoutPlan,
  type LayoutPlanRequest,
  type LayoutPolicy,
} from "./layout-plan";

const policy: LayoutPolicy = {
  hostAppId: "sample-kiosk",
  screenId: "sample-menu",
  modelVersion: "1",
  structureVersion: "sample-v1",
  elementIds: ["content", "menu-group", "menu-item", "qr-controls"],
  requiredElementIds: ["content", "menu-item", "qr-controls"],
  mutableTargetIds: ["menu-group"],
  immutableElementIds: ["qr-controls"],
  operations: [
    { operation: "set_flow", targetIds: ["menu-group"], allowedValues: ["horizontal", "vertical"] },
    { operation: "set_gap", targetIds: ["menu-group"], allowedValues: ["compact", "regular", "spacious"] },
    { operation: "set_columns", targetIds: ["menu-group"], min: 1, max: 3 },
  ],
};

const inputWithoutHash = {
  modelVersion: "1" as const,
  hostAppId: "sample-kiosk",
  screenId: "sample-menu",
  structureVersion: "sample-v1",
  viewport: "standard" as const,
  availableArea: { widthBucket: "regular" as const, heightBucket: "regular" as const },
  elements: [
    { id: "content", role: "container" as const, groupId: null, order: 0, kind: "content" as const },
    { id: "menu-group", role: "container" as const, groupId: "content", order: 1, kind: "content" as const },
    { id: "menu-item", role: "item" as const, groupId: "menu-group", order: 2, kind: "content" as const },
    { id: "qr-controls", role: "fixed-control" as const, groupId: null, order: 3, kind: "fixed" as const },
  ],
  constraints: {
    textSize: "large" as const,
    buttonSize: "large" as const,
    contrast: "high" as const,
    viewportMode: { mode: "bottom" as const, heightPercent: 70 as const },
  },
};

const input: LayoutPlanRequest = {
  ...inputWithoutHash,
  structureHash: computeLayoutStructureHash(inputWithoutHash),
};

const plan: LayoutPlan = {
  schemaVersion: 1,
  screenId: input.screenId,
  structureVersion: input.structureVersion,
  structureHash: input.structureHash,
  operations: [{ operation: "set_flow", targetId: "menu-group", value: "vertical" }],
  reasonCode: "readability",
};

test("layout input requires a registered screen, elements, and matching structure hash", () => {
  assert.deepEqual(validateLayoutPlanRequest(input, [policy]), input);
  assert.throws(() => validateLayoutPlanRequest(input, []), /UNSUPPORTED_SCREEN/);
  assert.throws(() => validateLayoutPlanRequest({
    ...input,
    elements: input.elements.map((element) =>
      element.id === "menu-item" ? { ...element, id: "unregistered-item" } : element,
    ),
  }, [policy]), /STRUCTURE_HASH_MISMATCH/);
  assert.throws(() => validateLayoutPlanRequest({
    ...input,
    extra: "not allowed",
  }, [policy]));
  assert.throws(() => validateLayoutPlanRequest({
    ...input,
    qrToken: "not-forwarded",
  }, [policy]));
});

test("layout plan accepts allowlisted operations and rejects unknown targets, values, and stale screens", () => {
  assert.deepEqual(validateLayoutPlan(plan, input, policy), plan);
  assert.throws(() => validateLayoutPlan({
    ...plan,
    operations: [{ operation: "set_gap", targetId: "menu-group", value: "giant" }],
  }, input, policy), /LAYOUT_VALUE_OUT_OF_RANGE/);
  assert.throws(() => validateLayoutPlan({
    ...plan,
    operations: [{ operation: "set_columns", targetId: "menu-group", value: 4 }],
  }, input, policy), /LAYOUT_VALUE_OUT_OF_RANGE/);
  assert.throws(() => validateLayoutPlan({
    ...plan,
    operations: [{ operation: "set_flow", targetId: "qr-controls", value: "vertical" }],
  }, input, policy), /IMMUTABLE_LAYOUT_TARGET/);
  assert.throws(() => validateLayoutPlan({
    ...plan,
    structureHash: "0".repeat(64),
  }, input, policy), /PLAN_STRUCTURE_MISMATCH/);
  assert.throws(() => validateLayoutPlan({
    ...plan,
    operations: [{ operation: "delete_element", targetId: "menu-item", value: "true" }],
  }, input, policy));
});

test("OpenAI plan generation uses Responses JSON Schema, store:false, and validates the model result", async () => {
  let captured: Record<string, unknown> | undefined;
  const client = {
    responses: {
      create: async (params: Record<string, unknown>) => {
        captured = params;
        return { output_text: JSON.stringify(plan) };
      },
    },
  } as unknown as OpenAI;

  const result = await generateLayoutPlan(input, policy, client);
  assert.deepEqual(result, plan);
  assert.equal(captured?.store, false);
  assert.equal(captured?.model, process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini");
  assert.equal((captured?.text as { format: { strict: boolean } }).format.strict, true);
});

test("AI layout API requires server auth and never calls the model for invalid or unregistered requests", async () => {
  let calls = 0;
  const app = createApp({} as Pool, undefined, {
    serviceToken: "test-service-token-not-a-secret-000000000000",
    policies: [policy],
    planGenerator: async () => {
      calls += 1;
      return plan;
    },
  });

  const missingAuth = await request(app).post("/api/ai-layout/plan").send(input);
  assert.equal(missingAuth.status, 401);
  const invalidAuth = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", "Bearer wrong-token")
    .send(input);
  assert.equal(invalidAuth.status, 401);
  const unsupportedInput = { ...input, screenId: "not-registered" };
  unsupportedInput.structureHash = computeLayoutStructureHash(unsupportedInput);
  const unsupported = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", "Bearer test-service-token-not-a-secret-000000000000")
    .send(unsupportedInput);
  assert.equal(unsupported.status, 404);
  const invalid = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", "Bearer test-service-token-not-a-secret-000000000000")
    .send({ ...input, structureHash: "0".repeat(64) });
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);
});

test("AI layout API returns a validated plan and safely maps provider failures", async () => {
  const token = "test-service-token-not-a-secret-000000000000";
  const app = createApp({} as Pool, undefined, {
    serviceToken: token,
    policies: [policy],
    planGenerator: async () => plan,
  });
  const response = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send(input);
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.body, plan);

  const failingApp = createApp({} as Pool, undefined, {
    serviceToken: token,
    policies: [policy],
    planGenerator: async () => { throw new Error("private provider failure"); },
  });
  const failed = await request(failingApp)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send(input);
  assert.equal(failed.status, 502);
  assert.doesNotMatch(JSON.stringify(failed.body), /private provider failure/);

  const timeoutApp = createApp({} as Pool, undefined, {
    serviceToken: token,
    policies: [policy],
    planGenerator: async () => {
      const error = new Error("timeout");
      error.name = "APIConnectionTimeoutError";
      throw error;
    },
  });
  const timedOut = await request(timeoutApp)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send(input);
  assert.equal(timedOut.status, 502);
  assert.doesNotMatch(JSON.stringify(timedOut.body), /timeout/);
});

test("AI layout API stays disabled when the service token is not configured", async () => {
  const app = createApp({} as Pool, undefined, {
    serviceToken: "",
    policies: [policy],
    planGenerator: async () => plan,
  });
  const response = await request(app).post("/api/ai-layout/plan").send(input);
  assert.equal(response.status, 503);
});

test("AI layout API applies a per-host in-memory request limit", async () => {
  const token = "test-service-token-not-a-secret-000000000000";
  let calls = 0;
  const app = createApp({} as Pool, undefined, {
    serviceToken: token,
    policies: [policy],
    maxRequestsPerHost: 1,
    planGenerator: async () => {
      calls += 1;
      return plan;
    },
  });
  const post = () => request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send(input);
  assert.equal((await post()).status, 200);
  const limited = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send({ ...input, viewport: "compact" });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "600");
  assert.equal(calls, 1);
});

test("malformed or oversized JSON is rejected without echoing request content", async () => {
  const app = createApp({} as Pool, undefined, { serviceToken: "token" });
  const malformed = await request(app)
    .post("/api/ai-layout/plan")
    .set("Content-Type", "application/json")
    .send('{"qrToken":"private-value"');
  assert.equal(malformed.status, 400);
  assert.doesNotMatch(JSON.stringify(malformed.body), /private-value/);

  const oversized = await request(app)
    .post("/api/ai-layout/plan")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ data: "x".repeat(20_000) }));
  assert.equal(oversized.status, 413);
});
