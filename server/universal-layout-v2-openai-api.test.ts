import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import request from "supertest";
import { createApp } from "./app";
import { universalSha256 } from "./universal-layout-contract";
import {
  createUniversalLayoutV2Model,
  type UniversalLayoutV2Accessibility,
} from "./universal-layout-contract-v2";
import type { UniversalLayoutV2PlanProvider } from "./universal-layout-generator-v2";
import { UniversalLayoutV2OpenAIRequestGuard } from "./universal-layout-v2-openai-request-guard";
import {
  CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY,
  DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY,
} from "./universal-v2-conformance-fixtures";

const route = "/api/dev/universal-layout/v2/openai-plan";
const token = "v2-openai-development-test-token";
const standardAccessibility: UniversalLayoutV2Accessibility = {
  textScale: "standard",
  buttonScale: "standard",
  contrast: "standard",
  viewportMode: null,
};

function demoModel(viewportClass: "compact" | "regular" | "wide" = "regular") {
  return createUniversalLayoutV2Model(DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY, {
    viewportClass,
    accessibility: standardAccessibility,
    layoutCapabilities: [],
    componentState: [{
      id: "menu.product-list",
      itemCount: 5,
      itemOrderHash: "af0c4a1b243d46755fc31fa279e936f612bf2b3914b293d67e585d6aa5fb091a",
    }],
  });
}

function civilModel() {
  const orderedItemIds = Array.from(
    { length: 18 },
    (_, index) => `civil.certificate.${String(index + 1).padStart(2, "0")}`,
  );
  return createUniversalLayoutV2Model(CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY, {
    viewportClass: "wide",
    accessibility: standardAccessibility,
    layoutCapabilities: ["reserved-bottom-controls"],
    componentState: [{
      id: "civil.certificate-grid",
      itemCount: 18,
      itemOrderHash: universalSha256({ orderedItemIds }),
    }],
  });
}

async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function planProvider(counter: { calls: number }): UniversalLayoutV2PlanProvider {
  return {
    async generate({ payload }) {
      counter.calls += 1;
      const component = payload.components[0];
      const group = component.optionGroups?.[0];
      const optionId = group?.optionIds[0];
      if (!group || !optionId) throw new Error("TEST_NO_OPTION");
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
          optionId,
        }],
      };
    },
  };
}

function testApp(provider: UniversalLayoutV2PlanProvider, guard = new UniversalLayoutV2OpenAIRequestGuard()) {
  return createApp({} as Pool, undefined, {
    serviceToken: token,
    universalLayoutV2OpenAIProvider: provider,
    universalLayoutV2OpenAIRequestGuard: guard,
  });
}

test("v2 OpenAI route is independently Development-gated and returns scoped, validated plans", async () => {
  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_OPENAI_PROVIDER: "true",
    UNIVERSAL_LAYOUT_DEV_OPENAI_PROVIDER: undefined,
    UNIVERSAL_LAYOUT_DEV_MOCK_API: undefined,
    UNIVERSAL_LAYOUT_DEV_V2_FAKE_API: undefined,
  }, async () => {
    for (const model of [demoModel(), civilModel()]) {
      const calls = { calls: 0 };
      const response = await request(testApp(planProvider(calls)))
        .post(route)
        .set("Authorization", `Bearer ${token}`)
        .send({ model });
      assert.equal(response.status, 200);
      assert.match(response.headers["content-type"], /^application\/json\b/);
      assert.equal(response.body.hostId, model.hostId);
      assert.equal(response.body.structureHash, model.structureHash);
      assert.equal(response.body.constraintHash, model.constraintHash);
      assert.equal(response.body.operations[0].type, "selectLayoutOption");
      assert.equal(response.body.operations[0].targetId, model.components[0].id);
      assert.equal(response.body.operations[0].optionId, model.components[0].optionGroups?.[0].optionIds[0]);
      assert.equal(calls.calls, 1);
    }
  });
});

test("v2 OpenAI route rejects unsupported scope and stale models before provider invocation", async () => {
  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_OPENAI_PROVIDER: "true",
  }, async () => {
    const calls = { calls: 0 };
    const app = testApp(planProvider(calls));
    const auth = { Authorization: `Bearer ${token}` };
    const largeText = createUniversalLayoutV2Model(DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY, {
      viewportClass: "regular",
      accessibility: { ...standardAccessibility, textScale: "large" },
      layoutCapabilities: [],
      componentState: [{
        id: "menu.product-list",
        itemCount: 5,
        itemOrderHash: "af0c4a1b243d46755fc31fa279e936f612bf2b3914b293d67e585d6aa5fb091a",
      }],
    });
    const outOfScope = await request(app).post(route).set(auth).send({ model: largeText });
    assert.equal(outOfScope.status, 403);
    assert.equal(outOfScope.body.error, "V2_OPENAI_SCOPE_REJECTED");

    const unknownHost = await request(app).post(route).set(auth).send({
      model: { ...demoModel(), hostId: "unknown-host" },
    });
    assert.equal(unknownHost.status, 404);

    const unsupportedCapability = await request(app).post(route).set(auth).send({
      model: { ...demoModel(), layoutCapabilities: ["reserved-bottom-controls"] },
    });
    assert.equal(unsupportedCapability.status, 400);

    const stale = await request(app).post(route).set(auth).send({
      model: { ...demoModel(), structureHash: "0".repeat(64) },
    });
    assert.equal(stale.status, 400);
    assert.equal(calls.calls, 0);
  });
});

test("v2 OpenAI route coalesces identical requests, caches success, and limits process calls to one", async () => {
  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_OPENAI_PROVIDER: "true",
  }, async () => {
    const calls = { calls: 0 };
    const provider = planProvider(calls);
    const delayedProvider: UniversalLayoutV2PlanProvider = {
      async generate(input) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return provider.generate(input);
      },
    };
    const app = testApp(delayedProvider);
    const auth = { Authorization: `Bearer ${token}` };
    const model = demoModel();
    const [first, second] = await Promise.all([
      request(app).post(route).set(auth).send({ model }),
      request(app).post(route).set(auth).send({ model }),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls.calls, 1);

    const cached = await request(app).post(route).set(auth).send({ model });
    assert.equal(cached.status, 200);
    assert.equal(calls.calls, 1);

    const anotherFingerprint = await request(app).post(route).set(auth).send({
      model: demoModel("compact"),
    });
    assert.equal(anotherFingerprint.status, 429);
    assert.equal(anotherFingerprint.body.error, "V2_OPENAI_CALL_LIMIT_REACHED");
    assert.equal(calls.calls, 1);
  });
});

test("v2 OpenAI route consumes its only attempt on failure and does not repair or fall back", async () => {
  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_OPENAI_PROVIDER: "true",
  }, async () => {
    let calls = 0;
    const provider: UniversalLayoutV2PlanProvider = {
      async generate() {
        calls += 1;
        return { invalid: "not a v2 plan" };
      },
    };
    const app = testApp(provider);
    const auth = { Authorization: `Bearer ${token}` };
    const failed = await request(app).post(route).set(auth).send({ model: demoModel() });
    assert.equal(failed.status, 502);
    assert.equal(calls, 1);
    const retried = await request(app).post(route).set(auth).send({ model: demoModel() });
    assert.equal(retried.status, 429);
    assert.equal(calls, 1);
  });
});

test("v2 OpenAI route rejects a provider-selected option outside the registered model", async () => {
  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_OPENAI_PROVIDER: "true",
  }, async () => {
    let calls = 0;
    const provider: UniversalLayoutV2PlanProvider = {
      async generate({ payload }) {
        calls += 1;
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
            targetId: payload.components[0].id,
            groupId: "arrangement",
            optionId: "unregistered-option",
          }],
        };
      },
    };
    const response = await request(testApp(provider))
      .post(route)
      .set("Authorization", `Bearer ${token}`)
      .send({ model: demoModel() });
    assert.equal(response.status, 502);
    assert.equal(response.body.error, "UNSUPPORTED_OPTION_SELECTION");
    assert.equal(calls, 1);
  });
});

test("v2 OpenAI route maps timeout and provider network errors without retrying", async () => {
  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_OPENAI_PROVIDER: "true",
  }, async () => {
    for (const [name, expected] of [
      ["TimeoutError", "PROVIDER_TIMEOUT"],
      ["Error", "PROVIDER_FAILURE"],
    ]) {
      const provider: UniversalLayoutV2PlanProvider = {
        async generate() {
          const error = new Error("provider failure");
          error.name = name;
          throw error;
        },
      };
      const response = await request(testApp(provider))
        .post(route)
        .set("Authorization", `Bearer ${token}`)
        .send({ model: demoModel() });
      assert.equal(response.status, 502);
      assert.equal(response.body.error, expected);
    }
  });
});

test("v2 OpenAI route is absent when opted out or in Production", async () => {
  for (const [nodeEnv, optIn] of [
    ["development", "false"],
    ["production", "true"],
  ]) {
    await withEnvironment({
      NODE_ENV: nodeEnv,
      UNIVERSAL_LAYOUT_DEV_V2_OPENAI_PROVIDER: optIn,
    }, async () => {
      const calls = { calls: 0 };
      const response = await request(testApp(planProvider(calls)))
        .post(route)
        .set("Authorization", `Bearer ${token}`)
        .send({ model: demoModel() });
      assert.equal(response.status, 404);
      assert.equal(calls.calls, 0);
    });
  }
});

test("v2 OpenAI route requires Bearer authentication before validation or generation", async () => {
  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_OPENAI_PROVIDER: "true",
  }, async () => {
    const calls = { calls: 0 };
    const response = await request(testApp(planProvider(calls)))
      .post(route)
      .send({ model: demoModel() });
    assert.equal(response.status, 401);
    assert.equal(response.body.error, "AUTH_REQUIRED");
    assert.equal(calls.calls, 0);
  });
});
