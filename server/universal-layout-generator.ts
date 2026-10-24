import {
  UNIVERSAL_LAYOUT_CONTRACT_VERSION,
  UNIVERSAL_LAYOUT_SCHEMA_VERSION,
  universalLayoutPlanSchema,
  validateUniversalLayoutModel,
  validateUniversalLayoutPlan,
  type UniversalLayoutModel,
  type UniversalLayoutPlan,
  type UniversalLayoutPolicy,
} from "./universal-layout-contract";

export const UNIVERSAL_LAYOUT_SYSTEM_INSTRUCTION = `너는 Universal Layout Contract v1 화면의 열 수 선택 계획만 만든다.
검증된 모델에 포함된 host, screen, component 식별자와 제약을 그대로 사용한다.
허용된 component의 setColumns만 반환한다. 열 수는 해당 component의 allowedColumns 중에서만 고른다.
화면 항목, 순서, 선택 상태, 업무 동작, 결제·발급 동작은 변경하지 않는다.
HTML, CSS, JavaScript, DOM, 사용자 입력, 상품·가격·주문 데이터, 증명서 내용 또는 임의 속성을 만들거나 반환하지 않는다.
모델 식별자와 해시를 정확히 그대로 반환하며, 계획이 적합하지 않으면 유효한 허용 계획만 반환한다.`;

export type UniversalLayoutJsonSchema = {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, unknown>;
};

export type UniversalLayoutPromptPayload = {
  schemaVersion: typeof UNIVERSAL_LAYOUT_SCHEMA_VERSION;
  contractVersion: typeof UNIVERSAL_LAYOUT_CONTRACT_VERSION;
  hostId: string;
  screenId: string;
  structureVersion: string;
  structureHash: string;
  constraintHash: string;
  viewportClass: UniversalLayoutModel["viewportClass"];
  accessibility: UniversalLayoutModel["accessibility"];
  components: Array<{
    id: string;
    kind: string;
    role: string;
    allowedColumns: number[];
    operations: string[];
    minimumTouchTargetPx: number;
    protectedProperties: string[];
  }>;
};

export interface UniversalLayoutPlanProvider {
  generate(input: {
    systemInstruction: string;
    payload: UniversalLayoutPromptPayload;
    responseSchema: UniversalLayoutJsonSchema;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export type UniversalLayoutGenerationErrorCode =
  | "INVALID_MODEL"
  | "PROVIDER_FAILURE"
  | "INVALID_JSON"
  | "INVALID_STRUCTURED_OUTPUT"
  | "PLAN_REJECTED"
  | "REQUEST_ABORTED";

export class UniversalLayoutGenerationError extends Error {
  constructor(
    readonly code: UniversalLayoutGenerationErrorCode,
    readonly validationCode?: string,
  ) {
    super(code);
    this.name = "UniversalLayoutGenerationError";
  }
}

export function createUniversalLayoutPlanJsonSchema(
  model: UniversalLayoutModel,
): UniversalLayoutJsonSchema {
  const operationVariants = model.components.map((component) => ({
    type: "object",
    additionalProperties: false,
    required: ["type", "targetId", "columns"],
    properties: {
      type: { type: "string", const: "setColumns" },
      targetId: { type: "string", const: component.id },
      columns: { type: "integer", enum: [...component.allowedColumns] },
    },
  }));

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "contractVersion",
      "hostId",
      "screenId",
      "structureVersion",
      "structureHash",
      "constraintHash",
      "viewportClass",
      "operations",
    ],
    properties: {
      schemaVersion: { type: "integer", const: UNIVERSAL_LAYOUT_SCHEMA_VERSION },
      contractVersion: { type: "string", const: UNIVERSAL_LAYOUT_CONTRACT_VERSION },
      hostId: { type: "string", const: model.hostId },
      screenId: { type: "string", const: model.screenId },
      structureVersion: { type: "string", const: model.structureVersion },
      structureHash: { type: "string", const: model.structureHash },
      constraintHash: { type: "string", const: model.constraintHash },
      viewportClass: { type: "string", const: model.viewportClass },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: operationVariants.length === 1
          ? operationVariants[0]
          : { oneOf: operationVariants },
      },
    },
  };
}

function createPromptPayload(model: UniversalLayoutModel): UniversalLayoutPromptPayload {
  return {
    schemaVersion: model.schemaVersion,
    contractVersion: model.contractVersion,
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    accessibility: model.accessibility,
    components: model.components.map((component) => ({
      id: component.id,
      kind: component.kind,
      role: component.role,
      allowedColumns: [...component.allowedColumns],
      operations: [...component.operations],
      minimumTouchTargetPx: component.minimumTouchTargetPx,
      protectedProperties: [...component.protectedProperties],
    })),
  };
}

function knownCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

export async function generateUniversalLayoutPlan(
  input: {
    model: unknown;
    policies: readonly UniversalLayoutPolicy[];
    provider: UniversalLayoutPlanProvider;
    signal?: AbortSignal;
  },
): Promise<UniversalLayoutPlan> {
  let model: UniversalLayoutModel;
  try {
    model = validateUniversalLayoutModel(input.model, input.policies);
  } catch (error) {
    throw new UniversalLayoutGenerationError("INVALID_MODEL", knownCode(error));
  }

  if (input.signal?.aborted) {
    throw new UniversalLayoutGenerationError("REQUEST_ABORTED");
  }

  let rawOutput: unknown;
  try {
    rawOutput = await input.provider.generate({
      systemInstruction: UNIVERSAL_LAYOUT_SYSTEM_INSTRUCTION,
      payload: createPromptPayload(model),
      responseSchema: createUniversalLayoutPlanJsonSchema(model),
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new UniversalLayoutGenerationError("REQUEST_ABORTED");
    }
    throw new UniversalLayoutGenerationError("PROVIDER_FAILURE");
  }
  if (input.signal?.aborted) {
    throw new UniversalLayoutGenerationError("REQUEST_ABORTED");
  }

  let decodedOutput: unknown = rawOutput;
  if (typeof rawOutput === "string") {
    try {
      decodedOutput = JSON.parse(rawOutput);
    } catch {
      throw new UniversalLayoutGenerationError("INVALID_JSON");
    }
  }

  try {
    universalLayoutPlanSchema.parse(decodedOutput);
  } catch {
    throw new UniversalLayoutGenerationError("INVALID_STRUCTURED_OUTPUT");
  }

  try {
    return validateUniversalLayoutPlan(decodedOutput, model, input.policies);
  } catch (error) {
    throw new UniversalLayoutGenerationError("PLAN_REJECTED", knownCode(error));
  }
}
