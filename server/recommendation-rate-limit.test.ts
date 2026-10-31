import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  PostgresRecommendationRateLimiter,
  RECOMMENDATION_RATE_LIMIT,
  RECOMMENDATION_RATE_WINDOW_MS,
} from "./recommendation-rate-limit";

function makeAtomicMemoryPool() {
  const counters = new Map<string, { windowStartedAt: number; requestCount: number }>();
  const cleanupCutoffs: Date[] = [];
  let databaseNow = Date.parse("2026-10-31T12:00:00.000Z");
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("INSERT INTO ai_recommendation_rate_limits")) {
        assert.match(sql, /ON CONFLICT \(client_hash\)/);
        assert.match(sql, /request_count < \$2/);
        assert.match(sql, /now\(\) - INTERVAL '10 minutes'/);
        const [clientHash, limit] = values as [string, number];
        assert.match(clientHash, /^[a-f0-9]{64}$/);
        const current = counters.get(clientHash);
        if (!current || databaseNow - current.windowStartedAt >= RECOMMENDATION_RATE_WINDOW_MS) {
          counters.set(clientHash, { windowStartedAt: databaseNow, requestCount: 1 });
          return { rows: [{ request_count: 1 }], rowCount: 1 };
        }
        if (current.requestCount >= limit) return { rows: [], rowCount: 0 };
        current.requestCount += 1;
        return { rows: [{ request_count: current.requestCount }], rowCount: 1 };
      }

      if (sql.includes("DELETE FROM ai_recommendation_rate_limits")) {
        assert.match(sql, /now\(\) - INTERVAL '24 hours'/);
        cleanupCutoffs.push(new Date(databaseNow - 24 * 60 * 60_000));
        return { rows: [], rowCount: 0 };
      }

      throw new Error("Unexpected rate-limit SQL");
    },
  };

  return {
    pool: pool as unknown as Pool,
    counters,
    cleanupCutoffs,
    setDatabaseNow: (value: number) => { databaseNow = value; },
  };
}

test("shared recommendation limiter admits at most five concurrent calls per ten-minute window", async () => {
  const { pool, counters, cleanupCutoffs } = makeAtomicMemoryPool();
  const limiter = new PostgresRecommendationRateLimiter(pool);
  const clientHash = "a".repeat(64);
  const now = Date.parse("2026-10-31T12:00:00.000Z");

  const outcomes = await Promise.all(
    Array.from({ length: 24 }, () => limiter.allow(clientHash)),
  );

  assert.equal(outcomes.filter(Boolean).length, RECOMMENDATION_RATE_LIMIT);
  assert.equal(counters.get(clientHash)?.requestCount, RECOMMENDATION_RATE_LIMIT);
  assert.equal(cleanupCutoffs.length, 1);
  assert.equal(cleanupCutoffs[0].getTime(), now - 24 * 60 * 60_000);
});

test("shared recommendation limiter starts a new window after ten minutes", async () => {
  const { pool, setDatabaseNow } = makeAtomicMemoryPool();
  const limiter = new PostgresRecommendationRateLimiter(pool);
  const clientHash = "b".repeat(64);
  const firstWindow = Date.parse("2026-10-31T12:00:00.000Z");

  for (let i = 0; i < RECOMMENDATION_RATE_LIMIT; i += 1) {
    assert.equal(await limiter.allow(clientHash), true);
  }
  assert.equal(await limiter.allow(clientHash), false);
  setDatabaseNow(firstWindow + RECOMMENDATION_RATE_WINDOW_MS);
  assert.equal(await limiter.allow(clientHash), true);
});
