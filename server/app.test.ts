import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

  const changedPreferences = { ...preferences, voiceGuidance: true };
  const updated = await request(app)
    .patch(`/api/profiles/${created.id}`)
    .set({ ...testHeader, "X-Profile-Management-Key": created.managementKey })
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences: changedPreferences });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.preferences, changedPreferences);

  const rotated = await request(app)
    .post(`/api/profiles/${created.id}/rotate`)
    .set({ ...testHeader, "X-Profile-Management-Key": created.managementKey })
    .send({});
  assert.equal(rotated.status, 200);
  assert.equal(rotated.headers["cache-control"], "no-store");
  assert.notEqual(rotated.body.token, created.token);
  const oldQrUrl = buildPublicQrUrl("https://qr.example.test", created.token);
  const newQrUrl = buildPublicQrUrl("https://qr.example.test", rotated.body.token);
  assert.notEqual(newQrUrl, oldQrUrl);
  assert.notEqual(
    new URL(newQrUrl).searchParams.get("token"),
    new URL(oldQrUrl).searchParams.get("token"),
  );
  const storedTokenHash = await pool.query<{ token_hash: string }>(
    "SELECT token_hash FROM profiles WHERE id = $1 AND is_test = true",
    [created.id],
  );
  assert.equal(storedTokenHash.rowCount, 1);
  assert.equal(storedTokenHash.rows[0].token_hash, hashToken(rotated.body.token));
  assert.notEqual(storedTokenHash.rows[0].token_hash, hashToken(created.token));

  const oldToken = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: created.token });
  assert.equal(oldToken.status, 404);
  assert.equal(oldToken.headers["cache-control"], "no-store");

  const newToken = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: rotated.body.token });
  assert.equal(newToken.status, 200);
  assert.equal(newToken.headers["cache-control"], "no-store");

  const revoked = await request(app)
    .post(`/api/profiles/${created.id}/revoke`)
    .set({ ...testHeader, "X-Profile-Management-Key": created.managementKey })
    .send({});
  assert.equal(revoked.status, 200);

  const revokedToken = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: rotated.body.token });
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
