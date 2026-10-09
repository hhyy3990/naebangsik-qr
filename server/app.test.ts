import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { createApp } from "./app";
import { buildPublicQrUrl, PROFILE_SCHEMA_VERSION } from "../src/lib/profile";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 환경 변수가 필요합니다. API 테스트는 PostgreSQL을 사용합니다.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = createApp(pool);
const testHeader = { "X-Test-Mode": "true" };
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const testProfileIds: string[] = [];
const preferences = {
  textSize: "large",
  buttonSize: "large",
  contrast: "high",
  easyLanguage: true,
  simplifiedLayout: true,
  bottomControls: false,
  smartGuide: true,
  guideDelaySeconds: 15,
  voiceGuidance: false,
};

after(async () => {
  if (testProfileIds.length) {
    await pool.query("DELETE FROM profiles WHERE is_test = true AND id = ANY($1::uuid[])", [testProfileIds]);
  }
  await pool.end();
});

test("profile API creates, resolves, edits, rotates, and revokes QR tokens", async () => {
  const createdResponse = await request(app)
    .post("/api/profiles")
    .set(testHeader)
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences });

  assert.equal(createdResponse.status, 201);
  const created = createdResponse.body as {
    id: string;
    token: string;
    managementKey: string;
    preferences: typeof preferences;
  };
  testProfileIds.push(created.id);
  assert.match(created.token, /^mqr_/);
  assert.match(created.managementKey, /^mqm_/);
  assert.deepEqual(created.preferences, preferences);

  const resolved = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: created.token });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.headers["cache-control"], "no-store");
  assert.deepEqual(resolved.body.preferences, preferences);

  const tokenCannotManage = await request(app)
    .patch(`/api/profiles/${created.id}`)
    .set(testHeader)
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences });
  assert.equal(tokenCannotManage.status, 403);

  const qrBaseUrl = "https://qr.example.test";
  const rotate = (expectedToken?: string) => {
    const requestBuilder = request(app)
      .post(`/api/profiles/${created.id}/rotate`)
      .set({ ...testHeader, "X-Profile-Management-Key": created.managementKey });
    return requestBuilder.send(expectedToken ? { expectedToken } : {});
  };
  const rotated = await rotate();
  assert.equal(rotated.status, 200);
  assert.equal(rotated.headers["cache-control"], "no-store");
  assert.notEqual(rotated.body.token, created.token);
  const qrAUrl = buildPublicQrUrl(qrBaseUrl, created.token);
  const qrBUrl = buildPublicQrUrl(qrBaseUrl, rotated.body.token);
  assert.notEqual(qrBUrl, qrAUrl);
  assert.notEqual(
    new URL(qrBUrl).searchParams.get("token"),
    new URL(qrAUrl).searchParams.get("token"),
  );
  const storedBHash = await pool.query<{ token_hash: string }>(
    "SELECT token_hash FROM profiles WHERE id = $1 AND is_test = true",
    [created.id],
  );
  assert.equal(storedBHash.rowCount, 1);
  assert.equal(storedBHash.rows[0].token_hash, hashToken(rotated.body.token));
  assert.notEqual(storedBHash.rows[0].token_hash, hashToken(created.token));

  const invalidatedA = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: created.token });
  assert.equal(invalidatedA.status, 404);
  assert.equal(invalidatedA.headers["cache-control"], "no-store");

  const newToken = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: rotated.body.token });
  assert.equal(newToken.status, 200);
  assert.equal(newToken.headers["cache-control"], "no-store");

  const staleRotation = await rotate(created.token);
  assert.equal(staleRotation.status, 409);
  assert.equal(staleRotation.headers["cache-control"], "no-store");
  const activeBAfterStaleRequest = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: rotated.body.token });
  assert.equal(activeBAfterStaleRequest.status, 200);

  const rotatedAgain = await rotate(rotated.body.token);
  assert.equal(rotatedAgain.status, 200);
  assert.notEqual(rotatedAgain.body.token, rotated.body.token);
  const qrCUrl = buildPublicQrUrl(qrBaseUrl, rotatedAgain.body.token);
  assert.notEqual(qrCUrl, qrBUrl);

  const invalidatedB = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: rotated.body.token });
  assert.equal(invalidatedB.status, 404);
  const activeC = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: rotatedAgain.body.token });
  assert.equal(activeC.status, 200);

  const concurrentRotations = await Promise.all([
    rotate(rotatedAgain.body.token),
    rotate(rotatedAgain.body.token),
  ]);
  assert.deepEqual(
    concurrentRotations.map((response) => response.status).sort(),
    [200, 409],
  );
  const successfulRotation = concurrentRotations.find((response) => response.status === 200);
  const conflictedRotation = concurrentRotations.find((response) => response.status === 409);
  assert.ok(successfulRotation);
  assert.ok(conflictedRotation);
  assert.equal(conflictedRotation.headers["cache-control"], "no-store");
  const qrAfterConcurrentRotation = buildPublicQrUrl(qrBaseUrl, successfulRotation.body.token);
  assert.notEqual(qrAfterConcurrentRotation, qrCUrl);

  const invalidatedC = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: rotatedAgain.body.token });
  assert.equal(invalidatedC.status, 404);
  const activeAfterConcurrentRotation = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: successfulRotation.body.token });
  assert.equal(activeAfterConcurrentRotation.status, 200);

  const changedPreferences = { ...preferences, voiceGuidance: true };
  const tokenHashBeforeSettingsUpdate = await pool.query<{ token_hash: string }>(
    "SELECT token_hash FROM profiles WHERE id = $1 AND is_test = true",
    [created.id],
  );
  const qrBeforeSettingsUpdate = buildPublicQrUrl(qrBaseUrl, successfulRotation.body.token);
  const updated = await request(app)
    .patch(`/api/profiles/${created.id}`)
    .set({ ...testHeader, "X-Profile-Management-Key": created.managementKey })
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences: changedPreferences });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.preferences, changedPreferences);
  const tokenHashAfterSettingsUpdate = await pool.query<{ token_hash: string }>(
    "SELECT token_hash FROM profiles WHERE id = $1 AND is_test = true",
    [created.id],
  );
  assert.equal(
    tokenHashAfterSettingsUpdate.rows[0].token_hash,
    tokenHashBeforeSettingsUpdate.rows[0].token_hash,
  );
  assert.equal(
    buildPublicQrUrl(qrBaseUrl, successfulRotation.body.token),
    qrBeforeSettingsUpdate,
  );
  const latestSettings = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: successfulRotation.body.token });
  assert.equal(latestSettings.status, 200);
  assert.deepEqual(latestSettings.body.preferences, changedPreferences);

  const revoked = await request(app)
    .post(`/api/profiles/${created.id}/revoke`)
    .set({ ...testHeader, "X-Profile-Management-Key": created.managementKey })
    .send({});
  assert.equal(revoked.status, 200);

  const revokedToken = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: successfulRotation.body.token });
  assert.equal(revokedToken.status, 404);
  assert.equal(revokedToken.headers["cache-control"], "no-store");
});

test("public QR configuration separates Preview from a configured published URL", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPublicAppUrl = process.env.PUBLIC_APP_URL;

  try {
    process.env.NODE_ENV = "test";
    process.env.PUBLIC_APP_URL = "https://ignored.example";
    const preview = await request(app).get("/api/public-config");
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body, { publicAppUrl: null, isPreview: true });

    process.env.NODE_ENV = "production";
    process.env.PUBLIC_APP_URL = "https://qr.example.com/";
    const published = await request(app).get("/api/public-config");
    assert.equal(published.status, 200);
    assert.deepEqual(published.body, { publicAppUrl: "https://qr.example.com", isPreview: false });

    process.env.PUBLIC_APP_URL = "https://preview.replit.dev";
    const previewDomainInProduction = await request(app).get("/api/public-config");
    assert.equal(previewDomainInProduction.status, 503);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicAppUrl;
  }
});

test("rotation database failure rolls back and preserves the active QR", async () => {
  const currentToken = `mqr_${randomBytes(32).toString("base64url")}`;
  const managementKey = `mqm_${randomBytes(32).toString("base64url")}`;
  const profileId = "00000000-0000-4000-8000-000000000001";
  const originalTokenHash = hashToken(currentToken);
  const profile = {
    management_key_hash: hashToken(managementKey),
    token_hash: originalTokenHash,
  };
  let rollbackCalled = false;
  let releaseCalled = false;

  const client = {
    async query(sql: string) {
      if (sql === "BEGIN" || sql === "ROLLBACK") {
        if (sql === "ROLLBACK") rollbackCalled = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FOR UPDATE")) {
        return { rows: [{ ...profile }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE profiles")) {
        throw new Error("simulated database update failure");
      }
      throw new Error("unexpected client query");
    },
    release() {
      releaseCalled = true;
    },
  };
  const failingPool = {
    connect: async () => client,
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("WHERE token_hash = $1")) {
        if (values[0] !== profile.token_hash) return { rows: [], rowCount: 0 };
        return {
          rows: [{ schema_version: PROFILE_SCHEMA_VERSION, preferences, updated_at: new Date() }],
          rowCount: 1,
        };
      }
      throw new Error("unexpected pool query");
    },
  } as unknown as Pool;
  const failingApp = createApp(failingPool);
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const failedRotation = await request(failingApp)
      .post(`/api/profiles/${profileId}/rotate`)
      .set({ ...testHeader, "X-Profile-Management-Key": managementKey })
      .send({ expectedToken: currentToken });
    assert.equal(failedRotation.status, 500);
    assert.equal(failedRotation.headers["cache-control"], "no-store");
    assert.equal(profile.token_hash, originalTokenHash);
    assert.equal(rollbackCalled, true);
    assert.equal(releaseCalled, true);

    const stillActive = await request(failingApp)
      .post("/api/profiles/resolve")
      .set(testHeader)
      .send({ token: currentToken });
    assert.equal(stillActive.status, 200);
  } finally {
    console.error = originalConsoleError;
  }
});
