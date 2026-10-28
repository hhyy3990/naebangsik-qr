import {
  UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION,
  UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION,
  parseUniversalLayoutV2Plan,
  validateUniversalLayoutV2Model,
  validateUniversalLayoutV2Plan,
  type UniversalLayoutV2Model,
  type UniversalLayoutV2Plan,
  type UniversalLayoutV2Policy,
} from "./universal-layout-contract-v2";

export type UniversalLayoutV2JsonSchema = {
  type: "object";
  additionalProperties: false;
  required: string[];
  properties: Record<string, unknown>;
};

export type UniversalLayoutV2PromptPayload = Omit<UniversalLayoutV2Model, "components"> & {
  components: Array<Pick<
    UniversalLayoutV2Model["components"][number],
    "id" | "kind" | "role" | "operations" | "allowedColumns" |
    "optionGroups" | "minimumTouchTargetPx" | "protectedProperties"
  >>;
};

export interface UniversalLayoutV2PlanProvider {
  generate(input: {
    systemInstruction: string;
    payload: UniversalLayoutV2PromptPayload;
    responseSchema: UniversalLayoutV2JsonSchema;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export type UniversalLayoutV2GenerationErrorCode =
  | "INVALID_MODEL"
  | "PROVIDER_FAILURE"
  | "PROVIDER_TIMEOUT"
  | "INVALID_JSON"
  | "INVALID_STRUCTURED_OUTPUT"
  | "PLAN_REJECTED"
  | "REQUEST_ABORTED";

export class UniversalLayoutV2GenerationError extends Error {
  constructor(
    readonly code: UniversalLayoutV2GenerationErrorCode,
    readonly validationCode?: string,
  ) {
    super(code);
    this.name = "UniversalLayoutV2GenerationError";
  }
}

export const UNIVERSAL_LAYOUT_V2_SYSTEM_INSTRUCTION = `너는 Universal Layout Contract v2 계획만 만든다.
model에 포함된 operation, target, group, option ID만 사용한다.
selectLayoutOption은 등록된 option ID 선택이며 CSS나 화면 코드를 만들지 않는다.
각 targetId는 operations 배열에서 한 번만 사용한다. 같은 target에 setColumns와 selectLayoutOption을 함께 반환하지 않는다.
model 식별자와 hash를 그대로 반환하고 추가 필드나 업무 동작을 만들지 않는다.
검증 실패 시 결과를 자동 수정하거나 대체하지 않는다.`;

export const UNIVERSAL_LAYOUT_V2_SINGLE_OPTION_SYSTEM_INSTRUCTION = `너는 Universal Layout Contract v2의 단일 layout option 계획만 만든다.
정확히 하나의 selectLayoutOption operation만 반환한다.
targetId, groupId, optionId는 model에 등록된 값을 그대로 사용한다.
setColumns나 다른 operation을 추가하지 않는다.
화면 코드나 업무 동작을 만들지 않는다. 모델 식별자와 hash를 정확히 그대로 반환한다.`;

export function createUniversalLayoutV2PlanJsonSchema(
  model: UniversalLayoutV2Model,
): UniversalLayoutV2JsonSchema {
  return createPlanJsonSchema(model, 20);
}

export function createUniversalLayoutV2SingleOptionPlanJsonSchema(
  model: UniversalLayoutV2Model,
  targetId: string,
  optionId: string,
): UniversalLayoutV2JsonSchema {
  const component = model.components.find((candidate) => candidate.id === targetId);
  const matchingGroups = component?.optionGroups?.filter((group) => group.optionIds.includes(optionId)) ?? [];
  if (matchingGroups.length !== 1) {
    throw new Error("SINGLE_OPTION_SCHEMA_SELECTION_NOT_REGISTERED");
  }
  return createPlanJsonSchema(model, 1, { targetId, groupId: matchingGroups[0].id, optionId });
}

function createPlanJsonSchema(
  model: UniversalLayoutV2Model,
  maxOperations: number,
  selectedOption?: { targetId: string; groupId: string; optionId: string },
): UniversalLayoutV2JsonSchema {
  const operationVariants = model.components.flatMap((component) => {
    const variants: Record<string, unknown>[] = [];
    if (!selectedOption && component.operations.includes("setColumns")) {
      variants.push({
        type: "object",
        additionalProperties: false,
        required: ["type", "targetId", "columns"],
        properties: {
          type: { type: "string", const: "setColumns" },
          targetId: { type: "string", const: component.id },
          columns: { type: "integer", enum: [...component.allowedColumns] },
        },
      });
    }
    if (component.operations.includes("selectLayoutOption")) {
      for (const group of component.optionGroups ?? []) {
        if (
          selectedOption &&
          (component.id !== selectedOption.targetId || group.id !== selectedOption.groupId)
        ) continue;
        variants.push({
          type: "object",
          additionalProperties: false,
          required: ["type", "targetId", "groupId", "optionId"],
          properties: {
            type: { type: "string", const: "selectLayoutOption" },
            targetId: { type: "string", const: component.id },
            groupId: { type: "string", const: group.id },
            optionId: {
              type: "string",
              enum: selectedOption ? [selectedOption.optionId] : [...group.optionIds],
            },
          },
        });
      }
    }
    return variants;
  });

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
      schemaVersion: { type: "integer", const: UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION },
      contractVersion: { type: "string", const: UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION },
      hostId: { type: "string", const: model.hostId },
      screenId: { type: "string", const: model.screenId },
      structureVersion: { type: "string", const: model.structureVersion },
      structureHash: { type: "string", const: model.structureHash },
      constraintHash: { type: "string", const: model.constraintHash },
      viewportClass: { type: "string", const: model.viewportClass },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: maxOperations,
        items: operationVariants.length === 1
          ? operationVariants[0]
          : { anyOf: operationVariants },
      },
    },
  };
}

function createPromptPayload(model: UniversalLayoutV2Model): UniversalLayoutV2PromptPayload {
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
    layoutCapabilities: [...model.layoutCapabilities],
    allowedOperations: [...model.allowedOperations],
    components: model.components.map((component) => ({
      id: component.id,
      kind: component.kind,
      role: component.role,
      operations: [...component.operations],
      allowedColumns: [...component.allowedColumns],
      ...(component.optionGroups ? {
        optionGroups: component.optionGroups.map((group) => ({
          id: group.id,
          optionIds: [...group.optionIds],
        })),
      } : {}),
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

export async function generateUniversalLayoutV2Plan(input: {
  model: unknown;
  policies: readonly UniversalLayoutV2Policy[];
  provider: UniversalLayoutV2PlanProvider;
  signal?: AbortSignal;
  responseSchema?: UniversalLayoutV2JsonSchema;
  systemInstruction?: string;
}): Promise<UniversalLayoutV2Plan> {
  let model: UniversalLayoutV2Model;
  try {
    model = validateUniversalLayoutV2Model(input.model, input.policies);
  } catch (error) {
    throw new UniversalLayoutV2GenerationError("INVALID_MODEL", knownCode(error));
  }
  if (input.signal?.aborted) {
    throw new UniversalLayoutV2GenerationError("REQUEST_ABORTED");
  }

  let rawOutput: unknown;
  try {
    rawOutput = await input.provider.generate({
      systemInstruction: input.systemInstruction ?? UNIVERSAL_LAYOUT_V2_SYSTEM_INSTRUCTION,
      payload: createPromptPayload(model),
      responseSchema: input.responseSchema ?? createUniversalLayoutV2PlanJsonSchema(model),
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new UniversalLayoutV2GenerationError("REQUEST_ABORTED");
    }
    if (error instanceof Error && /timeout/i.test(error.name)) {
      throw new UniversalLayoutV2GenerationError("PROVIDER_TIMEOUT");
    }
    throw new UniversalLayoutV2GenerationError("PROVIDER_FAILURE");
  }
  if (input.signal?.aborted) {
    throw new UniversalLayoutV2GenerationError("REQUEST_ABORTED");
  }

  let decodedOutput = rawOutput;
  if (typeof rawOutput === "string") {
    try {
      decodedOutput = JSON.parse(rawOutput);
    } catch {
      throw new UniversalLayoutV2GenerationError("INVALID_JSON");
    }
  }

  try {
    parseUniversalLayoutV2Plan(decodedOutput);
  } catch {
    throw new UniversalLayoutV2GenerationError("INVALID_STRUCTURED_OUTPUT");
  }
  try {
    return validateUniversalLayoutV2Plan(decodedOutput, model, input.policies);
  } catch (error) {
    throw new UniversalLayoutV2GenerationError("PLAN_REJECTED", knownCode(error));
  }
}
