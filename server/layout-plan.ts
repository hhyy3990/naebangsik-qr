import { createHash } from "node:crypto";
import { z } from "zod";

export const layoutOperationNames = [
  "set_flow",
  "set_alignment",
  "set_gap",
  "set_columns",
  "set_media_position",
  "set_space_ratio",
] as const;

const elementSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(["container", "item", "image", "text", "button", "badge", "price", "fixed-control"]),
  groupId: z.string().min(1).max(80).nullable(),
  order: z.number().int().min(0).max(500),
  kind: z.enum(["content", "fixed", "interactive"]),
}).strict();

const constraintsSchema = z.object({
  textSize: z.enum(["standard", "large", "extraLarge"]),
  buttonSize: z.enum(["standard", "large"]),
  contrast: z.enum(["standard", "high"]),
  viewportMode: z.union([
    z.null(),
    z.object({
      mode: z.literal("bottom"),
      heightPercent: z.union([z.literal(60), z.literal(70), z.literal(80)]),
    }).strict(),
  ]),
}).strict();

export const layoutPlanRequestSchema = z.object({
  modelVersion: z.literal("1"),
  hostAppId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  screenId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  structureVersion: z.string().min(1).max(64),
  structureHash: z.string().regex(/^[a-f0-9]{64}$/),
  viewport: z.enum(["compact", "standard", "large"]),
  availableArea: z.object({
    widthBucket: z.enum(["narrow", "regular", "wide"]),
    heightBucket: z.enum(["short", "regular", "tall"]),
  }).strict(),
  elements: z.array(elementSchema).min(1).max(100),
  constraints: constraintsSchema,
}).strict();

export type LayoutPlanRequest = z.infer<typeof layoutPlanRequestSchema>;
export type LayoutOperationName = (typeof layoutOperationNames)[number];
export type LayoutPlanOperation = {
  operation: LayoutOperationName;
  targetId: string;
  value: string | number;
};

export type LayoutPlan = {
  schemaVersion: 1;
  screenId: string;
  structureVersion: string;
  structureHash: string;
  operations: LayoutPlanOperation[];
  reasonCode: "readability" | "touch_targets" | "space_use" | "balanced";
};

export type LayoutOperationPolicy = {
  operation: LayoutOperationName;
  targetIds: readonly string[];
  allowedValues?: readonly string[];
  min?: number;
  max?: number;
};

export type LayoutPolicy = {
  hostAppId: string;
  screenId: string;
  modelVersion: "1";
  structureVersion: string;
  elementIds: readonly string[];
  requiredElementIds: readonly string[];
  mutableTargetIds: readonly string[];
  immutableElementIds: readonly string[];
  operations: readonly LayoutOperationPolicy[];
};

export type LayoutPlanGenerator = (
  input: LayoutPlanRequest,
  policy: LayoutPolicy,
) => Promise<LayoutPlan>;

const operationSchema = z.object({
  operation: z.enum(layoutOperationNames),
  targetId: z.string().min(1).max(80),
  value: z.union([z.string().max(32), z.number().int().min(1).max(6)]),
}).strict();

const outputSchema = z.object({
  schemaVersion: z.literal(1),
  screenId: z.string().min(1).max(64),
  structureVersion: z.string().min(1).max(64),
  structureHash: z.string().regex(/^[a-f0-9]{64}$/),
  operations: z.array(operationSchema).min(1).max(20),
  reasonCode: z.enum(["readability", "touch_targets", "space_use", "balanced"]),
}).strict();

export function computeLayoutStructureHash(
  value: Pick<LayoutPlanRequest, "modelVersion" | "hostAppId" | "screenId" | "structureVersion" | "elements">,
) {
  const canonical = {
    modelVersion: value.modelVersion,
    hostAppId: value.hostAppId,
    screenId: value.screenId,
    structureVersion: value.structureVersion,
    elements: [...value.elements]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map(({ id, role, groupId, order, kind }) => ({ id, role, groupId, order, kind })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function validateLayoutPlanRequest(
  value: unknown,
  policies: readonly LayoutPolicy[],
): LayoutPlanRequest {
  const input = layoutPlanRequestSchema.parse(value);
  const ids = input.elements.map(({ id }) => id);
  const orders = input.elements.map(({ order }) => order);
  if (new Set(ids).size !== ids.length || new Set(orders).size !== orders.length) {
    throw new Error("DUPLICATE_LAYOUT_ELEMENT");
  }
  if (computeLayoutStructureHash(input) !== input.structureHash) {
    throw new Error("STRUCTURE_HASH_MISMATCH");
  }

  const policy = policies.find(
    (item) => item.hostAppId === input.hostAppId && item.screenId === input.screenId,
  );
  if (!policy) throw new Error("UNSUPPORTED_SCREEN");
  if (policy.modelVersion !== input.modelVersion || policy.structureVersion !== input.structureVersion) {
    throw new Error("UNSUPPORTED_STRUCTURE_VERSION");
  }
  const allowedIds = new Set(policy.elementIds);
  if (ids.some((id) => !allowedIds.has(id))) throw new Error("UNREGISTERED_ELEMENT");
  if (input.elements.some((element) =>
    element.groupId !== null &&
    (!allowedIds.has(element.groupId) || element.groupId === element.id)
  )) {
    throw new Error("UNREGISTERED_ELEMENT_GROUP");
  }
  if (policy.requiredElementIds.some((id) => !ids.includes(id))) {
    throw new Error("REQUIRED_ELEMENT_MISSING");
  }
  const immutableIds = new Set(policy.immutableElementIds);
  if (input.elements.some((element) =>
    immutableIds.has(element.id) !== (element.kind === "fixed"),
  )) {
    throw new Error("IMMUTABLE_ELEMENT_MISMATCH");
  }
  return input;
}

export function validateLayoutPlan(
  value: unknown,
  input: LayoutPlanRequest,
  policy: LayoutPolicy,
): LayoutPlan {
  const plan = outputSchema.parse(value);
  if (
    plan.screenId !== input.screenId ||
    plan.structureVersion !== input.structureVersion ||
    plan.structureHash !== input.structureHash
  ) {
    throw new Error("PLAN_STRUCTURE_MISMATCH");
  }
  const seen = new Set<string>();
  const inputIds = new Set(input.elements.map(({ id }) => id));
  const mutableTargets = new Set(policy.mutableTargetIds);
  const immutableIds = new Set(policy.immutableElementIds);
  for (const operation of plan.operations) {
    const key = `${operation.operation}:${operation.targetId}`;
    if (seen.has(key)) throw new Error("DUPLICATE_LAYOUT_OPERATION");
    seen.add(key);
    if (!mutableTargets.has(operation.targetId) || immutableIds.has(operation.targetId)) {
      throw new Error("IMMUTABLE_LAYOUT_TARGET");
    }
    if (!inputIds.has(operation.targetId)) throw new Error("UNKNOWN_LAYOUT_TARGET");
    const operationPolicy = policy.operations.find(
      (item) => item.operation === operation.operation && item.targetIds.includes(operation.targetId),
    );
    if (!operationPolicy) throw new Error("UNSUPPORTED_LAYOUT_OPERATION");
    if (typeof operation.value === "string") {
      if (!operationPolicy.allowedValues?.includes(operation.value)) {
        throw new Error("LAYOUT_VALUE_OUT_OF_RANGE");
      }
    } else if (
      operationPolicy.min === undefined ||
      operationPolicy.max === undefined ||
      operation.value < operationPolicy.min ||
      operation.value > operationPolicy.max
    ) {
      throw new Error("LAYOUT_VALUE_OUT_OF_RANGE");
    }
  }
  return plan;
}
