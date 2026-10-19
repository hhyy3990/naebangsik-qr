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
  viewportMode: { mode: "bottom", heightPercent: 70 },
  smartGuide: true,
  guideDelaySeconds: 15,
  voiceGuidance: false,
  language: "ko",
  stepByStepGuidance: false,
  conciseGuidance: false,
  slowGuidance: false,
  scrollGuidance: false,
};

after(async () => {
  if (testProfileIds.length) {
    await pool.query("DELETE FROM profiles WHERE is_test = true AND id = ANY($1::uuid[])", [testProfileIds]);
  }
  await pool.end();
});

test("profile API creates v5 profiles and normalizes legacy settings without losing QR management", async () => {
  const oldFieldRequest = await request(app)
    .post("/api/profiles")
    .set(testHeader)
    .send({
      schemaVersion: PROFILE_SCHEMA_VERSION,
      preferences: { ...preferences, bottomControls: true },
    });
  assert.equal(oldFieldRequest.status, 400);
  const removedSettingRequest = await request(app)
    .post("/api/profiles")
    .set(testHeader)
    .send({
      schemaVersion: PROFILE_SCHEMA_VERSION,
      preferences: { ...preferences, simplifiedLayout: true },
    });
  assert.equal(removedSettingRequest.status, 400);
  const invalidLanguageRequest = await request(app)
    .post("/api/profiles")
    .set(testHeader)
    .send({
      schemaVersion: PROFILE_SCHEMA_VERSION,
      preferences: { ...preferences, language: "fr" },
    });
  assert.equal(invalidLanguageRequest.status, 400);
  const invalidScrollGuidance = await request(app)
    .post("/api/profiles")
    .set(testHeader)
    .send({
      schemaVersion: PROFILE_SCHEMA_VERSION,
      preferences: { ...preferences, scrollGuidance: "on" },
    });
  assert.equal(invalidScrollGuidance.status, 400);

  const { scrollGuidance: _scrollGuidance, ...preferencesWithoutScrollGuidance } = preferences;
  const omittedScrollGuidance = await request(app)
    .post("/api/profiles")
    .set(testHeader)
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences: preferencesWithoutScrollGuidance });
  assert.equal(omittedScrollGuidance.status, 201);
  testProfileIds.push(omittedScrollGuidance.body.id);
  assert.equal(omittedScrollGuidance.body.preferences.scrollGuidance, false);

  for (const invalidMode of [
    { mode: "bottom", heightPercent: 59 },
    { mode: "bottom", heightPercent: 65 },
    { mode: "bottom", heightPercent: 90 },
    { mode: "top", heightPercent: 70 },
  ]) {
    const invalidRequest = await request(app)
      .post("/api/profiles")
      .set(testHeader)
      .send({
        schemaVersion: PROFILE_SCHEMA_VERSION,
        preferences: { ...preferences, viewportMode: invalidMode },
      });
    assert.equal(invalidRequest.status, 400);
  }

  const createdResponse = await request(app)
    .post("/api/profiles")
    .set(testHeader)
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences });

  assert.equal(createdResponse.status, 201);
  const created = createdResponse.body as {
    id: string;
    token: string;
    managementKey: string;
    schemaVersion: number;
    preferences: typeof preferences;
  };
  testProfileIds.push(created.id);
  assert.equal(created.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.match(created.token, /^mqr_/);
  assert.match(created.managementKey, /^mqm_/);
  assert.deepEqual(created.preferences, preferences);

  await pool.query(
    `UPDATE profiles
     SET schema_version = 2,
     preferences = (preferences - 'viewportMode' - 'language' - 'stepByStepGuidance' - 'conciseGuidance' - 'slowGuidance' - 'scrollGuidance') || $1::jsonb
     WHERE id = $2 AND is_test = true`,
    [JSON.stringify({ bottomControls: true, simplifiedLayout: true }), created.id],
  );

  const resolved = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: created.token });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(resolved.headers["cache-control"], "no-store");
  assert.deepEqual(resolved.body.preferences, { ...preferences, viewportMode: null });
  assert.equal("bottomControls" in resolved.body.preferences, false);
  assert.equal("simplifiedLayout" in resolved.body.preferences, false);
  const storedLegacy = await pool.query<{ schema_version: number; bottom_controls: string | null }>(
    `SELECT schema_version, preferences->>'bottomControls' AS bottom_controls
     FROM profiles WHERE id = $1 AND is_test = true`,
    [created.id],
  );
  assert.equal(storedLegacy.rows[0].schema_version, 2);
  assert.equal(storedLegacy.rows[0].bottom_controls, "true");

  await pool.query(
    `UPDATE profiles
     SET schema_version = 3,
     preferences = (preferences - 'language' - 'stepByStepGuidance' - 'conciseGuidance' - 'slowGuidance' - 'scrollGuidance') || $1::jsonb
     WHERE id = $2 AND is_test = true`,
    [JSON.stringify({ viewportMode: preferences.viewportMode }), created.id],
  );
  const resolvedV3 = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: created.token });
  assert.equal(resolvedV3.status, 200);
  assert.deepEqual(resolvedV3.body.preferences, { ...preferences, language: "ko", stepByStepGuidance: false, conciseGuidance: false, slowGuidance: false });
  const unchangedV3 = await pool.query<{ schema_version: number; language: string | null }>(
    "SELECT schema_version, preferences->>'language' AS language FROM profiles WHERE id = $1 AND is_test = true",
    [created.id],
  );
  assert.equal(unchangedV3.rows[0].schema_version, 3);
  assert.equal(unchangedV3.rows[0].language, null);

  const managedLegacy = await request(app)
    .get(`/api/profiles/${created.id}/manage`)
    .set({ ...testHeader, "X-Profile-Management-Key": created.managementKey });
  assert.equal(managedLegacy.status, 200);
  assert.equal(managedLegacy.body.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.deepEqual(managedLegacy.body.preferences, { ...preferences, language: "ko", stepByStepGuidance: false, conciseGuidance: false, slowGuidance: false });
  assert.equal("bottomControls" in managedLegacy.body.preferences, false);
  assert.equal("simplifiedLayout" in managedLegacy.body.preferences, false);

  await pool.query(
    `UPDATE profiles SET schema_version = 1,
      preferences = (preferences - 'viewportMode' - 'scrollGuidance') || '{"bottomControls": true}'::jsonb
      WHERE id = $1 AND is_test = true`,
    [created.id],
  );
  const resolvedV1 = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: created.token });
  assert.equal(resolvedV1.status, 200);
  assert.equal(resolvedV1.body.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.deepEqual(resolvedV1.body.preferences, { ...preferences, viewportMode: null });

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

  const changedPreferences = {
    ...preferences,
    viewportMode: { mode: "bottom" as const, heightPercent: 60 as const },
    voiceGuidance: true,
    scrollGuidance: true,
  };
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
  assert.equal(updated.body.schemaVersion, PROFILE_SCHEMA_VERSION);
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

  const changedToEighty = {
    ...changedPreferences,
    viewportMode: { mode: "bottom" as const, heightPercent: 80 as const },
  };
  const eightyUpdate = await request(app)
    .patch(`/api/profiles/${created.id}`)
    .set({ ...testHeader, "X-Profile-Management-Key": created.managementKey })
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences: changedToEighty });
  assert.equal(eightyUpdate.status, 200);
  assert.deepEqual(eightyUpdate.body.preferences, changedToEighty);

  const disabledViewportMode = { ...changedToEighty, viewportMode: null };
  const disabledModeUpdate = await request(app)
    .patch(`/api/profiles/${created.id}`)
    .set({ ...testHeader, "X-Profile-Management-Key": created.managementKey })
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences: disabledViewportMode });
  assert.equal(disabledModeUpdate.status, 200);
  assert.equal(disabledModeUpdate.body.preferences.viewportMode, null);

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

test("all seven supported profile languages can be created, resolved, and edited", async () => {
  for (const language of ["ko", "zh", "vi", "en", "th", "uz", "ja"] as const) {
    const createdResponse = await request(app)
      .post("/api/profiles")
      .set(testHeader)
      .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences: { ...preferences, language } });
    assert.equal(createdResponse.status, 201);
    const created = createdResponse.body as {
      id: string;
      token: string;
      managementKey: string;
    };
    testProfileIds.push(created.id);

    const resolved = await request(app)
      .post("/api/profiles/resolve")
      .set(testHeader)
      .send({ token: created.token });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.preferences.language, language);

    const changed = { ...preferences, language, stepByStepGuidance: true, conciseGuidance: true, slowGuidance: true };
    const updated = await request(app)
      .patch(`/api/profiles/${created.id}`)
      .set({ ...testHeader, "X-Profile-Management-Key": created.managementKey })
      .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences: changed });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.preferences, changed);
  }
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
