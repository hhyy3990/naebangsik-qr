import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import request from "supertest";
import { createApp } from "./app";
import {
  createUniversalLayoutV2Model,
  type UniversalLayoutV2Plan,
} from "./universal-layout-contract-v2";
import type { UniversalLayoutV2PlanProvider } from "./universal-layout-generator-v2";
import {
  PRODUCTION_V2_ROUTE,
  PRODUCTION_V2_REGISTRY,
  type ProductionV2Registration,
  type ProductionV2RequestStore,
  type ReserveResult,
} from "./universal-layout-v2-production";
import { DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY } from "./universal-v2-conformance-fixtures";

const hostId = DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY.hostId;
const screenId = DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY.screenId;
const secretEnv = "TEST_PRODUCTION_DEMO_AI_TOKEN";
const secretValue = "test-only-host-token-for-production-route";
const registration: ProductionV2Registration = {
  hostId,
  screenId,
  structureVersion: DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY.structureVersion,
  componentId: "menu.product-list",
  optionId: "single-column-list",
  policy: DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY,
  authSecretEnv: secretEnv,
};

const model = createUniversalLayoutV2Model(DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY, {
  viewportClass: "regular",
  accessibility: {
    textScale: "large",
    buttonScale: "large",
    contrast: "high",
    viewportMode: { mode: "bottom", heightPercent: 70 },
  },
  layoutCapabilities: [],
  componentState: [{
    id: "menu.product-list",
    itemCount: 5,
    itemOrderHash: "af0c4a1b243d46755fc31fa279e936f612bf2b3914b293d67e585d6aa5fb091a",
  }],
});

class MockStore implements ProductionV2RequestStore {
  used = 0;
  maxCalls = 30;
  records = new Map<string, {
    fingerprint: string;
    status: "reserved" | "succeeded" | "failed";
    plan?: UniversalLayoutV2Plan;
  }>();
  private queue = Promise.resolve();

  async reserve(input: {
    hostId: string;
    idempotencyKeyHash: string;
    requestFingerprint: string;
  }): Promise<ReserveResult> {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const key = `${input.hostId}:${input.idempotencyKeyHash}`;
      const current = this.records.get(key);
      if (current) {
        if (current.fingerprint !== input.requestFingerprint) return { kind: "key_conflict" };
        if (current.status === "succeeded" && current.plan) return { kind: "replay", plan: current.plan };
        return current.status === "reserved" ? { kind: "in_progress" } : { kind: "previous_failure" };
      }
      if (this.used >= this.maxCalls) return { kind: "quota_exhausted" };
      this.used += 1;
      this.records.set(key, { fingerprint: input.requestFingerprint, status: "reserved" });
      return { kind: "reserved" };
    } finally {
      release();
    }
  }

  async complete(input: { hostId: string; idempotencyKeyHash: string; plan: UniversalLayoutV2Plan }) {
    const record = this.records.get(`${input.hostId}:${input.idempotencyKeyHash}`);
    assert.ok(record);
    record.status = "succeeded";
    record.plan = input.plan;
  }

  async fail(input: { hostId: string; idempotencyKeyHash: string }) {
    const record = this.records.get(`${input.hostId}:${input.idempotencyKeyHash}`);
    if (record) record.status = "failed";
  }
}

function provider(calls: { count: number }, fail = false, delay = 0): UniversalLayoutV2PlanProvider {
  return {
    async generate({ payload }) {
      calls.count += 1;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (fail) throw new Error("mock provider failure");
      const component = payload.components[0];
      const group = component.optionGroups![0];
      return {
        schemaVersion: payload.schemaVersion,
        contractVersion: payload.contractVersion,
        hostId: payload.hostId,
        screenId: payload.screenId,
        structureVersion: payload.structureVersion,
        structureHash: payload.structureHash,
        constraintHash: payload.constraintHash,
        viewportClass: payload.viewportClass,
        operations: [{
          type: "selectLayoutOption",
          targetId: component.id,
          groupId: group.id,
          optionId: "single-column-list",
        }],
      };
    },
  };
}

function testApp(
  store: ProductionV2RequestStore,
  aiProvider: UniversalLayoutV2PlanProvider,
  registry: readonly ProductionV2Registration[] = [registration],
) {
  process.env.NODE_ENV = "production";
  process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER = "true";
  process.env[secretEnv] = secretValue;
  return createApp({} as Pool, undefined, {
    productionV2RequestStore: store,
    productionV2Provider: aiProvider,
    productionV2Registry: registry,
  });
}

function send(app: ReturnType<typeof testApp>, key: string, bodyModel = model) {
  return request(app)
    .post(PRODUCTION_V2_ROUTE)
    .set("X-Host-AI-Token", secretValue)
    .set("Idempotency-Key", key)
    .send({ model: bodyModel });
}

test("Production AI route is absent by default and unverified host scope fails closed", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
    const calls = { count: 0 };
    const app = createApp({} as Pool, undefined, {
      productionV2Provider: provider(calls),
      productionV2RequestStore: new MockStore(),
    });
    assert.equal((await request(app).post(PRODUCTION_V2_ROUTE).send({ model })).status, 404);

    const gatedApp = testApp(new MockStore(), provider(calls), PRODUCTION_V2_REGISTRY);
    const response = await request(gatedApp)
      .post(PRODUCTION_V2_ROUTE)
      .send({ model });
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "PRODUCTION_HOST_UNVERIFIED");
    assert.equal(calls.count, 0);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousGate === undefined) delete process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
    else process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER = previousGate;
    delete process.env[secretEnv];
  }
});

test("Concurrent identical Production requests invoke provider once and replay the validated result", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  const calls = { count: 0 };
  try {
    const store = new MockStore();
    const app = testApp(store, provider(calls, false, 30));
    const [first, second] = await Promise.all([
      send(app, "demo-session-key-0001"),
      send(app, "demo-session-key-0001"),
    ]);
    assert.equal(calls.count, 1);
    assert.equal(store.used, 1);
    assert.ok([200, 409].includes(first.status));
    assert.ok([200, 409].includes(second.status));
    const replay = await send(app, "demo-session-key-0001");
    assert.equal(replay.status, 200);
    assert.equal(calls.count, 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousGate === undefined) delete process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
    else process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER = previousGate;
    delete process.env[secretEnv];
  }
});

test("Concurrent unique requests never reserve more than the global 30-call quota", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  const calls = { count: 0 };
  try {
    const store = new MockStore();
    const app = testApp(store, provider(calls, false, 5));
    const responses = await Promise.all(Array.from({ length: 34 }, (_, index) =>
      send(app, `demo-session-key-${String(index).padStart(4, "0")}`),
    ));
    assert.equal(store.used, 30);
    assert.equal(calls.count, 30);
    assert.equal(responses.filter((response) => response.status === 200).length, 30);
    assert.equal(responses.filter((response) => response.status === 429).length, 4);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousGate === undefined) delete process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
    else process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER = previousGate;
    delete process.env[secretEnv];
  }
});

test("Provider failure consumes its reservation and same key cannot retry", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  const calls = { count: 0 };
  try {
    const store = new MockStore();
    const app = testApp(store, provider(calls, true));
    const first = await send(app, "demo-session-key-failure");
    const second = await send(app, "demo-session-key-failure");
    assert.equal(first.status, 502);
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "PREVIOUS_ATTEMPT_FAILED");
    assert.equal(store.used, 1);
    assert.equal(calls.count, 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousGate === undefined) delete process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
    else process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER = previousGate;
    delete process.env[secretEnv];
  }
});

test("Same idempotency key with a changed validated model is rejected", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  const calls = { count: 0 };
  try {
    const app = testApp(new MockStore(), provider(calls));
    const first = await send(app, "demo-session-key-conflict-01");
    const changedModel = createUniversalLayoutV2Model(DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY, {
      viewportClass: "compact",
      accessibility: {
        textScale: "large",
        buttonScale: "large",
        contrast: "high",
        viewportMode: { mode: "bottom", heightPercent: 70 },
      },
      layoutCapabilities: [],
      componentState: [{
        id: "menu.product-list",
        itemCount: 5,
        itemOrderHash: "af0c4a1b243d46755fc31fa279e936f612bf2b3914b293d67e585d6aa5fb091a",
      }],
    });
    const conflict = await send(app, "demo-session-key-conflict-01", changedModel);
    assert.equal(first.status, 200);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, "IDEMPOTENCY_KEY_CONFLICT");
    assert.equal(calls.count, 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousGate === undefined) delete process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
    else process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER = previousGate;
    delete process.env[secretEnv];
  }
});

test("Bad authentication and idempotency input are rejected before provider calls", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  const calls = { count: 0 };
  try {
    const app = testApp(new MockStore(), provider(calls));
    const unauthorized = await request(app).post(PRODUCTION_V2_ROUTE)
      .set("Idempotency-Key", "demo-session-key-0001")
      .send({ model });
    const invalidKey = await send(app, "short");
    assert.equal(unauthorized.status, 401);
    assert.equal(invalidKey.status, 400);
    assert.equal(calls.count, 0);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousGate === undefined) delete process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
    else process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER = previousGate;
    delete process.env[secretEnv];
  }
});
