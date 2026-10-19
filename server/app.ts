import express, { type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import { PROFILE_SCHEMA_VERSION } from "../src/lib/profile";
import { PROFILE_LANGUAGES } from "../src/lib/profile";
import {
  recommendationInputSchema,
  recommendAccessibility,
  validateRecommendation,
  type RecommendationGenerator,
} from "./recommendation";

const legacyPreferenceFields = {
  textSize: z.enum(["standard", "large", "extraLarge"]),
  buttonSize: z.enum(["standard", "large"]),
  contrast: z.enum(["standard", "high"]),
  easyLanguage: z.boolean(),
  smartGuide: z.boolean(),
  guideDelaySeconds: z.union([z.literal(10), z.literal(15), z.literal(20)]),
  voiceGuidance: z.boolean(),
};

const preferenceFields = {
  ...legacyPreferenceFields,
  language: z.enum(PROFILE_LANGUAGES),
  stepByStepGuidance: z.boolean(),
  conciseGuidance: z.boolean(),
  slowGuidance: z.boolean(),
  scrollGuidance: z.boolean(),
};

const viewportModeSchema = z.union([
  z.null(),
  z.object({
    mode: z.literal("bottom"),
    heightPercent: z.union([z.literal(60), z.literal(70), z.literal(80)]),
  }).strict(),
]);

const preferencesSchema = z.object({
  ...preferenceFields,
  viewportMode: viewportModeSchema,
}).strict();
const legacyPreferencesSchema = z.object({
  ...legacyPreferenceFields,
  viewportMode: viewportModeSchema.optional(),
  language: z.enum(PROFILE_LANGUAGES).optional(),
  stepByStepGuidance: z.boolean().optional(),
  conciseGuidance: z.boolean().optional(),
  slowGuidance: z.boolean().optional(),
  scrollGuidance: z.boolean().optional(),
  bottomControls: z.boolean().optional(),
}).passthrough();

const requestPreferencesSchema = z.object({
  ...preferenceFields,
  viewportMode: viewportModeSchema,
  scrollGuidance: z.boolean().optional(),
}).strict();

const settingsPayloadSchema = z.object({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
  preferences: requestPreferencesSchema,
}).strict();

const tokenPayloadSchema = z.object({
  token: z.string().min(20).max(128),
}).strict();

const rotatePayloadSchema = z.object({
  expectedToken: z.string().min(20).max(128).optional(),
}).strict();

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const createToken = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;
const storedPreferences = (value: unknown) => {
  const current = preferencesSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = legacyPreferencesSchema.parse(value);
  return {
    textSize: legacy.textSize,
    buttonSize: legacy.buttonSize,
    contrast: legacy.contrast,
    easyLanguage: legacy.easyLanguage,
    viewportMode: legacy.viewportMode ?? null,
    smartGuide: legacy.smartGuide,
    guideDelaySeconds: legacy.guideDelaySeconds,
    voiceGuidance: legacy.voiceGuidance,
    language: legacy.language ?? "ko",
    stepByStepGuidance: legacy.stepByStepGuidance ?? false,
    conciseGuidance: legacy.conciseGuidance ?? false,
    slowGuidance: legacy.slowGuidance ?? false,
    scrollGuidance: legacy.scrollGuidance ?? false,
  };
};

const validManagementKey = (provided: string | undefined, storedHash: string) => {
  if (!provided) return false;
  const candidate = Buffer.from(hash(provided), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};

function normalizePublicAppUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isPreviewDomain =
      hostname === "replit.dev" ||
      hostname.endsWith(".replit.dev") ||
      hostname === "repl.co" ||
      hostname.endsWith(".repl.co");

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      isPreviewDomain
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

const fail = (res: Response, status: number, error: string) =>
  res.status(status).json({ error });

function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

export function createApp(
  pool: Pool,
  recommendationGenerator: RecommendationGenerator = recommendAccessibility,
) {
  const app = express();
  const recommendationAttempts = new Map<string, { count: number; resetAt: number }>();
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (!origin) return next();
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === req.get("host");
    } catch {
      return fail(res, 403, "허용되지 않은 연결 주소입니다.");
    }
    if (!sameOrigin && !allowedOrigins.has(origin)) {
      return fail(res, 403, "허용되지 않은 연결 주소입니다.");
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Profile-Management-Key, X-Test-Mode");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.param("id", (req, res, next, id) => {
    if (!z.string().uuid().safeParse(id).success) return fail(res, 400, "프로필 번호를 확인해 주세요.");
    next();
  });

  const isTestRequest = (req: Request) =>
    process.env.NODE_ENV !== "production" && req.get("X-Test-Mode") === "true";

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.get("/api/public-config", (_req, res) => {
    const isProduction = process.env.NODE_ENV === "production";
    const configuredUrl = isProduction ? process.env.PUBLIC_APP_URL?.trim() : "";
    res.setHeader("Cache-Control", "no-store");

    if (configuredUrl) {
      const publicAppUrl = normalizePublicAppUrl(configuredUrl);
      if (!publicAppUrl) {
        return fail(
          res,
          503,
          "공개 주소 설정을 확인할 수 없어 QR 링크를 준비하지 못했어요.",
        );
      }
      return res.json({ publicAppUrl, isPreview: false });
    }

    return res.json({ publicAppUrl: null, isPreview: !isProduction });
  });

  app.post("/api/recommendations", asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = recommendationInputSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "질문에 입력한 내용을 확인해 주세요.");
    let input;
    try {
      input = validateRecommendation(parsed.data);
    } catch (error) {
      if (error instanceof Error && error.message === "SENSITIVE_INPUT") {
        return fail(res, 400, "민감한 개인정보는 지우고 다시 요청해 주세요. 입력 내용은 AI로 보내지 않았어요.");
      }
      return fail(res, 400, "질문에 입력한 내용을 확인해 주세요.");
    }

    const now = Date.now();
    const clientKey = hash(req.ip || "unknown");
    const attempts = recommendationAttempts.get(clientKey);
    if (attempts && attempts.resetAt > now && attempts.count >= 5) {
      res.setHeader("Retry-After", "600");
      return fail(res, 429, "요청이 잠시 많아요. 잠시 후 다시 시도해 주세요.");
    }
    if (!attempts || attempts.resetAt <= now) {
      recommendationAttempts.set(clientKey, { count: 1, resetAt: now + 10 * 60_000 });
    } else {
      attempts.count += 1;
    }
    if (recommendationAttempts.size > 2_000) {
      for (const [key, value] of recommendationAttempts) {
        if (value.resetAt <= now) recommendationAttempts.delete(key);
      }
    }

    try {
      return res.json(await recommendationGenerator(input));
    } catch (error) {
      if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") {
        return fail(res, 503, "AI 추천을 준비 중이에요. 직접 설정하기를 이용해 주세요.");
      }
      return fail(res, 502, "추천을 만들지 못했어요. 다시 시도하거나 직접 설정해 주세요.");
    }
  }));

  app.post("/api/profiles", asyncRoute(async (req, res) => {
    const parsed = settingsPayloadSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "접근성 설정을 확인해 주세요.");
    const preferences = { ...parsed.data.preferences, scrollGuidance: parsed.data.preferences.scrollGuidance ?? false };

    const token = createToken("mqr_");
    const managementKey = createToken("mqm_");
    const id = randomUUID();
    const isTest = isTestRequest(req);
    const result = await pool.query(
      `INSERT INTO profiles (id, schema_version, preferences, token_hash, management_key_hash, is_test)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       RETURNING id, created_at`,
      [
        id,
        PROFILE_SCHEMA_VERSION,
        JSON.stringify(preferences),
        hash(token),
        hash(managementKey),
        isTest,
      ],
    );

    return res.status(201).json({
      id: result.rows[0].id,
      token,
      managementKey,
      schemaVersion: PROFILE_SCHEMA_VERSION,
      preferences,
      createdAt: new Date(result.rows[0].created_at).toISOString(),
    });
  }));

  app.post("/api/profiles/resolve", asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = tokenPayloadSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "QR 코드 정보를 확인할 수 없습니다.");
    const result = await pool.query(
      `SELECT schema_version, preferences, updated_at
       FROM profiles
       WHERE token_hash = $1 AND revoked_at IS NULL AND is_test = $2`,
      [hash(parsed.data.token), isTestRequest(req)],
    );
    if (!result.rowCount) return fail(res, 404, "사용할 수 없는 QR 코드입니다.");
    return res.json({
      schemaVersion: PROFILE_SCHEMA_VERSION,
      preferences: storedPreferences(result.rows[0].preferences),
      updatedAt: new Date(result.rows[0].updated_at).toISOString(),
    });
  }));

  app.get("/api/profiles/:id/manage", asyncRoute(async (req, res) => {
    const result = await pool.query(
      `SELECT id, schema_version, preferences, updated_at, revoked_at, management_key_hash
       FROM profiles WHERE id = $1 AND is_test = $2`,
      [req.params.id, isTestRequest(req)],
    );
    const profile = result.rows[0];
    if (!profile) return fail(res, 404, "프로필을 찾을 수 없습니다.");
    if (!validManagementKey(req.get("X-Profile-Management-Key"), profile.management_key_hash)) {
      return fail(res, 403, "관리 코드가 올바르지 않습니다.");
    }
    return res.json({
      id: profile.id,
      schemaVersion: PROFILE_SCHEMA_VERSION,
      preferences: storedPreferences(profile.preferences),
      active: !profile.revoked_at,
      updatedAt: new Date(profile.updated_at).toISOString(),
    });
  }));

  app.patch("/api/profiles/:id", asyncRoute(async (req, res) => {
    const parsed = settingsPayloadSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "접근성 설정을 확인해 주세요.");
    const preferences = { ...parsed.data.preferences, scrollGuidance: parsed.data.preferences.scrollGuidance ?? false };
    const existing = await pool.query(
      `SELECT management_key_hash FROM profiles WHERE id = $1 AND is_test = $2`,
      [req.params.id, isTestRequest(req)],
    );
    const profile = existing.rows[0];
    if (!profile) return fail(res, 404, "프로필을 찾을 수 없습니다.");
    if (!validManagementKey(req.get("X-Profile-Management-Key"), profile.management_key_hash)) {
      return fail(res, 403, "관리 코드가 올바르지 않습니다.");
    }
    const result = await pool.query(
      `UPDATE profiles SET preferences = $1::jsonb, schema_version = $4, updated_at = now()
       WHERE id = $2 AND is_test = $3
       RETURNING id, schema_version, preferences, updated_at, revoked_at`,
      [JSON.stringify(preferences), req.params.id, isTestRequest(req), PROFILE_SCHEMA_VERSION],
    );
    const updated = result.rows[0];
    return res.json({
      id: updated.id,
      schemaVersion: updated.schema_version,
      preferences: storedPreferences(updated.preferences),
      active: !updated.revoked_at,
      updatedAt: new Date(updated.updated_at).toISOString(),
    });
  }));

  app.post("/api/profiles/:id/revoke", asyncRoute(async (req, res) => {
    const existing = await pool.query(
      `SELECT management_key_hash FROM profiles WHERE id = $1 AND is_test = $2`,
      [req.params.id, isTestRequest(req)],
    );
    const profile = existing.rows[0];
    if (!profile) return fail(res, 404, "프로필을 찾을 수 없습니다.");
    if (!validManagementKey(req.get("X-Profile-Management-Key"), profile.management_key_hash)) {
      return fail(res, 403, "관리 코드가 올바르지 않습니다.");
    }
    await pool.query(
      `UPDATE profiles SET token_hash = NULL, revoked_at = now(), updated_at = now()
       WHERE id = $1 AND is_test = $2`,
      [req.params.id, isTestRequest(req)],
    );
    return res.json({ success: true });
  }));

  app.post("/api/profiles/:id/rotate", asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const parsed = rotatePayloadSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, 400, "QR 정보를 확인해 주세요.");

    const testMode = isTestRequest(req);
    const client = await pool.connect();
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const existing = await client.query(
        `SELECT management_key_hash, token_hash
         FROM profiles
         WHERE id = $1 AND is_test = $2
         FOR UPDATE`,
        [req.params.id, testMode],
      );
      const profile = existing.rows[0];
      if (!profile) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return fail(res, 404, "프로필을 찾을 수 없습니다.");
      }
      if (!validManagementKey(req.get("X-Profile-Management-Key"), profile.management_key_hash)) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return fail(res, 403, "관리 코드가 올바르지 않습니다.");
      }
      if (
        parsed.data.expectedToken &&
        profile.token_hash !== hash(parsed.data.expectedToken)
      ) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return fail(res, 409, "QR이 이미 바뀌었어요. 최신 QR을 확인한 뒤 다시 시도해 주세요.");
      }

      const token = createToken("mqr_");
      const updated = await client.query(
        `UPDATE profiles SET token_hash = $1, revoked_at = NULL, updated_at = now()
         WHERE id = $2 AND is_test = $3
         RETURNING id`,
        [hash(token), req.params.id, testMode],
      );
      if (!updated.rowCount) throw new Error("QR profile was not updated");

      await client.query("COMMIT");
      transactionOpen = false;
      return res.json({ token });
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original failure; the client will release the transaction connection.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }));

  app.use("/api", (_req, res) => fail(res, 404, "요청한 기능을 찾을 수 없습니다."));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("API request failed:", error);
    return fail(res, 500, "서버에서 요청을 처리하지 못했습니다.");
  });

  return app;
}
