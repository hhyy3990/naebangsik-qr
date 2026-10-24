import { z } from "zod";
import {
  UNIVERSAL_LAYOUT_CONTRACT_VERSION,
  UNIVERSAL_LAYOUT_SCHEMA_VERSION,
  universalLayoutModelSchema,
} from "./universal-layout-contract";
import type { UniversalLayoutPlanProvider } from "./universal-layout-generator";

export const universalLayoutDevelopmentRequestSchema = z.object({
  model: universalLayoutModelSchema,
}).strict();

/**
 * Deterministic, in-memory provider for the opt-in Development route.
 * It returns the first registered allowed column value and has no network,
 * OpenAI, persistence, or authentication behavior of its own.
 */
export const universalLayoutDevelopmentMockProvider: UniversalLayoutPlanProvider = {
  async generate({ payload }) {
    return {
      schemaVersion: UNIVERSAL_LAYOUT_SCHEMA_VERSION,
      contractVersion: UNIVERSAL_LAYOUT_CONTRACT_VERSION,
      hostId: payload.hostId,
      screenId: payload.screenId,
      structureVersion: payload.structureVersion,
      structureHash: payload.structureHash,
      constraintHash: payload.constraintHash,
      viewportClass: payload.viewportClass,
      operations: payload.components.map((component) => ({
        type: "setColumns",
        targetId: component.id,
        columns: component.allowedColumns[0],
      })),
    };
  },
};
