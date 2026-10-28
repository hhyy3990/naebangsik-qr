import type {
  UniversalLayoutV2PlanProvider,
  UniversalLayoutV2PromptPayload,
} from "./universal-layout-generator-v2";

/**
 * Deterministic Development-only provider. It selects only operations and
 * options already present in the validated model payload.
 */
export const universalLayoutV2DevelopmentFakeProvider: UniversalLayoutV2PlanProvider = {
  async generate({ payload }) {
    return createFakePlan(payload);
  },
};

function createFakePlan(payload: UniversalLayoutV2PromptPayload) {
  const operations: Array<Record<string, string | number>> = [];

  for (const component of payload.components) {
    const optionGroup = component.operations.includes("selectLayoutOption")
      ? component.optionGroups?.find((group) => group.optionIds.length > 0)
      : undefined;
    const optionId = optionGroup?.optionIds[0];
    if (optionGroup && optionId) {
      operations.push({
        type: "selectLayoutOption",
        targetId: component.id,
        groupId: optionGroup.id,
        optionId,
      });
      continue;
    }

    const columns = component.operations.includes("setColumns")
      ? component.allowedColumns[0]
      : undefined;
    if (columns !== undefined) {
      operations.push({
        type: "setColumns",
        targetId: component.id,
        columns,
      });
    }
  }

  if (operations.length === 0) {
    throw new Error("FAKE_NO_ELIGIBLE_OPERATION");
  }

  return {
    schemaVersion: payload.schemaVersion,
    contractVersion: payload.contractVersion,
    hostId: payload.hostId,
    screenId: payload.screenId,
    structureVersion: payload.structureVersion,
    structureHash: payload.structureHash,
    constraintHash: payload.constraintHash,
    viewportClass: payload.viewportClass,
    operations,
  };
}
