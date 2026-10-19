import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "./app";
import { PROFILE_SCHEMA_VERSION, type ProfilePreferences } from "../src/lib/profile";

type MemoryProfile = {
  id: string;
  schema_version: number;
  preferences: Record<string, unknown>;
  token_hash: string;
  management_key_hash: string;
  revoked_at: Date | null;
  updated_at: Date;
};

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function makeMemoryPool() {
  const profiles = new Map<string, MemoryProfile>();
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("INSERT INTO profiles")) {
        const [id, schemaVersion, preferences, tokenHash, managementHash] = values as [string, number, string, string, string];
        profiles.set(id, {
          id,
          schema_version: schemaVersion,
          preferences: JSON.parse(preferences),
          token_hash: tokenHash,
          management_key_hash: managementHash,
          revoked_at: null,
          updated_at: new Date(),
        });
        return { rows: [{ id, created_at: new Date() }], rowCount: 1 };
      }
      if (sql.includes("WHERE token_hash = $1")) {
        const profile = [...profiles.values()].find((item) =>
          item.token_hash === values[0] && item.revoked_at === null,
        );
        return {
          rows: profile ? [{ schema_version: profile.schema_version, preferences: profile.preferences, updated_at: profile.updated_at }] : [],
          rowCount: profile ? 1 : 0,
        };
      }
      if (sql.startsWith("SELECT id, schema_version")) {
        const profile = profiles.get(String(values[0]));
        return { rows: profile ? [{ ...profile }] : [], rowCount: profile ? 1 : 0 };
      }
      if (sql.startsWith("SELECT management_key_hash")) {
        const profile = profiles.get(String(values[0]));
        return { rows: profile ? [{ management_key_hash: profile.management_key_hash }] : [], rowCount: profile ? 1 : 0 };
      }
      if (sql.startsWith("UPDATE profiles SET preferences")) {
        const profile = profiles.get(String(values[1]));
        if (!profile) return { rows: [], rowCount: 0 };
        profile.preferences = JSON.parse(String(values[0]));
        profile.schema_version = Number(values[3]);
        profile.updated_at = new Date();
        return {
          rows: [{ id: profile.id, schema_version: profile.schema_version, preferences: profile.preferences, updated_at: profile.updated_at, revoked_at: profile.revoked_at }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL in memory profile test: ${sql}`);
    },
  };
  return { pool: pool as unknown as Pool, profiles };
}

const preferences: ProfilePreferences = {
  textSize: "standard",
  buttonSize: "standard",
  contrast: "standard",
  easyLanguage: false,
  viewportMode: null,
  smartGuide: false,
  guideDelaySeconds: 15,
  voiceGuidance: false,
  language: "ko",
  stepByStepGuidance: false,
  conciseGuidance: false,
  slowGuidance: false,
  scrollGuidance: false,
};

test("v5 profile APIs default omitted scroll guidance off, preserve edits, and normalize old profiles", async () => {
  const { pool, profiles } = makeMemoryPool();
  const app = createApp(pool);
  const withoutFlag = { ...preferences };
  delete (withoutFlag as Partial<ProfilePreferences>).scrollGuidance;
  const createdResponse = await request(app)
    .post("/api/profiles")
    .set("X-Test-Mode", "true")
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences: withoutFlag });
  assert.equal(createdResponse.status, 201);
  assert.equal(createdResponse.body.preferences.scrollGuidance, false);
  const created = createdResponse.body as { id: string; token: string; managementKey: string };

  const invalid = await request(app)
    .patch(`/api/profiles/${created.id}`)
    .set({ "X-Test-Mode": "true", "X-Profile-Management-Key": created.managementKey })
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences: { ...preferences, scrollGuidance: "yes" } });
  assert.equal(invalid.status, 400);

  const enabled = { ...preferences, scrollGuidance: true };
  const update = await request(app)
    .patch(`/api/profiles/${created.id}`)
    .set({ "X-Test-Mode": "true", "X-Profile-Management-Key": created.managementKey })
    .send({ schemaVersion: PROFILE_SCHEMA_VERSION, preferences: enabled });
  assert.equal(update.status, 200);
  assert.equal(update.body.preferences.scrollGuidance, true);
  const resolved = await request(app)
    .post("/api/profiles/resolve")
    .set("X-Test-Mode", "true")
    .send({ token: created.token });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.preferences.scrollGuidance, true);
  const managed = await request(app)
    .get(`/api/profiles/${created.id}/manage`)
    .set({ "X-Test-Mode": "true", "X-Profile-Management-Key": created.managementKey });
  assert.equal(managed.status, 200);
  assert.equal(managed.body.preferences.scrollGuidance, true);

  const record = profiles.get(created.id)!;
  record.schema_version = 4;
  delete record.preferences.scrollGuidance;
  const legacyResolved = await request(app)
    .post("/api/profiles/resolve")
    .set("X-Test-Mode", "true")
    .send({ token: created.token });
  assert.equal(legacyResolved.status, 200);
  assert.equal(legacyResolved.body.preferences.scrollGuidance, false);
  assert.equal(record.schema_version, 4);
  assert.equal(record.preferences.scrollGuidance, undefined);
});
