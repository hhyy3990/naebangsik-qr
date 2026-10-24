import { z } from "zod";
import OpenAI from "openai";

const structure = [
  "menu.v2",
  "menu.product-list:ordered-repeated-items:menu.product-card;mutable:columns;preserve:items,order",
  "menu.product-card:repeated-item:menu.product-image,menu.product-information;mutable:flow,gap;preserve:child-order",
  "menu.product-information:menu.product-name,menu.product-price,menu.product-description,menu.product-action",
  "dom-binding:data-menu-layout-id",
  "protected:menu.category-navigation,menu.fixed-controls,menu.product-content,menu.product-action.behavior",
  "operations:setGroupColumns,setGroupFlow,setChildBasis",
].join("|");

export function demoMenuHash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export const DEMO_MENU_STRUCTURE_HASH = demoMenuHash(structure);
export const DEMO_MENU_POLICY = Object.freeze({
  hostId: "democoffee" as const,
  screenId: "cafe.menu" as const,
  schemaVersion: 2 as const,
  structureVersion: "menu.v2" as const,
  structureHash: DEMO_MENU_STRUCTURE_HASH,
  groupIds: ["menu.product-list", "menu.product-card", "menu.product-information"] as const,
  requiredIds: ["menu.category-navigation", "menu.product-list", "menu.fixed-controls", "menu.product-action"] as const,
  operationTypes: ["setGroupColumns", "setGroupFlow", "setChildBasis"] as const,
});

const constraintsSchema = z.object({
  textScale: z.enum(["standard", "large", "extraLarge"]),
  buttonScale: z.enum(["standard", "large"]),
  highContrast: z.boolean(),
  viewportModePercent: z.union([z.null(), z.literal(60), z.literal(70), z.literal(80)]),
  defaultColumns: z.union([z.literal(1), z.literal(2)]),
  allowedColumns: z.array(z.union([z.literal(1), z.literal(2)])).min(1).max(2),
  minimumTouchTargetPx: z.literal(44),
  preserveTopGuidance: z.literal(true),
  preserveFixedControls: z.literal(true),
}).strict();

const groupsSchema = z.array(z.object({
  id: z.string(),
  role: z.string(),
  childIds: z.array(z.string()),
  preserveOrder: z.boolean(),
  mutableProperties: z.array(z.string()),
}).strict()).length(3);

export const demoMenuModelSchema = z.object({
  schemaVersion: z.literal(2),
  hostId: z.literal("democoffee"),
  screenId: z.literal("cafe.menu"),
  structureVersion: z.literal("menu.v2"),
  structureHash: z.string().regex(/^[a-f0-9]{8}$/),
  constraintHash: z.string().regex(/^[a-f0-9]{8}$/),
  viewportClass: z.enum(["compact", "regular"]),
  groups: groupsSchema,
  requiredIds: z.array(z.string()),
  protectedProperties: z.array(z.string()),
  allowedOperations: z.array(z.enum(["setGroupColumns", "setGroupFlow", "setChildBasis"])),
  constraints: constraintsSchema,
}).strict();

export type DemoMenuModel = z.infer<typeof demoMenuModelSchema>;

const expectedGroups = [
  { id: "menu.product-list", role: "ordered-menu-list", childIds: ["menu.product-card"], preserveOrder: true, mutableProperties: ["columns"] },
  { id: "menu.product-card", role: "repeated-menu-item", childIds: ["menu.product-image", "menu.product-information"], preserveOrder: true, mutableProperties: ["flow", "gap"] },
  { id: "menu.product-information", role: "product-information", childIds: ["menu.product-name", "menu.product-price", "menu.product-description", "menu.product-action"], preserveOrder: true, mutableProperties: [] },
];
const requiredIds = ["menu.category-navigation", "menu.product-list", "menu.fixed-controls", "menu.product-action"];
const protectedProperties = ["menu.product-list.items", "menu.product-list.order", "menu.category-navigation", "menu.fixed-controls", "menu.product-content", "menu.product-action.behavior"];
const allowedOperations = ["setGroupColumns", "setGroupFlow", "setChildBasis"];

export type DemoMenuOperation =
  | { type: "setGroupColumns"; targetId: "menu.product-list"; columns: 1 | 2 }
  | { type: "setGroupFlow"; targetId: "menu.product-card"; direction: "row"; gapPx: number }
  | { type: "setChildBasis"; targetId: "menu.product-image"; basisPercent: number; minPx: number };

export type DemoMenuPlan = {
  schemaVersion: 2;
  screenId: "cafe.menu";
  structureHash: string;
  constraintHash: string;
  viewportClass: "compact" | "regular";
  operations: DemoMenuOperation[];
};

const exact = (actual: unknown, expected: unknown) => JSON.stringify(actual) === JSON.stringify(expected);

export function validateDemoMenuModel(value: unknown): DemoMenuModel {
  const model = demoMenuModelSchema.parse(value);
  if (DEMO_MENU_STRUCTURE_HASH !== "837f86b3" ||
      model.structureHash !== DEMO_MENU_POLICY.structureHash ||
      model.hostId !== DEMO_MENU_POLICY.hostId ||
      model.screenId !== DEMO_MENU_POLICY.screenId ||
      model.structureVersion !== DEMO_MENU_POLICY.structureVersion) {
    throw new Error("STRUCTURE_HASH_MISMATCH");
  }
  if (model.constraintHash !== demoMenuHash(JSON.stringify(model.constraints))) {
    throw new Error("CONSTRAINT_HASH_MISMATCH");
  }
  if (!exact(model.groups, expectedGroups) ||
      !exact(model.requiredIds, requiredIds) ||
      !exact(model.protectedProperties, protectedProperties) ||
      !exact(model.allowedOperations, allowedOperations)) {
    throw new Error("UNSUPPORTED_MENU_MODEL");
  }

  const { constraints, viewportClass } = model;
  const accessibilityForcesSingleColumn =
    (viewportClass === "compact" || constraints.textScale !== "standard" || constraints.buttonScale === "large");
  const expectedColumns: number[] = accessibilityForcesSingleColumn ? [1] : [1, 2];
  const expectedDefault = expectedColumns.includes(2) ? 2 : 1;
  if (!exact(constraints.allowedColumns, expectedColumns) || constraints.defaultColumns !== expectedDefault) {
    throw new Error("INVALID_MENU_COLUMN_CONSTRAINTS");
  }
  return model;
}

const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setGroupColumns"), targetId: z.literal("menu.product-list"), columns: z.union([z.literal(1), z.literal(2)]) }).strict(),
  z.object({ type: z.literal("setGroupFlow"), targetId: z.literal("menu.product-card"), direction: z.literal("row"), gapPx: z.number().finite().min(8).max(20) }).strict(),
  z.object({ type: z.literal("setChildBasis"), targetId: z.literal("menu.product-image"), basisPercent: z.number().finite().min(20).max(30), minPx: z.number().finite().min(72).max(96) }).strict(),
]);

const planSchema = z.object({
  schemaVersion: z.literal(2),
  screenId: z.literal("cafe.menu"),
  structureHash: z.string().regex(/^[a-f0-9]{8}$/),
  constraintHash: z.string().regex(/^[a-f0-9]{8}$/),
  viewportClass: z.enum(["compact", "regular"]),
  operations: z.array(operationSchema).min(1).max(3),
}).strict();

export function validateDemoMenuPlan(value: unknown, model: DemoMenuModel): DemoMenuPlan {
  const plan = planSchema.parse(value);
  if (plan.screenId !== model.screenId ||
      plan.structureHash !== model.structureHash ||
      plan.constraintHash !== model.constraintHash ||
      plan.viewportClass !== model.viewportClass) {
    throw new Error("PLAN_MODEL_MISMATCH");
  }
  const order = { setGroupColumns: 0, setGroupFlow: 1, setChildBasis: 2 } as const;
  const positions = plan.operations.map((operation) => order[operation.type]);
  if (new Set(positions).size !== positions.length ||
      positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    throw new Error("INVALID_OPERATION_ORDER_OR_DUPLICATE");
  }
  const flow = plan.operations.some((operation) => operation.type === "setGroupFlow");
  const basis = plan.operations.some((operation) => operation.type === "setChildBasis");
  if (flow !== basis) throw new Error("INCOMPLETE_CARD_LAYOUT");
  const columns = plan.operations.find((operation) => operation.type === "setGroupColumns");
  const effectiveColumns = columns?.type === "setGroupColumns" ? columns.columns : model.constraints.defaultColumns;
  if (columns?.type === "setGroupColumns" && !model.constraints.allowedColumns.includes(columns.columns)) {
    throw new Error("DISALLOWED_COLUMN_COUNT");
  }
  if (flow && effectiveColumns !== 1) throw new Error("CARD_LAYOUT_REQUIRES_SINGLE_COLUMN");
  return plan;
}

export async function generateDemoMenuPlan(
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
): Promise<DemoMenuPlan> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!client && !apiKey) throw new Error("AI_NOT_CONFIGURED");
  const openai = client ?? new OpenAI({ apiKey, timeout: 18_000, maxRetries: 0 });
  onDiagnostic?.("openai_attempt");
  let response;
  try {
    response = await openai.responses.create({
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    store: false,
    max_output_tokens: 700,
    input: [
      { role: "system", content: "Return only a safe DemoCoffee menu v2 layout plan. Follow the validated model's allowedColumns, preserve product content/order/actions/fixed controls, and obey operation pairing/order. setGroupFlow and setChildBasis must either both be present or both be absent. If both are present, explicitly include setGroupColumns with columns: 1. A plan with 2 effective columns must include neither setGroupFlow nor setChildBasis. If setGroupColumns is omitted, use the model's defaultColumns as the effective count. When allowedColumns includes both 1 and 2, either choice is valid; do not always force 1 column. Never generate code." },
      { role: "user", content: JSON.stringify(model) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "democoffee_menu_layout_v2",
        strict: true,
        schema: {
          type: "object", additionalProperties: false,
          required: ["schemaVersion", "screenId", "structureHash", "constraintHash", "viewportClass", "operations"],
          properties: {
            schemaVersion: { type: "integer", enum: [2] },
            screenId: { type: "string", enum: ["cafe.menu"] },
            structureHash: { type: "string", enum: [model.structureHash] },
            constraintHash: { type: "string", enum: [model.constraintHash] },
            viewportClass: { type: "string", enum: [model.viewportClass] },
            operations: {
              type: "array", minItems: 1, maxItems: 3,
              items: {
                anyOf: [
                  {
                    type: "object", additionalProperties: false,
                    required: ["type", "targetId", "columns"],
                    properties: {
                      type: { type: "string", enum: ["setGroupColumns"] },
                      targetId: { type: "string", enum: ["menu.product-list"] },
                      columns: { type: "integer", enum: model.constraints.allowedColumns },
                    },
                  },
                  {
                    type: "object", additionalProperties: false,
                    required: ["type", "targetId", "direction", "gapPx"],
                    properties: {
                      type: { type: "string", enum: ["setGroupFlow"] },
                      targetId: { type: "string", enum: ["menu.product-card"] },
                      direction: { type: "string", enum: ["row"] },
                      gapPx: { type: "number", minimum: 8, maximum: 20 },
                    },
                  },
                  {
                    type: "object", additionalProperties: false,
                    required: ["type", "targetId", "basisPercent", "minPx"],
                    properties: {
                      type: { type: "string", enum: ["setChildBasis"] },
                      targetId: { type: "string", enum: ["menu.product-image"] },
                      basisPercent: { type: "number", minimum: 20, maximum: 30 },
                      minPx: { type: "number", minimum: 72, maximum: 96 },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    });
  } catch (error) {
    if (error instanceof Error && /timeout/i.test(error.name)) onDiagnostic?.("openai_timeout");
    throw error;
  }
  onDiagnostic?.("openai_response");
  if (!response.output_text) throw new Error("EMPTY_AI_LAYOUT_RESPONSE");
  onDiagnostic?.("json_parse_started");
  const parsed = JSON.parse(response.output_text);
  onDiagnostic?.("json_parsed");
  onDiagnostic?.("plan_validation_started");
  const plan = validateDemoMenuPlan(parsed, model);
  onDiagnostic?.("plan_validated");
  return plan;
}
