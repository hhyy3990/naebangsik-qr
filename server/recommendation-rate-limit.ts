import type { Pool } from "pg";

export const RECOMMENDATION_RATE_LIMIT = 5;
export const RECOMMENDATION_RATE_WINDOW_MS = 10 * 60_000;

export interface RecommendationRateLimiter {
  allow(clientHash: string, now?: number): Promise<boolean>;
}

const reserveRequestSql = `
  INSERT INTO ai_recommendation_rate_limits
    (client_hash, window_started_at, request_count)
  VALUES ($1, now(), 1)
  ON CONFLICT (client_hash)
  DO UPDATE SET
    window_started_at = CASE
      WHEN ai_recommendation_rate_limits.window_started_at
        <= now() - INTERVAL '10 minutes'
      THEN now()
      ELSE ai_recommendation_rate_limits.window_started_at
    END,
    request_count = CASE
      WHEN ai_recommendation_rate_limits.window_started_at
        <= now() - INTERVAL '10 minutes'
      THEN 1
      ELSE ai_recommendation_rate_limits.request_count + 1
    END
  WHERE ai_recommendation_rate_limits.window_started_at
      <= now() - INTERVAL '10 minutes'
     OR ai_recommendation_rate_limits.request_count < $2
  RETURNING request_count
`;

const cleanupExpiredSql = `
  DELETE FROM ai_recommendation_rate_limits
  WHERE window_started_at < now() - INTERVAL '24 hours'
`;

const CLEANUP_INTERVAL_MS = 60 * 60_000;

export class PostgresRecommendationRateLimiter implements RecommendationRateLimiter {
  private nextCleanupAt = 0;

  constructor(private readonly pool: Pool) {}

  async allow(clientHash: string): Promise<boolean> {
    const result = await this.pool.query<{ request_count: number }>(
      reserveRequestSql,
      [clientHash, RECOMMENDATION_RATE_LIMIT],
    );
    const allowed = result.rows.length > 0;

    const cleanupCheckTime = Date.now();
    if (cleanupCheckTime >= this.nextCleanupAt) {
      this.nextCleanupAt = cleanupCheckTime + CLEANUP_INTERVAL_MS;
      void this.pool
        .query(cleanupExpiredSql)
        .catch(() => undefined);
    }

    return allowed;
  }
}
