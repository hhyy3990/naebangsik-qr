import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  createUniversalLayoutV2SingleOptionPlanJsonSchema,
  generateUniversalLayoutV2Plan,
  UNIVERSAL_LAYOUT_V2_SINGLE_OPTION_SYSTEM_INSTRUCTION,
  UniversalLayoutV2GenerationError,
  type UniversalLayoutV2PlanProvider,
} from "./universal-layout-generator-v2";
import {
  parseUniversalLayoutV2Plan,
  universalLayoutV2ModelSchema,
  validateUniversalLayoutV2Model,
  validateUniversalLayoutV2Plan,
  UniversalLayoutV2ValidationError,
  type UniversalLayoutV2Model,
  type UniversalLayoutV2Accessibility,
  type UniversalLayoutV2Capability,
  type UniversalLayoutV2Plan,
  type UniversalLayoutV2Policy,
  type UniversalLayoutV2Viewport,
} from "./universal-layout-contract-v2";
import {
  createUniversalLayoutV2OpenAIProvider,
  type UniversalLayoutV2OpenAIDiagnostic,
} from "./universal-layout-v2-openai-provider";

export const PRODUCTION_V2_ROUTE = "/api/production/universal-layout/v2/openai-plan";
export const PRODUCTION_V2_PLAN_TTL_MS = 24 * 60 * 60 * 1000;
export const PRODUCTION_V2_MAX_CALLS = 50;

export type ProductionV2Registration = {
  hostId: string;
  screenId: string;
  structureVersion: string;
  accessibility: UniversalLayoutV2Accessibility;
  viewportClasses: readonly UniversalLayoutV2Viewport[];
  layoutCapabilities: readonly UniversalLayoutV2Capability[];
  component: {
    id: string;
    kind: string;
    role: string;
    order: number;
    itemCount: number;
    itemOrderHash: string;
  };
  optionGroupId: string;
  optionId: string;
  policy: UniversalLayoutV2Policy;
  authSecretEnv: string;
};

/**
 * Intentionally empty until production host source/runtime evidence is approved.
 * The Development registry and its snapshots are not production authority.
 */
export const PRODUCTION_V2_REGISTRY: readonly ProductionV2Registration[] = [];

export type ReserveResult =
  | { kind: "reserved" }
  | { kind: "replay"; plan: UniversalLayoutV2Plan }
  | { kind: "in_progress" }
  | { kind: "previous_failure" }
  | { kind: "key_conflict" }
  | { kind: "quota_exhausted" };

export interface ProductionV2RequestStore {
  reserve(input: {
    hostId: string;
    idempotencyKeyHash: string;
    requestFingerprint: string;
    now: Date;
  }): Promise<ReserveResult>;
  complete(input: {
    hostId: string;
    idempotencyKeyHash: string;
    plan: UniversalLayoutV2Plan;
  }): Promise<void>;
  fail(input: {
    hostId: string;
    idempotencyKeyHash: string;
  }): Promise<void>;
}

export class PostgresProductionV2RequestStore implements ProductionV2RequestStore {
  constructor(private readonly pool: Pool) {}

  async reserve(input: {
    hostId: string;
    idempotencyKeyHash: string;
    requestFingerprint: string;
    now: Date;
  }): Promise<ReserveResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Cleanup is scoped and opportunistic; expired plans are not retained indefinitely.
      await client.query(
        "DELETE FROM demo_ai_idempotency WHERE expires_at <= $1",
        [input.now],
      );
      const quota = await client.query<{ max_calls: number; reserved_calls: number }>(
        `SELECT max_calls, reserved_calls
         FROM demo_ai_quota
         WHERE id = 1
         FOR UPDATE`,
      );
      if (!quota.rows[0]) throw new Error("PRODUCTION_AI_QUOTA_NOT_INITIALIZED");

      const existing = await client.query<{
        request_fingerprint: string;
        status: "reserved" | "succeeded" | "failed";
        response_plan: unknown;
      }>(
        `SELECT request_fingerprint, status, response_plan
         FROM demo_ai_idempotency
         WHERE host_id = $1 AND idempotency_key_hash = $2`,
        [input.hostId, input.idempotencyKeyHash],
      );
      const record = existing.rows[0];
      if (record) {
        await client.query("COMMIT");
        if (record.request_fingerprint !== input.requestFingerprint) return { kind: "key_conflict" };
        if (record.status === "succeeded") {
          return { kind: "replay", plan: parseUniversalLayoutV2Plan(record.response_plan) };
        }
        return record.status === "reserved" ? { kind: "in_progress" } : { kind: "previous_failure" };
      }

      if (
        quota.rows[0].reserved_calls >=
        Math.min(quota.rows[0].max_calls, PRODUCTION_V2_MAX_CALLS)
      ) {
        await client.query("COMMIT");
        return { kind: "quota_exhausted" };
      }

      await client.query(
        `UPDATE demo_ai_quota
         SET reserved_calls = reserved_calls + 1, updated_at = now()
         WHERE id = 1`,
      );
      await client.query(
        `INSERT INTO demo_ai_idempotency
           (host_id, idempotency_key_hash, request_fingerprint, status, expires_at)
         VALUES ($1, $2, $3, 'reserved', $4)`,
        [
          input.hostId,
          input.idempotencyKeyHash,
          input.requestFingerprint,
          new Date(input.now.getTime() + PRODUCTION_V2_PLAN_TTL_MS),
        ],
      );
      await client.query("COMMIT");
      return { kind: "reserved" };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(input: {
    hostId: string;
    idempotencyKeyHash: string;
    plan: UniversalLayoutV2Plan;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE demo_ai_idempotency
       SET status = 'succeeded', response_plan = $3, updated_at = now()
       WHERE host_id = $1 AND idempotency_key_hash = $2 AND status = 'reserved'`,
      [input.hostId, input.idempotencyKeyHash, input.plan],
    );
    if (result.rowCount !== 1) throw new Error("PRODUCTION_AI_IDEMPOTENCY_STATE_LOST");
  }

  async fail(input: {
    hostId: string;
    idempotencyKeyHash: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE demo_ai_idempotency
       SET status = 'failed', updated_at = now()
       WHERE host_id = $1 AND idempotency_key_hash = $2 AND status = 'reserved'`,
      [input.hostId, input.idempotencyKeyHash],
    );
  }
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

const requestSchema = z.object({
  model: universalLayoutV2ModelSchema,
}).strict();

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function authorized(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function safeErrorCode(error: unknown): string {
  if (error instanceof UniversalLayoutV2GenerationError) return error.code;
  if (error instanceof UniversalLayoutV2ValidationError) return error.code;
  if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") return "AI_NOT_CONFIGURED";
  return "GENERATION_FAILED";
}

function accessibilityMatches(
  actual: UniversalLayoutV2Accessibility,
  expected: UniversalLayoutV2Accessibility,
): boolean {
  return actual.textScale === expected.textScale &&
    actual.buttonScale === expected.buttonScale &&
    actual.contrast === expected.contrast &&
    actual.viewportMode?.mode === expected.viewportMode?.mode &&
    actual.viewportMode?.heightPercent === expected.viewportMode?.heightPercent;
}

function sameValues<T extends string>(actual: readonly T[], expected: readonly T[]): boolean {
  return actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function logProductionV2(
  requestId: string,
  stage: string,
  outcome: string,
  fields: Record<string, string | number | boolean | undefined> = {},
): void {
  try {
    console.info(JSON.stringify({
      event: "universal_v2_production_diagnostic",
      requestId,
      stage,
      outcome,
      ...fields,
    }));
  } catch {
    // Diagnostics must not affect request behavior.
  }
}

export function registerProductionV2Route(
  app: Express,
  options: {
    store: ProductionV2RequestStore;
    provider?: UniversalLayoutV2PlanProvider;
    registry?: readonly ProductionV2Registration[];
  },
): void {
  const registry = options.registry ?? PRODUCTION_V2_REGISTRY;
  app.post(PRODUCTION_V2_ROUTE, async (req: Request, res: Response) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let openaiAttempted = false;
    const log = (stage: string, outcome: string, extra: Record<string, string | number | boolean> = {}) =>
      logProductionV2(requestId, stage, outcome, {
        elapsedMs: Date.now() - startedAt,
        openaiAttempted,
        ...extra,
      });

    res.setHeader("X-Request-ID", requestId);
    res.setHeader("Cache-Control", "no-store");
    log("request_received", "reached");

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      log("schema_rejected", "rejected", { errorCode: "INVALID_REQUEST", statusCode: 400 });
      return res.status(400).json({ error: "INVALID_REQUEST" });
    }
    const candidate = parsed.data.model;
    const registration = registry.find((entry) =>
      entry.hostId === candidate.hostId && entry.screenId === candidate.screenId,
    );
    if (!registration) {
      log("scope_rejected", "rejected", { errorCode: "PRODUCTION_HOST_UNVERIFIED", statusCode: 503 });
      return res.status(503).json({ error: "PRODUCTION_HOST_UNVERIFIED" });
    }

    let model: UniversalLayoutV2Model;
    try {
      if (candidate.structureVersion !== registration.structureVersion) {
        throw new Error("PRODUCTION_SCOPE_REJECTED");
      }
      if (
        !accessibilityMatches(candidate.accessibility, registration.accessibility) ||
        !registration.viewportClasses.includes(candidate.viewportClass) ||
        !sameValues(candidate.layoutCapabilities, registration.layoutCapabilities)
      ) {
        throw new Error("PRODUCTION_SCOPE_REJECTED");
      }
      model = validateUniversalLayoutV2Model(candidate, [registration.policy]);
      const component = model.components.find((item) => item.id === registration.component.id);
      if (
        model.components.length !== 1 ||
        !component ||
        component.kind !== registration.component.kind ||
        component.role !== registration.component.role ||
        component.order !== registration.component.order ||
        component.itemCount !== registration.component.itemCount ||
        component.itemOrderHash !== registration.component.itemOrderHash ||
        component.optionGroups?.length !== 1 ||
        component.optionGroups[0].id !== registration.optionGroupId ||
        component.optionGroups[0].optionIds.length !== 1 ||
        component.optionGroups[0].optionIds[0] !== registration.optionId
      ) {
        throw new Error("PRODUCTION_SCOPE_REJECTED");
      }
    } catch {
      log("scope_rejected", "rejected", { errorCode: "PRODUCTION_SCOPE_REJECTED", statusCode: 403 });
      return res.status(403).json({ error: "PRODUCTION_SCOPE_REJECTED" });
    }

    const expectedToken = process.env[registration.authSecretEnv];
    const suppliedToken = req.get("X-Host-AI-Token");
    if (!authorized(suppliedToken, expectedToken)) {
      log("auth_rejected", "rejected", { errorCode: "AUTH_REQUIRED", statusCode: 401 });
      return res.status(401).json({ error: "AUTH_REQUIRED" });
    }

    const key = req.get("Idempotency-Key") ?? "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
      log("idempotency_rejected", "rejected", { errorCode: "INVALID_IDEMPOTENCY_KEY", statusCode: 400 });
      return res.status(400).json({ error: "INVALID_IDEMPOTENCY_KEY" });
    }
    const keyHash = digest(`${registration.hostId}:${key}`);
    const requestFingerprint = digest(JSON.stringify(model));

    let provider: UniversalLayoutV2PlanProvider;
    try {
      provider = options.provider ?? createUniversalLayoutV2OpenAIProvider({
        model: process.env.UNIVERSAL_LAYOUT_PROD_OPENAI_MODEL?.trim() || "gpt-6-luna",
        onDiagnostic: (diagnostic: UniversalLayoutV2OpenAIDiagnostic) => {
          log("provider_diagnostic", "classified", {
            failureCategory: diagnostic.errorCategory,
            providerHttpStatus: diagnostic.httpStatus ?? 0,
            providerTimedOut: diagnostic.timeout,
          });
        },
      });
    } catch (error) {
      log("provider_unavailable", "rejected", { errorCode: safeErrorCode(error), statusCode: 503 });
      return res.status(503).json({ error: safeErrorCode(error) });
    }

    let reservation: ReserveResult;
    try {
      reservation = await options.store.reserve({
        hostId: registration.hostId,
        idempotencyKeyHash: keyHash,
        requestFingerprint,
        now: new Date(),
      });
    } catch {
      log("reservation_failed", "failed", { errorCode: "QUOTA_STORE_UNAVAILABLE", statusCode: 503 });
      return res.status(503).json({ error: "QUOTA_STORE_UNAVAILABLE" });
    }
    if (reservation.kind === "replay") {
      log("idempotency_replay", "completed", { statusCode: 200 });
      return res.status(200).json(reservation.plan);
    }
    if (reservation.kind !== "reserved") {
      const status = reservation.kind === "quota_exhausted" ? 429
        : reservation.kind === "in_progress" ? 409
          : reservation.kind === "key_conflict" ? 409 : 409;
      const error = reservation.kind === "quota_exhausted" ? "AI_QUOTA_EXHAUSTED"
        : reservation.kind === "in_progress" ? "REQUEST_IN_PROGRESS"
          : reservation.kind === "key_conflict" ? "IDEMPOTENCY_KEY_CONFLICT"
            : "PREVIOUS_ATTEMPT_FAILED";
      log("idempotency_rejected", "rejected", { errorCode: error, statusCode: status });
      return res.status(status).json({ error });
    }

    try {
      const group = model.components[0].optionGroups![0];
      openaiAttempted = true;
      log("provider_start", "started");
      const plan = await generateUniversalLayoutV2Plan({
        model,
        policies: [registration.policy],
        provider,
        responseSchema: createUniversalLayoutV2SingleOptionPlanJsonSchema(
          model,
          registration.component.id,
          registration.optionId,
        ),
        systemInstruction: UNIVERSAL_LAYOUT_V2_SINGLE_OPTION_SYSTEM_INSTRUCTION,
      });
      const validatedPlan = validateUniversalLayoutV2Plan(plan, model, [registration.policy]);
      if (
        validatedPlan.operations.length !== 1 ||
        validatedPlan.operations[0].type !== "selectLayoutOption" ||
        validatedPlan.operations[0].targetId !== registration.component.id ||
        validatedPlan.operations[0].optionId !== registration.optionId ||
        validatedPlan.operations[0].groupId !== group.id
      ) {
        throw new Error("PRODUCTION_PLAN_SCOPE_REJECTED");
      }
      await options.store.complete({
        hostId: registration.hostId,
        idempotencyKeyHash: keyHash,
        plan: validatedPlan,
      });
      log("provider_success", "passed", { statusCode: 200 });
      return res.status(200).json(validatedPlan);
    } catch (error) {
      try {
        await options.store.fail({
          hostId: registration.hostId,
          idempotencyKeyHash: keyHash,
        });
      } catch {
        // The reservation already accounts for this provider attempt.
      }
      const errorCode = safeErrorCode(error);
      log("provider_failure", "failed", { errorCode, statusCode: 502 });
      return res.status(502).json({ error: errorCode });
    }
  });
}
