import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import request from "supertest";
import { createApp } from "./app";
import { PROFILE_SCHEMA_VERSION } from "../src/lib/profile";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 환경 변수가 필요합니다. API 테스트는 PostgreSQL을 사용합니다.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = createApp(pool);
const testHeader = { "X-Test-Mode": "true" };
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
  assert.notEqual(rotated.body.token, created.token);

  const oldToken = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: created.token });
  assert.equal(oldToken.status, 404);

  const newToken = await request(app)
    .post("/api/profiles/resolve")
    .set(testHeader)
    .send({ token: rotated.body.token });
  assert.equal(newToken.status, 200);

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
});
