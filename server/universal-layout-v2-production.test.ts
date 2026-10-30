import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import request from "supertest";
import { createApp } from "./app";
import {
  createUniversalLayoutV2Model,
  type UniversalLayoutV2Model,
  type UniversalLayoutV2Plan,
} from "./universal-layout-contract-v2";
import { universalSha256 } from "./universal-layout-contract";
import type { UniversalLayoutV2PlanProvider } from "./universal-layout-generator-v2";
import {
  PRODUCTION_V2_ROUTE,
  PRODUCTION_V2_REGISTRY,
  PRODUCTION_V2_MAX_CALLS,
  type ProductionV2Registration,
  type ProductionV2RequestStore,
  type ReserveResult,
} from "./universal-layout-v2-production";
import {
  CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY,
  DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY,
} from "./universal-v2-conformance-fixtures";

const hostId = DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY.hostId;
const screenId = DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY.screenId;
const secretEnv = "TEST_PRODUCTION_DEMO_AI_TOKEN";
const secretValue = "test-only-host-token-for-production-route";
const registration: ProductionV2Registration = {
  hostId,
  screenId,
  structureVersion: DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY.structureVersion,
  accessibility: {
    textScale: "large",
    buttonScale: "large",
    contrast: "high",
    viewportMode: { mode: "bottom", heightPercent: 70 },
  },
  viewportClasses: ["compact", "regular"],
  layoutCapabilities: [],
  component: {
    id: "menu.product-list",
    kind: "repeated-card-list",
    role: "ordered-menu-list",
    order: 0,
    itemCount: 5,
    itemOrderHash: "af0c4a1b243d46755fc31fa279e936f612bf2b3914b293d67e585d6aa5fb091a",
  },
  optionGroupId: "arrangement",
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
  maxCalls = PRODUCTION_V2_MAX_CALLS;
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

function provider(
  calls: { count: number },
  fail = false,
  delay = 0,
  optionId?: string,
): UniversalLayoutV2PlanProvider {
  return {
    async generate({ payload }) {
      calls.count += 1;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (fail) throw new Error("mock provider failure");
      const component = payload.components[0];
      const group = component.optionGroups![0];
      const selectedOptionId = optionId ??
        (payload.hostId.startsWith("civil") ? "reserved-safe-list" : "single-column-list");
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
          optionId: selectedOptionId,
        }],
      };
    },
  };
}

const civilPolicy = structuredClone(CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY);
civilPolicy.hostId = "civil-kiosk-policy-test";
civilPolicy.structureVersion = "civil.main-menu.policy-test";
const civilAccessibility = {
  textScale: "large",
  buttonScale: "standard",
  contrast: "high",
  viewportMode: null,
} as const;
const civilItemOrderHash = universalSha256({
  orderedItemIds: Array.from({ length: 18 }, (_, index) =>
    `civil.certificate.${String(index + 1).padStart(2, "0")}`),
});
const civilModel = createUniversalLayoutV2Model(civilPolicy, {
  viewportClass: "wide",
  accessibility: civilAccessibility,
  layoutCapabilities: ["reserved-bottom-controls"],
  componentState: [{
    id: "civil.certificate-grid",
    itemCount: 18,
    itemOrderHash: civilItemOrderHash,
  }],
});
const civilRegistration: ProductionV2Registration = {
  hostId: civilPolicy.hostId,
  screenId: civilPolicy.screenId,
  structureVersion: civilPolicy.structureVersion,
  accessibility: civilAccessibility,
  viewportClasses: ["wide"],
  layoutCapabilities: ["reserved-bottom-controls"],
  component: {
    id: "civil.certificate-grid",
    kind: "repeated-card-list",
    role: "certificate-choice-list",
    order: 0,
    itemCount: 18,
    itemOrderHash: civilItemOrderHash,
  },
  optionGroupId: "arrangement",
  optionId: "reserved-safe-list",
  policy: civilPolicy,
  authSecretEnv: secretEnv,
};

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

test("DemoCoffee and Civil registrations independently validate different test-only G profiles", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  const calls = { count: 0 };
  try {
    const app = testApp(new MockStore(), provider(calls), [registration, civilRegistration]);
    const demoResponse = await send(app, "demo-independent-g-0001", model);
    const civilResponse = await send(app, "civil-independent-g-0001", civilModel);
    assert.equal(demoResponse.status, 200);
    assert.equal(demoResponse.body.operations[0].optionId, "single-column-list");
    assert.equal(civilResponse.status, 200);
    assert.equal(civilResponse.body.operations[0].optionId, "reserved-safe-list");
    assert.equal(calls.count, 2);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousGate === undefined) delete process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
    else process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER = previousGate;
    delete process.env[secretEnv];
  }
});

test("Host-specific invalid profiles, viewports, capabilities, component data, options, and hashes fail before provider", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  const calls = { count: 0 };
  try {
    const store = new MockStore();
    const app = testApp(store, provider(calls));
    const wrongProfile = createUniversalLayoutV2Model(DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY, {
      viewportClass: "regular",
      accessibility: {
        textScale: "standard",
        buttonScale: "standard",
        contrast: "standard",
        viewportMode: null,
      },
      layoutCapabilities: [],
      componentState: [{
        id: "menu.product-list",
        itemCount: 5,
        itemOrderHash: registration.component.itemOrderHash,
      }],
    });
    const invalidHash = { ...model, structureHash: "0".repeat(64) };
    const invalidConstraintHash = { ...model, constraintHash: "0".repeat(64) };
    const invalidCapability = {
      ...model,
      layoutCapabilities: ["reserved-bottom-controls" as const],
    };
    const invalidComponentData = {
      ...model,
      components: [{ ...model.components[0], itemCount: 4 }],
    };

    const cases: Array<{
      name: string;
      reg?: ProductionV2Registration;
      body: UniversalLayoutV2Model;
    }> = [
      { name: "profile", body: wrongProfile },
      { name: "viewport", body: { ...model, viewportClass: "wide" } },
      { name: "capability", body: invalidCapability },
      { name: "component", body: invalidComponentData },
      { name: "structure-hash", body: invalidHash },
      { name: "constraint-hash", body: invalidConstraintHash },
      {
        name: "option",
        reg: {
          ...registration,
          accessibility: {
            textScale: "standard",
            buttonScale: "standard",
            contrast: "standard",
            viewportMode: null,
          },
          optionId: "single-column-list",
        },
        body: wrongProfile,
      },
    ];

    for (const [index, item] of cases.entries()) {
      const registrationForCase = item.reg ?? registration;
      const caseApp = item.reg
        ? testApp(store, provider(calls), [registrationForCase])
        : app;
      const response = await send(caseApp, `invalid-policy-case-${String(index).padStart(2, "0")}`, item.body);
      assert.equal(response.status, 403, item.name);
    }
    assert.equal(calls.count, 0);
    assert.equal(store.used, 0);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousGate === undefined) delete process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
    else process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER = previousGate;
    delete process.env[secretEnv];
  }
});

test("Civil host-specific invalid G, viewport, option, capability, component, and hashes fail closed", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  const calls = { count: 0 };
  try {
    const store = new MockStore();
    const app = testApp(store, provider(calls), [civilRegistration]);
    const wrongCivilProfile = createUniversalLayoutV2Model(civilPolicy, {
      viewportClass: "wide",
      accessibility: { ...civilAccessibility, buttonScale: "large" },
      layoutCapabilities: ["reserved-bottom-controls"],
      componentState: [{
        id: "civil.certificate-grid",
        itemCount: 18,
        itemOrderHash: civilItemOrderHash,
      }],
    });
    const wrongCivilViewport = createUniversalLayoutV2Model(civilPolicy, {
      viewportClass: "regular",
      accessibility: civilAccessibility,
      layoutCapabilities: ["reserved-bottom-controls"],
      componentState: [{
        id: "civil.certificate-grid",
        itemCount: 18,
        itemOrderHash: civilItemOrderHash,
      }],
    });
    const missingCivilCapability = createUniversalLayoutV2Model(civilPolicy, {
      viewportClass: "wide",
      accessibility: civilAccessibility,
      layoutCapabilities: [],
      componentState: [{
        id: "civil.certificate-grid",
        itemCount: 18,
        itemOrderHash: civilItemOrderHash,
      }],
    });
    const wrongCivilComponent = {
      ...civilModel,
      components: [{ ...civilModel.components[0], itemCount: 17 }],
    };
    const cases: Array<{
      name: string;
      reg?: ProductionV2Registration;
      body: UniversalLayoutV2Model;
    }> = [
      { name: "civil-profile", body: wrongCivilProfile },
      { name: "civil-viewport", body: wrongCivilViewport },
      { name: "civil-capability", body: missingCivilCapability },
      { name: "civil-component", body: wrongCivilComponent },
      { name: "civil-structure-hash", body: { ...civilModel, structureHash: "0".repeat(64) } },
      { name: "civil-constraint-hash", body: { ...civilModel, constraintHash: "0".repeat(64) } },
      {
        name: "civil-option",
        reg: { ...civilRegistration, optionId: "compact-grid" },
        body: civilModel,
      },
    ];

    for (const [index, item] of cases.entries()) {
      const caseApp = item.reg
        ? testApp(store, provider(calls), [item.reg])
        : app;
      const response = await send(caseApp, `civil-invalid-policy-${String(index).padStart(2, "0")}`, item.body);
      assert.equal(response.status, 403, item.name);
    }
    assert.equal(calls.count, 0);
    assert.equal(store.used, 0);
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

test("Production quota allows exactly 50 sequential calls and rejects the 51st", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  const calls = { count: 0 };
  try {
    const store = new MockStore();
    const app = testApp(store, provider(calls));
    const responses = [];
    for (let index = 0; index < PRODUCTION_V2_MAX_CALLS; index += 1) {
      responses.push(await send(app, `demo-quota-boundary-${String(index).padStart(4, "0")}`));
    }
    const rejected = await send(app, "demo-quota-boundary-0050");
    assert.equal(responses.length, 50);
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(rejected.status, 429);
    assert.equal(rejected.body.error, "AI_QUOTA_EXHAUSTED");
    assert.equal(store.used, 50);
    assert.equal(calls.count, 50);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousGate === undefined) delete process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
    else process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER = previousGate;
    delete process.env[secretEnv];
  }
});

test("Concurrent unique requests never reserve more than the global 50-call quota", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGate = process.env.UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER;
  const calls = { count: 0 };
  try {
    const store = new MockStore();
    const app = testApp(store, provider(calls, false, 5));
    const responses = await Promise.all(Array.from({ length: 51 }, (_, index) =>
      send(app, `demo-session-key-${String(index).padStart(4, "0")}`),
    ));
    assert.equal(store.used, 50);
    assert.equal(calls.count, 50);
    assert.equal(responses.filter((response) => response.status === 200).length, 50);
    assert.equal(responses.filter((response) => response.status === 429).length, 1);
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
