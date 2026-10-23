import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Pool } from "pg";
import type OpenAI from "openai";
import { createApp } from "./app";
import {
  demoMenuHash,
  DEMO_MENU_STRUCTURE_HASH,
  generateDemoMenuPlan,
  validateDemoMenuModel,
  validateDemoMenuPlan,
  type DemoMenuModel,
  type DemoMenuPlan,
} from "./demo-menu-layout";

const groups = [
  { id: "menu.product-list", role: "ordered-menu-list", childIds: ["menu.product-card"], preserveOrder: true, mutableProperties: ["columns"] },
  { id: "menu.product-card", role: "repeated-menu-item", childIds: ["menu.product-image", "menu.product-information"], preserveOrder: true, mutableProperties: ["flow", "gap"] },
  { id: "menu.product-information", role: "product-information", childIds: ["menu.product-name", "menu.product-price", "menu.product-description", "menu.product-action"], preserveOrder: true, mutableProperties: [] },
];
const requiredIds = ["menu.category-navigation", "menu.product-list", "menu.fixed-controls", "menu.product-action"];
const protectedProperties = ["menu.product-list.items", "menu.product-list.order", "menu.category-navigation", "menu.fixed-controls", "menu.product-content", "menu.product-action.behavior"];

function model(view: "compact" | "regular", large = false): DemoMenuModel {
  const constraints = {
    textScale: large ? "large" as const : "standard" as const,
    buttonScale: large ? "large" as const : "standard" as const,
    highContrast: large,
    viewportModePercent: large ? 80 as const : null,
    defaultColumns: view === "compact" || large ? 1 as const : 2 as const,
    allowedColumns: (view === "compact" || large ? [1] : [1, 2]) as (1 | 2)[],
    minimumTouchTargetPx: 44 as const,
    preserveTopGuidance: true as const,
    preserveFixedControls: true as const,
  };
  return {
    schemaVersion: 2,
    hostId: "democoffee",
    screenId: "cafe.menu",
    structureVersion: "menu.v2",
    structureHash: DEMO_MENU_STRUCTURE_HASH,
    constraintHash: demoMenuHash(JSON.stringify(constraints)),
    viewportClass: view,
    groups,
    requiredIds,
    protectedProperties,
    allowedOperations: ["setGroupColumns", "setGroupFlow", "setChildBasis"],
    constraints,
  };
}

const columns = (number: 1 | 2) => ({ type: "setGroupColumns" as const, targetId: "menu.product-list" as const, columns: number });
const flow = { type: "setGroupFlow" as const, targetId: "menu.product-card" as const, direction: "row" as const, gapPx: 12 };
const basis = { type: "setChildBasis" as const, targetId: "menu.product-image" as const, basisPercent: 25, minPx: 76 };
const makePlan = (current: DemoMenuModel, operations: DemoMenuPlan["operations"]): DemoMenuPlan => ({
  schemaVersion: 2,
  screenId: "cafe.menu",
  structureHash: current.structureHash,
  constraintHash: current.constraintHash,
  viewportClass: current.viewportClass,
  operations,
});

test("DemoCafe v2 reproduces the documented FNV-1a structure and constraint hashes", () => {
  assert.equal(DEMO_MENU_STRUCTURE_HASH, "837f86b3");
  assert.equal(model("compact").constraintHash, "207c8de6");
  assert.equal(model("regular").constraintHash, "df5bb9a5");
  assert.equal(model("regular", true).constraintHash, "8ea80fa2");
  assert.doesNotThrow(() => validateDemoMenuModel(model("compact")));
  assert.doesNotThrow(() => validateDemoMenuModel(model("regular")));
  assert.doesNotThrow(() => validateDemoMenuModel(model("regular", true)));
});

test("DemoCafe v2 accepts V1-V3 valid independent and combined layout plans", () => {
  const compact = model("compact");
  const regular = model("regular");
  assert.doesNotThrow(() => validateDemoMenuPlan(makePlan(compact, [flow, basis]), compact)); // V1
  assert.doesNotThrow(() => validateDemoMenuPlan(makePlan(regular, [columns(1)]), regular)); // V2
  assert.doesNotThrow(() => validateDemoMenuPlan(makePlan(regular, [columns(1), flow, basis]), regular)); // V3
});

test("DemoCafe v2 OpenAI adapter uses strict structured output and validates the mocked plan", async () => {
  const regular = model("regular");
  const plan = makePlan(regular, [columns(1)]);
  let captured: Record<string, unknown> | undefined;
  const diagnosticEvents: string[] = [];
  let providerCalls = 0;
  const client = {
    responses: {
      create: async (params: Record<string, unknown>) => {
        providerCalls += 1;
        captured = params;
        return { output_text: JSON.stringify(plan) };
      },
    },
  } as unknown as OpenAI;
  assert.deepEqual(await generateDemoMenuPlan(regular, client, (event) => diagnosticEvents.push(event)), plan);
  assert.equal(providerCalls, 1);
  assert.deepEqual(diagnosticEvents, [
    "openai_attempt",
    "openai_response",
    "json_parse_started",
    "json_parsed",
    "plan_validation_started",
    "plan_validated",
  ]);
  assert.equal(captured?.store, false);
  assert.equal((captured?.text as { format: { strict: boolean } }).format.strict, true);
  assert.equal(captured?.max_output_tokens, 700);
});

test("DemoCafe v2 adapter reports a mocked provider timeout without retrying", async () => {
  const regular = model("regular");
  let providerCalls = 0;
  const diagnosticEvents: string[] = [];
  const timeout = Object.assign(new Error("simulated timeout"), { name: "APIConnectionTimeoutError" });
  const client = {
    responses: {
      create: async () => {
        providerCalls += 1;
        throw timeout;
      },
    },
  } as unknown as OpenAI;

  await assert.rejects(
    generateDemoMenuPlan(regular, client, (event) => diagnosticEvents.push(event)),
    /simulated timeout/,
  );
  assert.equal(providerCalls, 1);
  assert.deepEqual(diagnosticEvents, ["openai_attempt", "openai_timeout"]);
});

test("DemoCafe v2 rejects V4-V6 unsafe columns and malformed operation combinations", () => {
  const compact = model("compact");
  const regular = model("regular");
  const large = model("regular", true);
  assert.throws(() => validateDemoMenuPlan(makePlan(compact, [columns(2)]), compact)); // V4
  assert.throws(() => validateDemoMenuPlan(makePlan(regular, [columns(2), flow, basis]), regular)); // V5
  assert.throws(() => validateDemoMenuPlan(makePlan(large, [columns(2)]), large)); // V6
  assert.throws(() => validateDemoMenuPlan(makePlan(regular, [flow]), regular));
  assert.throws(() => validateDemoMenuPlan(makePlan(regular, [basis, flow]), regular));
  assert.throws(() => validateDemoMenuPlan(makePlan(regular, [flow, basis, columns(1)]), regular));
  assert.throws(() => validateDemoMenuPlan({ ...makePlan(regular, [columns(1)]), extra: true }, regular));
  assert.throws(() => validateDemoMenuPlan(makePlan(regular, [
    { ...columns(1), targetId: "menu.fixed-controls" } as unknown as DemoMenuPlan["operations"][number],
  ]), regular));
});

test("DemoCafe v2 recomputes hashes and rejects changed model invariants", () => {
  const regular = model("regular");
  assert.throws(() => validateDemoMenuModel({ ...regular, structureHash: "deadbeef" }), /STRUCTURE_HASH_MISMATCH/);
  assert.throws(() => validateDemoMenuModel({ ...regular, constraintHash: "deadbeef" }), /CONSTRAINT_HASH_MISMATCH/);
  assert.throws(() => validateDemoMenuModel({
    ...regular,
    constraints: { ...regular.constraints, allowedColumns: [1] },
  }), /CONSTRAINT_HASH_MISMATCH|INVALID_MENU_COLUMN_CONSTRAINTS/);
  assert.throws(() => validateDemoMenuPlan({ ...makePlan(regular, [columns(1)]), viewportClass: "compact" }, regular));
});

test("AI layout endpoint authenticates and applies the server-owned DemoCafe policy without a paid call", async () => {
  const input = model("regular");
  const token = "demo-layout-test-token-not-a-real-secret";
  let calls = 0;
  const plan = makePlan(input, [columns(1)]);
  const app = createApp({} as Pool, undefined, {
    serviceToken: token,
    demoMenuPlanGenerator: async () => { calls += 1; return plan; },
  });
  assert.equal((await request(app).post("/api/ai-layout/plan").send(input)).status, 401);
  const response = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send(input);
  assert.equal(response.status, 200);
  assert.match(response.headers["x-request-id"], /^[0-9a-f-]{36}$/);
  assert.deepEqual(response.body, plan);
  assert.equal(calls, 1);
  const malformed = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send({});
  assert.equal(malformed.status, 400);
  assert.match(malformed.headers["x-request-id"], /^[0-9a-f-]{36}$/);
  assert.equal(calls, 1);

  const invalid = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send({ ...input, structureHash: "deadbeef" });
  assert.equal(invalid.status, 400);
  assert.equal(calls, 1);

  const unsupportedScreen = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send({ ...input, screenId: "cafe.unknown" });
  assert.equal(unsupportedScreen.status, 404);
  assert.match(unsupportedScreen.headers["x-request-id"], /^[0-9a-f-]{36}$/);
  assert.equal(calls, 1);

  const missingRoute = await request(app).post("/api/ai-layout/not-plan").send(input);
  assert.equal(missingRoute.status, 404);
  assert.match(missingRoute.headers["x-request-id"], /^[0-9a-f-]{36}$/);
  assert.equal(calls, 1);
});

test("AI layout endpoint rejects a malformed mock plan with a generic 502 and no provider call", async () => {
  const input = model("regular");
  const token = "demo-layout-test-token-not-a-real-secret";
  let generatorCalls = 0;
  const app = createApp({} as Pool, undefined, {
    serviceToken: token,
    demoMenuPlanGenerator: async () => {
      generatorCalls += 1;
      return { ...makePlan(input, [columns(1)]), constraintHash: "deadbeef" };
    },
  });

  const response = await request(app)
    .post("/api/ai-layout/plan")
    .set("Authorization", `Bearer ${token}`)
    .send(input);

  assert.equal(response.status, 502);
  assert.deepEqual(response.body, { error: "화면 구성 계획을 만들지 못했어요. 기존 화면을 유지해 주세요." });
  assert.equal(generatorCalls, 1);
});
