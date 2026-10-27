import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import request from "supertest";
import { createApp } from "./app";
import { createUniversalLayoutModel, universalSha256 } from "./universal-layout-contract";
import { computeLayoutStructureHash, type LayoutPolicy } from "./layout-plan";
import {
  CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY,
  DEMO_COFFEE_UNIVERSAL_MOCK_POLICY,
} from "./universal-layout-mock-policies";

const route = "/api/dev/universal-layout/plan";
const serviceToken = "development-test-service-token";
const legacyPolicy: LayoutPolicy = {
  hostAppId: "democoffee",
  screenId: "cafe.menu",
  modelVersion: "1",
  structureVersion: "legacy-mock.v1",
  elementIds: ["content", "menu-group", "menu-item", "qr-controls"],
  requiredElementIds: ["content", "menu-item", "qr-controls"],
  mutableTargetIds: ["menu-group"],
  immutableElementIds: ["qr-controls"],
  operations: [{ operation: "set_columns", targetIds: ["menu-group"], min: 1, max: 2 }],
};

function makeLegacyInput(viewport: "standard" | "compact") {
  const inputWithoutHash = {
    modelVersion: "1" as const,
    hostAppId: "democoffee",
    screenId: "cafe.menu",
    structureVersion: "legacy-mock.v1",
    viewport,
    availableArea: { widthBucket: "regular" as const, heightBucket: "regular" as const },
    elements: [
      { id: "content", role: "container" as const, groupId: null, order: 0, kind: "content" as const },
      { id: "menu-group", role: "container" as const, groupId: "content", order: 1, kind: "content" as const },
      { id: "menu-item", role: "item" as const, groupId: "menu-group", order: 2, kind: "content" as const },
      { id: "qr-controls", role: "fixed-control" as const, groupId: null, order: 3, kind: "fixed" as const },
    ],
    constraints: {
      textSize: "standard" as const,
      buttonSize: "standard" as const,
      contrast: "standard" as const,
      viewportMode: null,
    },
  };
  return { ...inputWithoutHash, structureHash: computeLayoutStructureHash(inputWithoutHash) };
}

function makeModel(policy: typeof DEMO_COFFEE_UNIVERSAL_MOCK_POLICY | typeof CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY) {
  return createUniversalLayoutModel(policy, {
    viewportClass: "regular",
    accessibility: {
      textScale: "standard",
      buttonScale: "standard",
      contrast: "standard",
      viewportMode: null,
    },
    componentState: policy.components.map((component) => ({
      id: component.id,
      itemCount: component.id === "civil.certificate-grid" ? 18 : 12,
      itemOrderHash: universalSha256({ mockOrder: component.id }),
    })),
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

test("Development Universal API is opt-in, authenticated, host-restricted, and never calls a real provider", async () => {
  await withEnvironment({ NODE_ENV: "development", UNIVERSAL_LAYOUT_DEV_MOCK_API: undefined }, async () => {
    const disabledApp = createApp({} as Pool, undefined, { serviceToken });
    const disabled = await request(disabledApp).post(route).send({ model: makeModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY) });
    assert.equal(disabled.status, 404);
  });

  await withEnvironment({ NODE_ENV: "development", UNIVERSAL_LAYOUT_DEV_MOCK_API: "true" }, async () => {
    const app = createApp({} as Pool, undefined, {
      serviceToken,
      policies: [legacyPolicy],
      maxRequestsPerHost: 1,
      planGenerator: async (input) => ({
        schemaVersion: 1,
        screenId: input.screenId,
        structureVersion: input.structureVersion,
        structureHash: input.structureHash,
        operations: [{ operation: "set_columns", targetId: "menu-group", value: 1 }],
        reasonCode: "balanced",
      }),
    });
    const menuModel = makeModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY);
    const civilModel = makeModel(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY);

    const bypassAttempt = await request(app)
      .post(route)
      .set("X-Test-Mode", "true")
      .set("project-protection-bypass", "true")
      .send({ model: menuModel });
    assert.equal(bypassAttempt.status, 401);

    for (const model of [menuModel, civilModel]) {
      const response = await request(app)
        .post(route)
        .set("Authorization", `Bearer ${serviceToken}`)
        .send({ model });
      assert.equal(response.status, 200);
      assert.equal(response.body.hostId, model.hostId);
      assert.equal(response.body.screenId, model.screenId);
      assert.equal(response.body.operations[0].type, "setColumns");
      assert.equal(response.body.operations[0].targetId, model.components[0].id);
      assert.equal(response.body.operations[0].columns, 1);
    }

    const unknownHost = await request(app)
      .post(route)
      .set("Authorization", `Bearer ${serviceToken}`)
      .send({ model: { ...menuModel, hostId: "unregistered-host" } });
    assert.equal(unknownHost.status, 404);

    const badHash = await request(app)
      .post(route)
      .set("Authorization", `Bearer ${serviceToken}`)
      .send({ model: { ...menuModel, structureHash: "0".repeat(64) } });
    assert.equal(badHash.status, 400);

    const extraField = await request(app)
      .post(route)
      .set("Authorization", `Bearer ${serviceToken}`)
      .send({ model: menuModel, unexpected: true });
    assert.equal(extraField.status, 400);

    // The Universal Mock request must not consume the legacy host-wide budget.
    const legacyFirst = await request(app)
      .post("/api/ai-layout/plan")
      .set("Authorization", `Bearer ${serviceToken}`)
      .send(makeLegacyInput("standard"));
    assert.equal(legacyFirst.status, 200);
    const legacySecond = await request(app)
      .post("/api/ai-layout/plan")
      .set("Authorization", `Bearer ${serviceToken}`)
      .send(makeLegacyInput("compact"));
    assert.equal(legacySecond.status, 429);
  });

  await withEnvironment({ NODE_ENV: "production", UNIVERSAL_LAYOUT_DEV_MOCK_API: "true" }, async () => {
    const productionApp = createApp({} as Pool, undefined, { serviceToken });
    const response = await request(productionApp)
      .post(route)
      .set("Authorization", `Bearer ${serviceToken}`)
      .send({ model: makeModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY) });
    assert.equal(response.status, 404);
  });
});

test("Development Universal API logs only safe arrival diagnostics for success and failures", async () => {
  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_MOCK_API: "true",
  }, async () => {
    const app = createApp({} as Pool, undefined, { serviceToken });
    const originalInfo = console.info;
    const lines: string[] = [];
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const model = makeModel(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY);
      const success = await request(app)
        .post(route)
        .query({ privateSentinel: "do-not-log-query" })
        .set("Authorization", `Bearer ${serviceToken}`)
        .send({ model });
      assert.equal(success.status, 200);

      const authFailure = await request(app)
        .post(route)
        .set("Authorization", "Bearer do-not-log-credential")
        .send({ model });
      assert.equal(authFailure.status, 401);

      const invalidEnvelope = await request(app)
        .post(route)
        .set("Authorization", `Bearer ${serviceToken}`)
        .send({ model, privateSentinel: "do-not-log-request-body" });
      assert.equal(invalidEnvelope.status, 400);

      const invalidJson = await request(app)
        .post(route)
        .set("Content-Type", "application/json")
        .send("{invalid-json");
      assert.equal(invalidJson.status, 400);

      const unrelatedApiPath = await request(app)
        .post("/api/not-the-universal-route")
        .send({});
      assert.equal(unrelatedApiPath.status, 404);
    } finally {
      console.info = originalInfo;
    }

    const records = lines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter((record): record is Record<string, unknown> =>
        record?.pathId === "universal_v1_express_entry" || record?.pathId === "universal_v1_plan",
      );
    const expressEntries = records.filter((record) => record.pathId === "universal_v1_express_entry");
    const routeEntries = records.filter((record) => record.pathId === "universal_v1_plan");
    assert.equal(expressEntries.length, 4);
    assert.equal(routeEntries.length, 3);
    assert.deepEqual(expressEntries.map((record) => record.statusCode), [200, 401, 400, 400]);
    assert.deepEqual(expressEntries.map((record) => record.errorCode), [
      "NONE",
      "AUTH_REQUIRED",
      "INVALID_REQUEST",
      "INVALID_JSON",
    ]);
    assert.deepEqual(routeEntries.map((record) => record.statusCode), [200, 401, 400]);
    assert.deepEqual(routeEntries.map((record) => record.errorCode), [
      "NONE",
      "AUTH_REQUIRED",
      "INVALID_REQUEST",
    ]);
    assert.deepEqual(
      expressEntries.slice(0, 3).map((record) => record.requestId),
      routeEntries.map((record) => record.requestId),
    );
    assert.equal(expressEntries[3].requestId === routeEntries[0].requestId, false);
    for (const record of records) {
      assert.match(String(record.requestId), /^[0-9a-f-]{36}$/);
      assert.equal(record.statusCode !== undefined, true);
      assert.equal(typeof record.errorCode, "string");
      if (record.pathId === "universal_v1_express_entry") {
        assert.deepEqual(Object.keys(record).sort(), [
          "errorCode",
          "expressReached",
          "pathId",
          "requestId",
          "statusCode",
        ]);
        assert.equal(record.expressReached, true);
      } else {
        assert.deepEqual(Object.keys(record).sort(), [
          "errorCode",
          "pathId",
          "requestId",
          "requestReached",
          "statusCode",
        ]);
        assert.equal(record.requestReached, true);
      }
    }
    assert.equal(lines.join("\n").includes("do-not-log-credential"), false);
    assert.equal(lines.join("\n").includes("do-not-log-request-body"), false);
    assert.equal(lines.join("\n").includes("do-not-log-query"), false);
  });
});

test("Universal arrival diagnostics require the enabled Development route and stay inactive in Production", async () => {
  await withEnvironment({
    NODE_ENV: "development",
    UNIVERSAL_LAYOUT_DEV_MOCK_API: undefined,
  }, async () => {
    const app = createApp({} as Pool, undefined, { serviceToken });
    const originalInfo = console.info;
    const lines: string[] = [];
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const response = await request(app)
        .post(route)
        .set("Authorization", `Bearer ${serviceToken}`)
        .send({ model: makeModel(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY) });
      assert.equal(response.status, 404);
    } finally {
      console.info = originalInfo;
    }
    assert.equal(lines.some((line) =>
      line.includes('"pathId":"universal_v1_plan"') ||
      line.includes('"pathId":"universal_v1_express_entry"'),
    ), false);
  });

  await withEnvironment({
    NODE_ENV: "production",
    UNIVERSAL_LAYOUT_DEV_MOCK_API: "true",
  }, async () => {
    const app = createApp({} as Pool, undefined, { serviceToken });
    const originalInfo = console.info;
    const lines: string[] = [];
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const response = await request(app)
        .post(route)
        .set("Authorization", `Bearer ${serviceToken}`)
        .send({ model: makeModel(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY) });
      assert.equal(response.status, 404);
    } finally {
      console.info = originalInfo;
    }
    assert.equal(lines.some((line) =>
      line.includes('"pathId":"universal_v1_plan"') ||
      line.includes('"pathId":"universal_v1_express_entry"'),
    ), false);
  });
});
