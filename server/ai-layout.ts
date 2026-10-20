import OpenAI from "openai";
import {
  validateLayoutPlan,
  type LayoutPlan,
  type LayoutPlanRequest,
  type LayoutPolicy,
} from "./layout-plan";

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "screenId", "structureVersion", "structureHash", "operations", "reasonCode"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    screenId: { type: "string" },
    structureVersion: { type: "string" },
    structureHash: { type: "string" },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["operation", "targetId", "value"],
        properties: {
          operation: {
            type: "string",
            enum: ["set_flow", "set_alignment", "set_gap", "set_columns", "set_media_position", "set_space_ratio"],
          },
          targetId: { type: "string" },
          value: {
            anyOf: [
              { type: "string" },
              { type: "integer" },
            ],
          },
        },
      },
    },
    reasonCode: { type: "string", enum: ["readability", "touch_targets", "space_use", "balanced"] },
  },
} as const;

export async function generateLayoutPlan(
  input: LayoutPlanRequest,
  policy: LayoutPolicy,
  client?: OpenAI,
): Promise<LayoutPlan> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!client && !apiKey) throw new Error("AI_NOT_CONFIGURED");
  const openai = client ?? new OpenAI({
    apiKey,
    timeout: 18_000,
    maxRetries: 0,
  });
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    store: false,
    max_output_tokens: 700,
    input: [
      {
        role: "system",
        content: `너는 키오스크 업무 콘텐츠의 배치 계획만 제안한다.
입력은 검증된 정적 화면 구조다. 입력의 요소 ID, 순서, 업무 동작, 상품·가격 데이터는 바꾸거나 삭제하지 않는다.
요청에 포함된 QR 접근성 설정은 고정 제약이다. 접근성 설정, 고정 컨트롤, 필수 요소를 이동하거나 변경하지 않는다.
허용된 operation, targetId, 값만 사용한다. 없는 요소나 값을 만들지 말고 HTML, CSS, JavaScript를 생성하지 않는다.
요청의 화면 ID, 구조 버전, 구조 해시를 정확히 그대로 반환한다. 제공된 policy의 허용 operation/target/값만 계획에 포함한다.
화면 구조와 제약에 가장 적합한 1~20개의 배치 operation을 반환하고, 사유 코드는 제한된 enum 중 하나만 선택한다.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          screen: {
            modelVersion: input.modelVersion,
            hostAppId: input.hostAppId,
            screenId: input.screenId,
            structureVersion: input.structureVersion,
            structureHash: input.structureHash,
            viewport: input.viewport,
            availableArea: input.availableArea,
            elements: input.elements,
          },
          constraints: input.constraints,
          allowedOperations: policy.operations,
          mutableTargetIds: policy.mutableTargetIds,
          immutableElementIds: policy.immutableElementIds,
          requiredElementIds: policy.requiredElementIds,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "kiosk_layout_plan",
        strict: true,
        schema: responseSchema,
      },
    },
  });
  if (!response.output_text) throw new Error("EMPTY_AI_LAYOUT_RESPONSE");
  return validateLayoutPlan(JSON.parse(response.output_text), input, policy);
}
