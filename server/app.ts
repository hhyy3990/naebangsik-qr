import express, { type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type OpenAI from "openai";
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
import {
  validateLayoutPlanRequest,
  type LayoutPolicy,
  type LayoutPlanGenerator,
  type LayoutPlanRequest,
} from "./layout-plan";
import { generateLayoutPlan } from "./ai-layout";
import {
  validateDemoMenuModel,
  validateDemoMenuPlan,
  generateDemoMenuPlan,
  type DemoMenuModel,
  type DemoMenuPlan,
} from "./demo-menu-layout";
import {
  generateDemoOptionsPlan,
  validateDemoOptionsModel,
  validateDemoOptionsPlan,
  type DemoOptionsModel,
  type DemoOptionsPlan,
} from "./demo-options-layout";
import { registeredDemoMenuPolicies, registeredDemoOptionsPolicies } from "./layout-policies";
import {
  generateUniversalLayoutPlan,
  type UniversalLayoutPlanProvider,
} from "./universal-layout-generator";
import { UNIVERSAL_LAYOUT_MOCK_POLICIES } from "./universal-layout-mock-policies";
import { universalLayoutDevelopmentMockProvider, universalLayoutDevelopmentRequestSchema } from "./universal-layout-development-mock";
import { createUniversalLayoutOpenAIProvider } from "./universal-layout-openai-provider";
import {
  createUniversalLayoutV2SingleOptionPlanJsonSchema,
  generateUniversalLayoutV2Plan,
  UNIVERSAL_LAYOUT_V2_SINGLE_OPTION_SYSTEM_INSTRUCTION,
  UniversalLayoutV2GenerationError,
  type UniversalLayoutV2PlanProvider,
} from "./universal-layout-generator-v2";
import {
  createUniversalLayoutV2OpenAIProvider,
  type UniversalLayoutV2OpenAIDiagnostic,
} from "./universal-layout-v2-openai-provider";
import {
  UniversalLayoutV2OpenAIScopeError,
  validateUniversalLayoutV2OpenAIScope,
} from "./universal-layout-v2-openai-scope";
import {
  UniversalLayoutV2OpenAIRequestGuard,
  universalLayoutV2ModelFingerprint,
  universalLayoutV2OpenAIProcessGuard,
} from "./universal-layout-v2-openai-request-guard";
import {
  resolveDevelopmentUniversalLayoutV2Registration,
  validateDevelopmentUniversalLayoutV2Model,
  validateDevelopmentUniversalLayoutV2Plan,
  DevelopmentUniversalLayoutV2RegistryError,
} from "./universal-layout-v2-development-registry";
import {
  UniversalLayoutV2ValidationError,
  universalLayoutV2ModelSchema,
} from "./universal-layout-contract-v2";
import { universalLayoutV2DevelopmentFakeProvider } from "./universal-layout-v2-development-fake-provider";

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

type UniversalV2FakeDiagnosticStage =
  | "request_entered"
  | "authentication"
  | "model_schema_validation"
  | "registry_validation"
  | "plan_validation"
  | "response";

function logUniversalV2FakeDiagnostic(
  requestId: string,
  stage: UniversalV2FakeDiagnosticStage,
  outcome: "reached" | "passed" | "failed" | "completed",
  statusCode?: number,
): void {
  if (process.env.NODE_ENV !== "development") return;
  try {
    console.info(JSON.stringify({
      event: `universal_v2_fake_${stage}`,
      requestId,
      outcome,
      ...(statusCode === undefined ? {} : { statusCode }),
    }));
  } catch {
    // Diagnostics must never change request processing.
  }
}

function logUniversalV2OpenAIDiagnostic(
  requestId: string,
  stage: string,
  outcome: string,
  fields: {
    statusCode?: number;
    openaiAttempted?: boolean;
    providerDiagnostic?: UniversalLayoutV2OpenAIDiagnostic;
    failureStage?: string;
  } = {},
): void {
  if (process.env.NODE_ENV !== "development") return;
  try {
    console.info(JSON.stringify({
      event: `universal_v2_openai_${stage}`,
      requestId,
      outcome,
      ...fields,
    }));
  } catch {
    // Diagnostics must never change request processing.
  }
}

type UniversalDevDiagnosticErrorCode =
  | "NONE"
  | "SERVICE_NOT_CONFIGURED"
  | "AUTH_REQUIRED"
  | "INVALID_REQUEST"
  | "INVALID_JSON"
  | "BODY_TOO_LARGE"
  | "REQUEST_REJECTED"
  | "UNEXPECTED_ERROR"
  | "UNREGISTERED_SCREEN"
  | "INVALID_MODEL"
  | "GENERATION_FAILED";

type UniversalDevDiagnosticState = {
  requestId: string;
  setErrorCode: (errorCode: UniversalDevDiagnosticErrorCode) => void;
};

function universalDevDiagnosticState(response: Response): UniversalDevDiagnosticState | undefined {
  return response.locals.universalDevDiagnosticState as UniversalDevDiagnosticState | undefined;
}

function logUniversalDevExpressEntry(
  requestId: string,
  response: Response,
  getErrorCode: () => UniversalDevDiagnosticErrorCode,
) {
  response.once("finish", () => {
    console.info(JSON.stringify({
      requestId,
      expressReached: true,
      pathId: "universal_v1_express_entry",
      statusCode: response.statusCode,
      errorCode: getErrorCode(),
    }));
  });
}

function logUniversalDevRequest(
  requestId: string,
  response: Response,
  getErrorCode: () => UniversalDevDiagnosticErrorCode,
) {
  response.once("finish", () => {
    console.info(JSON.stringify({
      requestId,
      requestReached: true,
      pathId: "universal_v1_plan",
      statusCode: response.statusCode,
      errorCode: getErrorCode(),
    }));
  });
}

type AiLayoutDiagnosticFields = {
  outcome?: "passed" | "failed" | "started" | "completed" | "rejected";
  statusCode?: number;
  errorCode?: string;
  openaiAttempted?: boolean;
  timedOut?: boolean;
};

function logAiLayoutDiagnostic(
  requestId: string,
  stage: string,
  fields: AiLayoutDiagnosticFields = {},
) {
  console.info(JSON.stringify({ event: "ai_layout_diagnostic", requestId, stage, ...fields }));
}

function safeAiLayoutErrorCode(error: unknown, stage?: string): string {
  if (!(error instanceof Error)) return "UNKNOWN_ERROR";
  if (error.name === "ZodError") return "INVALID_SCHEMA";
  if (error instanceof SyntaxError) return "INVALID_JSON";
  if (/timeout/i.test(error.name)) return "OPENAI_TIMEOUT";
  if (stage === "openai_request") return "OPENAI_PROVIDER_ERROR";
  const allowedCodes = new Set([
    "AI_NOT_CONFIGURED",
    "EMPTY_AI_LAYOUT_RESPONSE",
    "UNSUPPORTED_SCREEN",
    "STRUCTURE_HASH_MISMATCH",
    "CONSTRAINT_HASH_MISMATCH",
    "UNSUPPORTED_MENU_MODEL",
    "INVALID_MENU_COLUMN_CONSTRAINTS",
    "PLAN_MODEL_MISMATCH",
    "INVALID_OPERATION_ORDER_OR_DUPLICATE",
    "INCOMPLETE_CARD_LAYOUT",
    "DISALLOWED_COLUMN_COUNT",
    "CARD_LAYOUT_REQUIRES_SINGLE_COLUMN",
    "OPTIONS_STRUCTURE_HASH_MISMATCH",
    "OPTIONS_CONSTRAINT_HASH_MISMATCH",
    "UNSUPPORTED_OPTIONS_MODEL",
    "INVALID_OPTIONS_COLUMN_CONSTRAINTS",
    "OPTIONS_PLAN_MODEL_MISMATCH",
    "DISALLOWED_OPTION_COLUMN_COUNT",
  ]);
  return allowedCodes.has(error.message) ? error.message : "GENERATION_OR_VALIDATION_ERROR";
}

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
  layoutOptions: {
    serviceToken?: string;
    policies?: readonly LayoutPolicy[];
    planGenerator?: LayoutPlanGenerator;
    demoMenuPlanGenerator?: (
      model: DemoMenuModel,
      client?: OpenAI,
      onDiagnostic?: (event:
        | "openai_attempt"
        | "openai_response"
        | "json_parse_started"
        | "json_parsed"
        | "plan_validation_started"
        | "plan_validated"
        | "openai_timeout") => void,
    ) => Promise<DemoMenuPlan>;
    demoMenuPolicies?: typeof registeredDemoMenuPolicies;
    demoOptionsPlanGenerator?: (
      model: DemoOptionsModel,
      client?: OpenAI,
      onDiagnostic?: (event:
        | "openai_attempt"
        | "openai_response"
        | "json_parse_started"
        | "json_parsed"
        | "plan_validation_started"
        | "plan_validated"
        | "openai_timeout") => void,
    ) => Promise<DemoOptionsPlan>;
    demoOptionsPolicies?: typeof registeredDemoOptionsPolicies;
    universalLayoutOpenAIProvider?: UniversalLayoutPlanProvider;
    universalLayoutV2FakeProvider?: UniversalLayoutV2PlanProvider;
    universalLayoutV2OpenAIProvider?: UniversalLayoutV2PlanProvider;
    universalLayoutV2OpenAIRequestGuard?: UniversalLayoutV2OpenAIRequestGuard;
    maxRequestsPerHost?: number;
  } = {},
) {
  const app = express();
  const recommendationAttempts = new Map<string, { count: number; resetAt: number }>();
  const layoutAttempts = new Map<string, { count: number; resetAt: number }>();
  const layoutPlanCache = new Map<string, { expiresAt: number; result: Promise<unknown> }>();
  const layoutPolicies = layoutOptions.policies ?? [];
  const demoMenuPolicies = layoutOptions.demoMenuPolicies ?? registeredDemoMenuPolicies;
  const demoOptionsPolicies = layoutOptions.demoOptionsPolicies ?? registeredDemoOptionsPolicies;
  const layoutPlanGenerator = layoutOptions.planGenerator ?? generateLayoutPlan;
  const demoMenuPlanGenerator = layoutOptions.demoMenuPlanGenerator ?? generateDemoMenuPlan;
  const demoOptionsPlanGenerator = layoutOptions.demoOptionsPlanGenerator ?? generateDemoOptionsPlan;
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  const universalDevMockEnabled =
    process.env.NODE_ENV === "development" &&
    process.env.UNIVERSAL_LAYOUT_DEV_MOCK_API === "true";
  const universalDevOpenAIEnabled =
    process.env.NODE_ENV === "development" &&
    process.env.UNIVERSAL_LAYOUT_DEV_MOCK_API === "true" &&
    process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_PROVIDER === "true";
  const universalDevV2FakeEnabled =
    process.env.NODE_ENV === "development" &&
    process.env.UNIVERSAL_LAYOUT_DEV_V2_FAKE_API === "true";
  const universalDevV2OpenAIEnabled =
    process.env.NODE_ENV === "development" &&
    process.env.UNIVERSAL_LAYOUT_DEV_V2_OPENAI_PROVIDER === "true";

  app.disable("x-powered-by");
  if (universalDevMockEnabled) {
    app.use((req, res, next) => {
      if (req.method !== "POST" || req.path !== "/api/dev/universal-layout/plan") {
        return next();
      }

      const requestId = randomUUID();
      let errorCode: UniversalDevDiagnosticErrorCode = "NONE";
      res.locals.universalDevDiagnosticState = {
        requestId,
        setErrorCode: (nextErrorCode: UniversalDevDiagnosticErrorCode) => {
          errorCode = nextErrorCode;
        },
      } satisfies UniversalDevDiagnosticState;
      logUniversalDevExpressEntry(requestId, res, () => errorCode);
      return next();
    });
  }

  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (!origin) return next();
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === req.get("host");
    } catch {
      universalDevDiagnosticState(res)?.setErrorCode("REQUEST_REJECTED");
      return fail(res, 403, "허용되지 않은 연결 주소입니다.");
    }
    if (!sameOrigin && !allowedOrigins.has(origin)) {
      universalDevDiagnosticState(res)?.setErrorCode("REQUEST_REJECTED");
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

  if (universalDevMockEnabled) {
    app.post("/api/dev/universal-layout/plan", asyncRoute(async (req, res) => {
      const diagnosticState = universalDevDiagnosticState(res);
      const requestId = diagnosticState?.requestId ?? randomUUID();
      let diagnosticErrorCode: UniversalDevDiagnosticErrorCode = "NONE";
      logUniversalDevRequest(requestId, res, () => diagnosticErrorCode);
      const reject = (
        status: number,
        message: string,
        errorCode: Exclude<UniversalDevDiagnosticErrorCode, "NONE">,
      ) => {
        diagnosticErrorCode = errorCode;
        diagnosticState?.setErrorCode(errorCode);
        return fail(res, status, message);
      };

      res.setHeader("Cache-Control", "no-store");
      const expectedToken = layoutOptions.serviceToken ?? process.env.AI_LAYOUT_SERVICE_TOKEN?.trim();
      if (!expectedToken) {
        return reject(503, "Development Mock API 인증 설정이 없습니다.", "SERVICE_NOT_CONFIGURED");
      }

      const authorization = req.get("authorization") ?? "";
      const match = /^Bearer ([^\s]+)$/.exec(authorization);
      const provided = match?.[1] ?? "";
      const expectedBuffer = Buffer.from(expectedToken);
      const providedBuffer = Buffer.from(provided);
      const authorized =
        expectedBuffer.length === providedBuffer.length &&
        timingSafeEqual(expectedBuffer, providedBuffer);
      if (!authorized) return reject(401, "인증이 필요합니다.", "AUTH_REQUIRED");

      const parsed = universalLayoutDevelopmentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reject(400, "Universal v1 모델을 확인해 주세요.", "INVALID_REQUEST");
      }
      const model = parsed.data.model;
      const registered = UNIVERSAL_LAYOUT_MOCK_POLICIES.some((policy) =>
        policy.hostId === model.hostId && policy.screenId === model.screenId,
      );
      if (!registered) {
        return reject(404, "등록되지 않은 Development Mock 화면입니다.", "UNREGISTERED_SCREEN");
      }

      try {
        const plan = await generateUniversalLayoutPlan({
          model,
          policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
          provider: universalLayoutDevelopmentMockProvider,
        });
        return res.json(plan);
      } catch (error) {
        const code = error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
          : "GENERATION_FAILED";
        const status = code === "INVALID_MODEL" ? 400 : 502;
        return reject(
          status,
          code,
          code === "INVALID_MODEL" ? "INVALID_MODEL" : "GENERATION_FAILED",
        );
      }
    }));
  }

  if (universalDevOpenAIEnabled) {
    app.post("/api/dev/universal-layout/openai-plan", asyncRoute(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const expectedToken = layoutOptions.serviceToken ?? process.env.AI_LAYOUT_SERVICE_TOKEN?.trim();
      if (!expectedToken) return fail(res, 503, "Development AI API 인증 설정이 없습니다.");

      const authorization = req.get("authorization") ?? "";
      const match = /^Bearer ([^\s]+)$/.exec(authorization);
      const providedBuffer = Buffer.from(match?.[1] ?? "");
      const expectedBuffer = Buffer.from(expectedToken);
      const authorized = expectedBuffer.length === providedBuffer.length &&
        timingSafeEqual(expectedBuffer, providedBuffer);
      if (!authorized) return fail(res, 401, "인증이 필요합니다.");

      const parsed = universalLayoutDevelopmentRequestSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Universal v1 모델을 확인해 주세요.");
      const model = parsed.data.model;
      const registered = UNIVERSAL_LAYOUT_MOCK_POLICIES.some((policy) =>
        policy.hostId === model.hostId && policy.screenId === model.screenId,
      );
      if (!registered) return fail(res, 404, "등록되지 않은 Development 화면입니다.");

      try {
        const provider = layoutOptions.universalLayoutOpenAIProvider ??
          createUniversalLayoutOpenAIProvider();
        const plan = await generateUniversalLayoutPlan({
          model,
          policies: UNIVERSAL_LAYOUT_MOCK_POLICIES,
          provider,
        });
        return res.json(plan);
      } catch (error) {
        const code = error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
          : error instanceof Error && error.message === "AI_NOT_CONFIGURED"
            ? "AI_NOT_CONFIGURED"
            : "GENERATION_FAILED";
        const status = code === "INVALID_MODEL" ? 400 : code === "AI_NOT_CONFIGURED" ? 503 : 502;
        return fail(res, status, code);
      }
    }));
  }

  if (universalDevV2OpenAIEnabled) {
    app.post("/api/dev/universal-layout/v2/openai-plan", asyncRoute(async (req, res) => {
      const requestId = randomUUID();
      let openaiAttempted = false;
        const log = (
          stage: string,
          outcome: string,
          statusCode?: number,
          providerDiagnostic?: UniversalLayoutV2OpenAIDiagnostic,
          failureStage?: string,
        ) =>
        logUniversalV2OpenAIDiagnostic(requestId, stage, outcome, {
          ...(statusCode === undefined ? {} : { statusCode }),
          openaiAttempted,
            ...(providerDiagnostic ? { providerDiagnostic } : {}),
            ...(failureStage ? { failureStage } : {}),
        });
      const respondWithError = (status: number, code: string) => {
        log("response", "completed", status);
        return fail(res, status, code);
      };

      res.setHeader("Cache-Control", "no-store");
      log("request_entered", "reached");
      const expectedToken = layoutOptions.serviceToken ?? process.env.AI_LAYOUT_SERVICE_TOKEN?.trim();
      if (!expectedToken) {
        log("authentication", "failed");
        return respondWithError(503, "SERVICE_NOT_CONFIGURED");
      }

      const authorization = req.get("authorization") ?? "";
      const match = /^Bearer ([^\s]+)$/.exec(authorization);
      const expectedBuffer = Buffer.from(expectedToken);
      const providedBuffer = Buffer.from(match?.[1] ?? "");
      const authorized = expectedBuffer.length === providedBuffer.length &&
        timingSafeEqual(expectedBuffer, providedBuffer);
      log("authentication", authorized ? "passed" : "failed");
      if (!authorized) return respondWithError(401, "AUTH_REQUIRED");

      const parsed = z.object({ model: universalLayoutV2ModelSchema }).strict().safeParse(req.body);
      log("model_schema_validation", parsed.success ? "passed" : "failed");
      if (!parsed.success) return respondWithError(400, "INVALID_REQUEST");

      let model: ReturnType<typeof validateDevelopmentUniversalLayoutV2Model>;
      let registration: ReturnType<typeof resolveDevelopmentUniversalLayoutV2Registration>;
      try {
        registration = resolveDevelopmentUniversalLayoutV2Registration(
          parsed.data.model.hostId,
          parsed.data.model.screenId,
        );
        model = validateDevelopmentUniversalLayoutV2Model(parsed.data.model);
        log("registry_validation", "passed");
      } catch (error) {
        log("registry_validation", "failed");
        if (error instanceof DevelopmentUniversalLayoutV2RegistryError) {
          const status = error.code === "UNREGISTERED_HOST_SCREEN" ||
            error.code === "UNREGISTERED_STRUCTURE_VERSION" ? 404 : 400;
          return respondWithError(status, error.code);
        }
        if (error instanceof UniversalLayoutV2ValidationError) {
          return respondWithError(400, error.code);
        }
        return respondWithError(400, "INVALID_MODEL");
      }

      try {
        validateUniversalLayoutV2OpenAIScope(model, registration);
        log("pilot_scope_validation", "passed");
      } catch (error) {
        log("pilot_scope_validation", "failed");
        return respondWithError(
          403,
          error instanceof UniversalLayoutV2OpenAIScopeError
            ? error.code
            : "V2_OPENAI_SCOPE_REJECTED",
        );
      }

      try {
        const provider = layoutOptions.universalLayoutV2OpenAIProvider ??
          createUniversalLayoutV2OpenAIProvider({
            onDiagnostic: (diagnostic) =>
              log("provider_diagnostic", "classified", undefined, diagnostic),
          });
        const guard = layoutOptions.universalLayoutV2OpenAIRequestGuard ??
          universalLayoutV2OpenAIProcessGuard;
        const result = await guard.run(
          universalLayoutV2ModelFingerprint(model),
          async () => {
            openaiAttempted = true;
            log("openai_call", "started");
            const plan = await generateUniversalLayoutV2Plan({
              model,
              policies: [registration.policy],
              provider,
              responseSchema: createUniversalLayoutV2SingleOptionPlanJsonSchema(
                model,
                registration.componentId,
                registration.optionIds[0],
              ),
              systemInstruction: UNIVERSAL_LAYOUT_V2_SINGLE_OPTION_SYSTEM_INSTRUCTION,
            });
            return validateDevelopmentUniversalLayoutV2Plan(plan, model);
          },
        );
        if (result.source === "generated") log("openai_call", "succeeded");
        log("plan_validation", result.source === "generated" ? "passed" : result.source);
        log("response", "completed", 200);
        return res.json(result.plan);
      } catch (error) {
        if (openaiAttempted) log("openai_call", "failed");
        if (error instanceof Error && error.name === "UniversalLayoutV2OpenAICallLimitError") {
          return respondWithError(429, "V2_OPENAI_CALL_LIMIT_REACHED");
        }
        if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") {
          return respondWithError(503, "AI_NOT_CONFIGURED");
        }
        if (error instanceof DevelopmentUniversalLayoutV2RegistryError) {
          const status = error.code === "UNREGISTERED_HOST_SCREEN" ||
            error.code === "UNREGISTERED_STRUCTURE_VERSION" ? 404 : 400;
          return respondWithError(status, error.code);
        }
        if (error instanceof UniversalLayoutV2ValidationError) {
          return respondWithError(400, error.code);
        }
        if (error instanceof UniversalLayoutV2GenerationError) {
          log("generation_failure", "rejected", undefined, undefined, error.code);
          return respondWithError(502, error.validationCode ?? error.code);
        }
        log("generation_failure", "rejected", undefined, undefined, "unknown");
        return respondWithError(502, "GENERATION_FAILED");
      }
    }));
  }

  if (universalDevV2FakeEnabled) {
    app.post("/api/dev/universal-layout/v2/fake-plan", asyncRoute(async (req, res) => {
      const requestId = randomUUID();
      const log = (
        stage: UniversalV2FakeDiagnosticStage,
        outcome: "reached" | "passed" | "failed" | "completed",
        statusCode?: number,
      ) => logUniversalV2FakeDiagnostic(requestId, stage, outcome, statusCode);
      const respondWithError = (status: number, error: string) => {
        log("response", "completed", status);
        return fail(res, status, error);
      };
      log("request_entered", "reached");
      res.setHeader("Cache-Control", "no-store");
      const expectedToken = layoutOptions.serviceToken ?? process.env.AI_LAYOUT_SERVICE_TOKEN?.trim();
      if (!expectedToken) {
        log("authentication", "failed");
        return respondWithError(503, "SERVICE_NOT_CONFIGURED");
      }

      const authorization = req.get("authorization") ?? "";
      const match = /^Bearer ([^\s]+)$/.exec(authorization);
      const expectedBuffer = Buffer.from(expectedToken);
      const providedBuffer = Buffer.from(match?.[1] ?? "");
      const authorized = expectedBuffer.length === providedBuffer.length &&
        timingSafeEqual(expectedBuffer, providedBuffer);
      log("authentication", authorized ? "passed" : "failed");
      if (!authorized) return respondWithError(401, "AUTH_REQUIRED");

      const parsed = z.object({ model: universalLayoutV2ModelSchema }).strict().safeParse(req.body);
      log("model_schema_validation", parsed.success ? "passed" : "failed");
      if (!parsed.success) return respondWithError(400, "INVALID_REQUEST");

      let model: ReturnType<typeof validateDevelopmentUniversalLayoutV2Model>;
      let registration: ReturnType<typeof resolveDevelopmentUniversalLayoutV2Registration>;
      try {
        registration = resolveDevelopmentUniversalLayoutV2Registration(
          parsed.data.model.hostId,
          parsed.data.model.screenId,
        );
        model = validateDevelopmentUniversalLayoutV2Model(parsed.data.model);
        log("registry_validation", "passed");
      } catch (error) {
        log("registry_validation", "failed");
        if (error instanceof DevelopmentUniversalLayoutV2RegistryError) {
          const status = error.code === "UNREGISTERED_HOST_SCREEN" ||
            error.code === "UNREGISTERED_STRUCTURE_VERSION" ? 404 : 400;
          return respondWithError(status, error.code);
        }
        if (error instanceof UniversalLayoutV2ValidationError) {
          return respondWithError(400, error.code);
        }
        return respondWithError(400, "INVALID_MODEL");
      }

      try {
        const plan = await generateUniversalLayoutV2Plan({
          model,
          policies: [registration.policy],
          provider: layoutOptions.universalLayoutV2FakeProvider ??
            universalLayoutV2DevelopmentFakeProvider,
        });
        const validatedPlan = validateDevelopmentUniversalLayoutV2Plan(plan, model);
        log("plan_validation", "passed");
        log("response", "completed", 200);
        return res.json(validatedPlan);
      } catch (error) {
        log("plan_validation", "failed");
        if (error instanceof DevelopmentUniversalLayoutV2RegistryError) {
          const status = error.code === "UNREGISTERED_HOST_SCREEN" ||
            error.code === "UNREGISTERED_STRUCTURE_VERSION" ? 404 : 400;
          return respondWithError(status, error.code);
        }
        if (error instanceof UniversalLayoutV2ValidationError) {
          return respondWithError(400, error.code);
        }
        if (error instanceof UniversalLayoutV2GenerationError) {
          const status = error.code === "INVALID_MODEL" ? 400 : 502;
          return respondWithError(status, error.validationCode ?? error.code);
        }
        return respondWithError(502, "GENERATION_FAILED");
      }
    }));
  }

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

  app.post("/api/ai-layout/plan", asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const requestId = randomUUID();
    res.setHeader("X-Request-ID", requestId);
    let openaiAttempted = false;
    let timedOut = false;
    let currentStage = "request_received";
    logAiLayoutDiagnostic(requestId, currentStage);
    res.on("finish", () => {
      logAiLayoutDiagnostic(requestId, "response", {
        statusCode: res.statusCode,
        openaiAttempted,
        timedOut,
      });
    });
    const expectedToken = layoutOptions.serviceToken ?? process.env.AI_LAYOUT_SERVICE_TOKEN?.trim();
    if (!expectedToken) {
      currentStage = "authentication";
      logAiLayoutDiagnostic(requestId, currentStage, { outcome: "failed", errorCode: "SERVICE_NOT_CONFIGURED" });
      return fail(res, 503, "화면 구성 계획 API가 아직 설정되지 않았어요.");
    }

    const authorization = req.get("authorization") ?? "";
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    const provided = match?.[1] ?? "";
    const expectedBuffer = Buffer.from(expectedToken);
    const providedBuffer = Buffer.from(provided);
    const authorized =
      expectedBuffer.length === providedBuffer.length &&
      timingSafeEqual(expectedBuffer, providedBuffer);
    currentStage = "authentication";
    logAiLayoutDiagnostic(requestId, currentStage, {
      outcome: authorized ? "passed" : "failed",
      errorCode: authorized ? undefined : "AUTH_FAILED",
    });
    if (!authorized) return fail(res, 401, "인증이 필요합니다.");

    let input: LayoutPlanRequest | DemoMenuModel | DemoOptionsModel;
    let isDemoMenu = false;
    let isDemoOptions = false;
    let demoPolicy: (typeof registeredDemoMenuPolicies)[number] | undefined;
    let demoOptionsPolicy: (typeof registeredDemoOptionsPolicies)[number] | undefined;
    try {
      const isHostSpecificModel = Boolean(req.body && typeof req.body === "object" && "hostId" in req.body);
      if (isHostSpecificModel) {
        demoPolicy = demoMenuPolicies.find((candidate) =>
          candidate.hostId === req.body.hostId && candidate.screenId === req.body.screenId,
        );
        demoOptionsPolicy = demoOptionsPolicies.find((candidate) =>
          candidate.hostId === req.body.hostId && candidate.screenId === req.body.screenId,
        );
        isDemoMenu = Boolean(demoPolicy);
        isDemoOptions = Boolean(demoOptionsPolicy);
        if (!demoPolicy && !demoOptionsPolicy) {
          currentStage = "policy_lookup";
          logAiLayoutDiagnostic(requestId, currentStage, {
            outcome: "rejected",
            errorCode: "UNSUPPORTED_SCREEN",
          });
          return fail(res, 404, "지원하지 않는 화면입니다.");
        }
      }
      input = isDemoMenu
        ? validateDemoMenuModel(req.body)
        : isDemoOptions
          ? validateDemoOptionsModel(req.body)
          : validateLayoutPlanRequest(req.body, layoutPolicies);
    } catch (error) {
      currentStage = "model_validation";
      logAiLayoutDiagnostic(requestId, currentStage, {
        outcome: "failed",
        errorCode: safeAiLayoutErrorCode(error, currentStage),
      });
      if (error instanceof Error && error.message === "UNSUPPORTED_SCREEN") {
        return fail(res, 404, "지원하지 않는 화면입니다.");
      }
      return fail(res, 400, "화면 구성 요청을 확인해 주세요.");
    }
    currentStage = "model_validation";
    logAiLayoutDiagnostic(requestId, currentStage, { outcome: "passed" });
    const hostId = isDemoMenu
      ? (input as DemoMenuModel).hostId
      : isDemoOptions
        ? (input as DemoOptionsModel).hostId
        : (input as LayoutPlanRequest).hostAppId;
    const policy = isDemoMenu
      ? demoPolicy && { hostAppId: demoPolicy.hostId, screenId: demoPolicy.screenId }
      : isDemoOptions
        ? demoOptionsPolicy && { hostAppId: demoOptionsPolicy.hostId, screenId: demoOptionsPolicy.screenId }
        : layoutPolicies.find((item) =>
          item.hostAppId === (input as LayoutPlanRequest).hostAppId &&
          item.screenId === (input as LayoutPlanRequest).screenId,
        );
    if (!policy) {
      logAiLayoutDiagnostic(requestId, "policy_lookup", { outcome: "rejected", errorCode: "UNSUPPORTED_SCREEN" });
      return fail(res, 404, "지원하지 않는 화면입니다.");
    }

    const now = Date.now();
    const requestKey = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const cachedPlan = layoutPlanCache.get(requestKey);
    if (cachedPlan && cachedPlan.expiresAt > now) {
      try {
        logAiLayoutDiagnostic(requestId, "cache", { outcome: "passed" });
        return res.json(await cachedPlan.result);
      } catch {
        layoutPlanCache.delete(requestKey);
        logAiLayoutDiagnostic(requestId, "plan_generation", { outcome: "failed", errorCode: "CACHED_PLAN_REJECTED" });
        return fail(res, 502, "화면 구성 계획을 만들지 못했어요. 기존 화면을 유지해 주세요.");
      }
    }
    if (cachedPlan) layoutPlanCache.delete(requestKey);

    const attempts = layoutAttempts.get(hostId);
    const limit = layoutOptions.maxRequestsPerHost ?? 10;
    if (attempts && attempts.resetAt > now && attempts.count >= limit) {
      logAiLayoutDiagnostic(requestId, "request_limit", { outcome: "rejected", errorCode: "REQUEST_LIMIT_EXCEEDED" });
      res.setHeader("Retry-After", "600");
      return fail(res, 429, "요청이 잠시 많아요. 잠시 후 다시 시도해 주세요.");
    }
    if (!attempts || attempts.resetAt <= now) {
      layoutAttempts.set(hostId, { count: 1, resetAt: now + 10 * 60_000 });
    } else {
      attempts.count += 1;
    }
    if (layoutAttempts.size > 2_000) {
      for (const [key, value] of layoutAttempts) {
        if (value.resetAt <= now) layoutAttempts.delete(key);
      }
    }

    const result = Promise.resolve().then(async () => {
      if (isDemoMenu) {
        currentStage = "plan_generation";
        logAiLayoutDiagnostic(requestId, currentStage, { outcome: "started" });
        const generated = await demoMenuPlanGenerator(
          input as DemoMenuModel,
          undefined,
          (event) => {
            if (event === "openai_attempt") openaiAttempted = true;
            if (event === "openai_timeout") timedOut = true;
            const stageByEvent: Record<string, string> = {
              openai_attempt: "openai_request",
              openai_response: "openai_response",
              json_parse_started: "json_parse",
              json_parsed: "json_parse",
              plan_validation_started: "plan_validation",
              plan_validated: "plan_validation",
              openai_timeout: "openai_request",
            };
            currentStage = stageByEvent[event] ?? currentStage;
            const outcome =
              event === "openai_attempt" || event === "json_parse_started" || event === "plan_validation_started"
                ? "started"
                : event === "openai_timeout"
                  ? "failed"
                  : "passed";
            logAiLayoutDiagnostic(requestId, currentStage, {
              outcome,
              errorCode: event === "openai_timeout" ? "OPENAI_TIMEOUT" : undefined,
              openaiAttempted,
              timedOut,
            });
          },
        );
        logAiLayoutDiagnostic(requestId, "plan_generation", { outcome: "completed", openaiAttempted, timedOut });
        currentStage = "plan_validation";
        logAiLayoutDiagnostic(requestId, currentStage, { outcome: "started" });
        return validateDemoMenuPlan(generated, input as DemoMenuModel);
      } else if (isDemoOptions) {
        currentStage = "plan_generation";
        logAiLayoutDiagnostic(requestId, currentStage, { outcome: "started" });
        const generated = await demoOptionsPlanGenerator(
          input as DemoOptionsModel,
          undefined,
          (event) => {
            if (event === "openai_attempt") openaiAttempted = true;
            if (event === "openai_timeout") timedOut = true;
            const stageByEvent: Record<string, string> = {
              openai_attempt: "openai_request",
              openai_response: "openai_response",
              json_parse_started: "json_parse",
              json_parsed: "json_parse",
              plan_validation_started: "plan_validation",
              plan_validated: "plan_validation",
              openai_timeout: "openai_request",
            };
            currentStage = stageByEvent[event] ?? currentStage;
            const outcome =
              event === "openai_attempt" || event === "json_parse_started" || event === "plan_validation_started"
                ? "started"
                : event === "openai_timeout"
                  ? "failed"
                  : "passed";
            logAiLayoutDiagnostic(requestId, currentStage, {
              outcome,
              errorCode: event === "openai_timeout" ? "OPENAI_TIMEOUT" : undefined,
              openaiAttempted,
              timedOut,
            });
          },
        );
        logAiLayoutDiagnostic(requestId, "plan_generation", { outcome: "completed", openaiAttempted, timedOut });
        currentStage = "plan_validation";
        logAiLayoutDiagnostic(requestId, currentStage, { outcome: "started" });
        return validateDemoOptionsPlan(generated, input as DemoOptionsModel);
      }
      currentStage = "plan_generation";
      logAiLayoutDiagnostic(requestId, currentStage, { outcome: "started" });
      return layoutPlanGenerator(input as LayoutPlanRequest, policy as LayoutPolicy);
    });
    layoutPlanCache.set(requestKey, { expiresAt: now + 30_000, result });
    if (layoutPlanCache.size > 2_000) {
      for (const [key, value] of layoutPlanCache) {
        if (value.expiresAt <= now) layoutPlanCache.delete(key);
      }
      while (layoutPlanCache.size > 2_000) {
        const oldestKey = layoutPlanCache.keys().next().value;
        if (oldestKey === undefined) break;
        layoutPlanCache.delete(oldestKey);
      }
    }

    try {
      const plan = await result;
      if (isDemoMenu || isDemoOptions) {
        logAiLayoutDiagnostic(requestId, "plan_validation", { outcome: "passed", openaiAttempted, timedOut });
      }
      return res.json(plan);
    } catch (error) {
      layoutPlanCache.delete(requestKey);
      logAiLayoutDiagnostic(requestId, currentStage, {
        outcome: "failed",
        errorCode: safeAiLayoutErrorCode(error, currentStage),
        openaiAttempted,
        timedOut,
      });
      if (error instanceof Error && error.message === "AI_NOT_CONFIGURED") {
        return fail(res, 503, "화면 구성 계획 API가 아직 설정되지 않았어요.");
      }
      return fail(res, 502, "화면 구성 계획을 만들지 못했어요. 기존 화면을 유지해 주세요.");
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

  app.use("/api", (_req, res) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-ID", requestId);
    console.info(JSON.stringify({
      event: "api_route_not_found",
      requestId,
      statusCode: 404,
    }));
    return fail(res, 404, "요청한 기능을 찾을 수 없습니다.");
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const bodyError = error as { type?: string; status?: number };
    if (bodyError?.type === "entity.parse.failed") {
      universalDevDiagnosticState(res)?.setErrorCode("INVALID_JSON");
      return fail(res, 400, "요청 형식을 확인해 주세요.");
    }
    if (bodyError?.type === "entity.too.large") {
      universalDevDiagnosticState(res)?.setErrorCode("BODY_TOO_LARGE");
      return fail(res, 413, "요청이 너무 큽니다.");
    }
    universalDevDiagnosticState(res)?.setErrorCode("UNEXPECTED_ERROR");
    console.error("API request failed:", error instanceof Error ? error.name : "UnknownError");
    return fail(res, 500, "서버에서 요청을 처리하지 못했습니다.");
  });

  return app;
}
