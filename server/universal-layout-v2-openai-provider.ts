import OpenAI from "openai";
import type {
  UniversalLayoutV2PlanProvider,
  UniversalLayoutV2PromptPayload,
} from "./universal-layout-generator-v2";

export type UniversalLayoutV2OpenAIClient = Pick<OpenAI, "responses">;

export type UniversalLayoutV2OpenAIFailureCategory =
  | "authentication"
  | "permission"
  | "rate_limit"
  | "bad_request"
  | "server_error"
  | "network"
  | "timeout"
  | "schema_rejected"
  | "model_error"
  | "refusal"
  | "empty_response"
  | "unknown";

export type UniversalLayoutV2OpenAIDiagnostic = {
  sdkErrorType:
    | "APIError"
    | "APIConnectionError"
    | "APIConnectionTimeoutError"
    | "AuthenticationError"
    | "PermissionDeniedError"
    | "BadRequestError"
    | "RateLimitError"
    | "InternalServerError"
    | "unknown";
  httpResponseReceived: boolean;
  httpStatus: number | null;
  errorCategory: UniversalLayoutV2OpenAIFailureCategory;
  timeout: boolean;
  networkException: boolean;
  schemaRejection: boolean;
};

const SAFE_HTTP_STATUSES = new Set([400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504]);
const SAFE_ERROR_CODES: Record<string, UniversalLayoutV2OpenAIFailureCategory> = {
  authentication_error: "authentication",
  invalid_api_key: "authentication",
  permission_error: "permission",
  rate_limit_exceeded: "rate_limit",
  insufficient_quota: "rate_limit",
  invalid_request_error: "bad_request",
  invalid_json_schema: "schema_rejected",
  json_schema_not_supported: "schema_rejected",
  model_not_found: "model_error",
  model_not_supported: "model_error",
};
const SAFE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
const SAFE_SDK_ERROR_TYPES = new Set<UniversalLayoutV2OpenAIDiagnostic["sdkErrorType"]>([
  "APIError",
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "AuthenticationError",
  "PermissionDeniedError",
  "BadRequestError",
  "RateLimitError",
  "InternalServerError",
]);

function errorField(error: unknown, key: string): unknown {
  return error && typeof error === "object" && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

/** Converts SDK errors to a bounded, non-sensitive Development diagnostic. */
export function classifyUniversalLayoutV2OpenAIError(
  error: unknown,
): UniversalLayoutV2OpenAIDiagnostic {
  const rawName = errorField(error, "name");
  const sdkErrorType = typeof rawName === "string" && SAFE_SDK_ERROR_TYPES.has(
    rawName as UniversalLayoutV2OpenAIDiagnostic["sdkErrorType"],
  )
    ? rawName as UniversalLayoutV2OpenAIDiagnostic["sdkErrorType"]
    : "unknown";
  const rawStatus = errorField(error, "status");
  const httpResponseReceived = typeof rawStatus === "number" &&
    Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599;
  const httpStatus = httpResponseReceived && SAFE_HTTP_STATUSES.has(rawStatus)
    ? rawStatus
    : null;
  const rawCode = errorField(error, "code");
  const causeCode = errorField(errorField(error, "cause"), "code");
  const code = typeof rawCode === "string"
    ? rawCode
    : typeof causeCode === "string" ? causeCode : "";
  const rawMessage = errorField(error, "message");
  const message = typeof rawMessage === "string" ? rawMessage : "";
  const timeout = sdkErrorType === "APIConnectionTimeoutError" ||
    sdkErrorType === "unknown" && rawName === "TimeoutError" ||
    code === "ETIMEDOUT";
  const networkException = sdkErrorType === "APIConnectionError" || SAFE_NETWORK_CODES.has(code);
  const schemaRejection = code === "invalid_json_schema" || code === "json_schema_not_supported";
  let errorCategory: UniversalLayoutV2OpenAIFailureCategory =
    SAFE_ERROR_CODES[code] ?? "unknown";

  if (message === "UNIVERSAL_LAYOUT_V2_PROVIDER_REFUSED") errorCategory = "refusal";
  else if (message === "EMPTY_UNIVERSAL_LAYOUT_V2_RESPONSE") errorCategory = "empty_response";
  else if (schemaRejection) errorCategory = "schema_rejected";
  else if (timeout) errorCategory = "timeout";
  else if (networkException) errorCategory = "network";
  else if (errorCategory === "unknown" && typeof rawStatus === "number") {
    if (rawStatus === 401) errorCategory = "authentication";
    else if (rawStatus === 403) errorCategory = "permission";
    else if (rawStatus === 429) errorCategory = "rate_limit";
    else if (rawStatus === 400 || rawStatus === 408 || rawStatus === 409 ||
      rawStatus === 413 || rawStatus === 422) errorCategory = "bad_request";
    else if (rawStatus >= 500) errorCategory = "server_error";
  }

  return {
    sdkErrorType,
    httpResponseReceived,
    httpStatus,
    errorCategory,
    timeout,
    networkException,
    schemaRejection,
  };
}

function notifyDiagnostic(
  callback: ((diagnostic: UniversalLayoutV2OpenAIDiagnostic) => void) | undefined,
  error: unknown,
): void {
  try {
    callback?.(classifyUniversalLayoutV2OpenAIError(error));
  } catch {
    // Diagnostics must never change provider behavior.
  }
}

export function createUniversalLayoutV2OpenAIProvider(options: {
  apiKey?: string;
  model?: string;
  client?: UniversalLayoutV2OpenAIClient;
  onDiagnostic?: (diagnostic: UniversalLayoutV2OpenAIDiagnostic) => void;
} = {}): UniversalLayoutV2PlanProvider {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!options.client && !apiKey) throw new Error("AI_NOT_CONFIGURED");

  const client = options.client ?? new OpenAI({
    apiKey,
    timeout: 18_000,
    maxRetries: 0,
  });
  const model =
    options.model?.trim() ||
    process.env.UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL?.trim() ||
    "gpt-6-luna";

  return {
    async generate({ systemInstruction, payload, responseSchema, signal }) {
      let response: Awaited<ReturnType<UniversalLayoutV2OpenAIClient["responses"]["create"]>>;
      try {
        response = await client.responses.create({
          model,
          store: false,
          max_output_tokens: 500,
          reasoning: { effort: "none" },
          input: [
            { role: "system", content: systemInstruction },
            { role: "user", content: JSON.stringify(payload as UniversalLayoutV2PromptPayload) },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "universal_layout_plan_v2",
              strict: true,
              schema: responseSchema,
            },
          },
        }, signal ? { signal } : undefined);
      } catch (error) {
        notifyDiagnostic(options.onDiagnostic, error);
        throw error;
      }

      const wasRefused = response.output.some((item) =>
        item.type === "message" && item.content.some((part) => part.type === "refusal"),
      );
      if (wasRefused) {
        const error = new Error("UNIVERSAL_LAYOUT_V2_PROVIDER_REFUSED");
        notifyDiagnostic(options.onDiagnostic, error);
        throw error;
      }
      if (!response.output_text) {
        const error = new Error("EMPTY_UNIVERSAL_LAYOUT_V2_RESPONSE");
        notifyDiagnostic(options.onDiagnostic, error);
        throw error;
      }
      return response.output_text;
    },
  };
}
