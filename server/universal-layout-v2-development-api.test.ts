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
import {
  CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY,
  DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY,
} from "./universal-v2-conformance-fixtures";

const route = "/api/dev/universal-layout/v2/fake-plan";
const token = "development-only-test-token";
const standardAccessibility: UniversalLayoutV2Accessibility = {
  textScale: "standard",
  buttonScale: "standard",
  contrast: "standard",
  viewportMode: null,
};

function makeDemoModel() {
  return createUniversalLayoutV2Model(DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY, {
    viewportClass: "regular",
    accessibility: standardAccessibility,
    layoutCapabilities: [],
    componentState: [{
      id: "menu.product-list",
      itemCount: 5,
      itemOrderHash: "af0c4a1b243d46755fc31fa279e936f612bf2b3914b293d67e585d6aa5fb091a",
    }],
  });
}

function makeCivilModel(withReservedControls = true) {
  const orderedItemIds = Array.from(
    { length: 18 },
    (_, index) => `civil.certificate.${String(index + 1).padStart(2, "0")}`,
  );
  return createUniversalLayoutV2Model(CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY, {
    viewportClass: "wide",
    accessibility: standardAccessibility,
    layoutCapabilities: withReservedControls ? ["reserved-bottom-controls"] : [],
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

async function captureInfo<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const previousInfo = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return { result: await run(), lines };
  } finally {
    console.info = previousInfo;
  }
}

function parseV2DiagnosticEvents(lines: string[]) {
  return lines
    .map((line) => JSON.parse(line) as {
      event: string;
      requestId: string;
      outcome: string;
      statusCode?: number;
    })
    .filter((entry) => entry.event.startsWith("universal_v2_fake_"));
}

test("v2 Development Fake API is opt-in, bearer-authenticated, and returns validated host options", async () => {
  const demo = makeDemoModel();
  const civil = makeCivilModel();
  assert.equal(demo.structureHash, "c4e004d4df6fd7f4b0084b0b83569667239cd81284519d46108ad5921dd5cc4e");
  assert.equal(civil.structureHash, "5ee50fd98eb1ba357232fbc21a39c78b1721925491635b9943a7027cab4eed0b");

  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_FAKE_API: undefined,
  }, async () => {
    const disabled = await request(createApp({} as Pool, undefined, { serviceToken: token }))
      .post(route).set("Authorization", `Bearer ${token}`).send({ model: demo });
    assert.equal(disabled.status, 404);
  });

  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_FAKE_API: "true",
  }, async () => {
    const app = createApp({} as Pool, undefined, { serviceToken: token });
    const unauthorized = await request(app).post(route).send({ model: demo });
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(unauthorized.body, { error: "AUTH_REQUIRED" });

    for (const [model, expectedOption] of [
      [demo, "compact-grid"],
      [civil, "reserved-safe-list"],
    ] as const) {
      const response = await request(app)
        .post(route)
        .set("Authorization", `Bearer ${token}`)
        .send({ model });
      assert.equal(response.status, 200);
      assert.match(response.headers["content-type"], /^application\/json\b/);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.body.hostId, model.hostId);
      assert.equal(response.body.structureHash, model.structureHash);
      assert.equal(response.body.constraintHash, model.constraintHash);
      assert.deepEqual(response.body.operations, [{
        type: "selectLayoutOption",
        targetId: model.components[0].id,
        groupId: "arrangement",
        optionId: expectedOption,
      }]);
    }
  });
});

test("v2 Development diagnostics correlate safe request stages without logging sensitive data", async () => {
  const model = makeDemoModel();

  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_FAKE_API: "true",
  }, async () => {
    const app = createApp({} as Pool, undefined, { serviceToken: token });
    const success = await captureInfo(() => request(app)
      .post(`${route}?private-query=must-not-be-logged`)
      .set("Authorization", `Bearer ${token}`)
      .send({ model }));
    assert.equal(success.result.status, 200);

    const successEvents = parseV2DiagnosticEvents(success.lines);
    assert.deepEqual(successEvents.map(({ event }) => event), [
      "universal_v2_fake_request_entered",
      "universal_v2_fake_authentication",
      "universal_v2_fake_model_schema_validation",
      "universal_v2_fake_registry_validation",
      "universal_v2_fake_plan_validation",
      "universal_v2_fake_response",
    ]);
    assert.equal(new Set(successEvents.map(({ requestId }) => requestId)).size, 1);
    assert.match(successEvents[0].requestId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(successEvents.map(({ outcome }) => outcome), [
      "reached",
      "passed",
      "passed",
      "passed",
      "passed",
      "completed",
    ]);
    assert.equal(successEvents.at(-1)?.statusCode, 200);

    const unauthorized = await captureInfo(() => request(app).post(route).send({ model }));
    assert.equal(unauthorized.result.status, 401);
    assert.deepEqual(
      parseV2DiagnosticEvents(unauthorized.lines).map(({ event, outcome }) => [event, outcome]),
      [
        ["universal_v2_fake_request_entered", "reached"],
        ["universal_v2_fake_authentication", "failed"],
        ["universal_v2_fake_response", "completed"],
      ],
    );
    assert.equal(parseV2DiagnosticEvents(unauthorized.lines).at(-1)?.statusCode, 401);

    const invalidModel = await captureInfo(() => request(app)
      .post(route)
      .set("Authorization", `Bearer ${token}`)
      .send({ model: { ...model, structureHash: "invalid-hash" } }));
    assert.equal(invalidModel.result.status, 400);
    assert.deepEqual(
      parseV2DiagnosticEvents(invalidModel.lines).map(({ event, outcome }) => [event, outcome]),
      [
        ["universal_v2_fake_request_entered", "reached"],
        ["universal_v2_fake_authentication", "passed"],
        ["universal_v2_fake_model_schema_validation", "failed"],
        ["universal_v2_fake_response", "completed"],
      ],
    );

    const unregisteredModel = { ...model, hostId: "unknown-host" };
    const registryRejected = await captureInfo(() => request(app)
      .post(route)
      .set("Authorization", `Bearer ${token}`)
      .send({ model: unregisteredModel }));
    assert.equal(registryRejected.result.status, 404);
    assert.deepEqual(
      parseV2DiagnosticEvents(registryRejected.lines).map(({ event, outcome }) => [event, outcome]),
      [
        ["universal_v2_fake_request_entered", "reached"],
        ["universal_v2_fake_authentication", "passed"],
        ["universal_v2_fake_model_schema_validation", "passed"],
        ["universal_v2_fake_registry_validation", "failed"],
        ["universal_v2_fake_response", "completed"],
      ],
    );

    const serializedLogs = success.lines.join("\n");
    for (const sensitiveValue of [
      token,
      "private-query=must-not-be-logged",
      model.hostId,
      model.structureHash,
      "compact-grid",
      JSON.stringify(model),
    ]) {
      assert.equal(serializedLogs.includes(sensitiveValue), false);
    }
    for (const entry of successEvents) {
      assert.deepEqual(Object.keys(entry).sort(), [
        "event",
        "outcome",
        "requestId",
        ...(entry.statusCode === undefined ? [] : ["statusCode"]),
      ].sort());
    }
  });
});

test("v2 Development Fake API rejects unregistered hosts, stale hashes, and capability-invalid plans", async () => {
  const demo = makeDemoModel();
  const civilWithoutReservedControls = makeCivilModel(false);

  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_V2_FAKE_API: "true",
  }, async () => {
    const app = createApp({} as Pool, undefined, { serviceToken: token });
    const auth = { Authorization: `Bearer ${token}` };

    const unknownHost = await request(app).post(route).set(auth).send({
      model: { ...demo, hostId: "unknown-host" },
    });
    assert.equal(unknownHost.status, 404);
    assert.deepEqual(unknownHost.body, { error: "UNREGISTERED_HOST_SCREEN" });

    const unknownStructureVersion = await request(app).post(route).set(auth).send({
      model: { ...demo, structureVersion: "menu.unregistered.v99" },
    });
    assert.equal(unknownStructureVersion.status, 404);
    assert.deepEqual(unknownStructureVersion.body, { error: "UNREGISTERED_STRUCTURE_VERSION" });

    const staleHash = await request(app).post(route).set(auth).send({
      model: { ...demo, structureHash: "0".repeat(64) },
    });
    assert.equal(staleHash.status, 400);

    const maliciousProvider = {
      async generate({ payload }: { payload: {
        schemaVersion: number;
        contractVersion: string;
        hostId: string;
        screenId: string;
        structureVersion: string;
        structureHash: string;
        constraintHash: string;
        viewportClass: "compact" | "regular" | "wide";
      } }) {
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
            targetId: "civil.certificate-grid",
            groupId: "arrangement",
            optionId: "reserved-safe-list",
          }],
        };
      },
    };
    const capabilityApp = createApp({} as Pool, undefined, {
      serviceToken: token,
      universalLayoutV2FakeProvider: maliciousProvider,
    });
    const capabilityViolation = await request(capabilityApp)
      .post(route).set(auth).send({ model: civilWithoutReservedControls });
    assert.equal(capabilityViolation.status, 502);
    assert.equal(capabilityViolation.body.error, "UNSUPPORTED_PLAN_OPERATION");
  });
});

test("v2 Development Fake API route is not registered in Production", async () => {
  await withEnvironment({
    NODE_ENV: "production",
    UNIVERSAL_LAYOUT_DEV_V2_FAKE_API: "true",
  }, async () => {
    const app = createApp({} as Pool, undefined, { serviceToken: token });
    const captured = await captureInfo(() => request(app)
      .post(route).set("Authorization", `Bearer ${token}`).send({ model: makeDemoModel() }));
    assert.equal(captured.result.status, 404);
    assert.deepEqual(parseV2DiagnosticEvents(captured.lines), []);
  });
});
