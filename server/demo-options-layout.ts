import { z } from "zod";
import OpenAI from "openai";

const structure = [
  "options.v1",
  "screen:cafe.product-options",
  "group:options.selection-buttons:option-button-group;mutable:columns;preserve:items,order,selection",
  "protected:option.items,option.order,option.names,option.selection,option.requiredness,option.additionalPrice,quantity,cart,order,payment,navigation",
  "operations:setGroupColumns",
].join("|");

export function demoOptionsHash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export const DEMO_OPTIONS_GROUP_ID = "options.selection-buttons" as const;
export const DEMO_OPTIONS_STRUCTURE_HASH = demoOptionsHash(structure);
export const DEMO_OPTIONS_POLICY = Object.freeze({
  hostId: "democoffee" as const,
  screenId: "cafe.product-options" as const,
  schemaVersion: 1 as const,
  structureVersion: "options.v1" as const,
  structureHash: DEMO_OPTIONS_STRUCTURE_HASH,
  groupIds: [DEMO_OPTIONS_GROUP_ID] as const,
  operationTypes: ["setGroupColumns"] as const,
});

const constraintsSchema = z.object({
  textScale: z.enum(["standard", "large", "extraLarge"]),
  buttonScale: z.enum(["standard", "large"]),
  defaultColumns: z.union([z.literal(1), z.literal(2)]),
  allowedColumns: z.array(z.union([z.literal(1), z.literal(2)])).min(1).max(2),
}).strict();

const groupsSchema = z.array(z.object({
  id: z.literal(DEMO_OPTIONS_GROUP_ID),
  role: z.literal("option-button-group"),
  mutableProperties: z.tuple([z.literal("columns")]),
}).strict()).length(1);

export const demoOptionsModelSchema = z.object({
  schemaVersion: z.literal(1),
  hostId: z.literal("democoffee"),
  screenId: z.literal("cafe.product-options"),
  structureVersion: z.literal("options.v1"),
  structureHash: z.string().regex(/^[a-f0-9]{8}$/),
  constraintHash: z.string().regex(/^[a-f0-9]{8}$/),
  viewportClass: z.enum(["compact", "regular"]),
  groups: groupsSchema,
  requiredIds: z.tuple([z.literal(DEMO_OPTIONS_GROUP_ID)]),
  protectedProperties: z.tuple([
    z.literal("option.items"),
    z.literal("option.order"),
    z.literal("option.names"),
    z.literal("option.selection"),
    z.literal("option.requiredness"),
    z.literal("option.additionalPrice"),
    z.literal("quantity"),
    z.literal("cart"),
    z.literal("order"),
    z.literal("payment"),
    z.literal("navigation"),
  ]),
  allowedOperations: z.tuple([z.literal("setGroupColumns")]),
  constraints: constraintsSchema,
}).strict();

export type DemoOptionsModel = z.infer<typeof demoOptionsModelSchema>;

const expectedGroups = [{
  id: DEMO_OPTIONS_GROUP_ID,
  role: "option-button-group",
  mutableProperties: ["columns"],
}];
const requiredIds = [DEMO_OPTIONS_GROUP_ID];
const protectedProperties = [
  "option.items",
  "option.order",
  "option.names",
  "option.selection",
  "option.requiredness",
  "option.additionalPrice",
  "quantity",
  "cart",
  "order",
  "payment",
  "navigation",
];
const allowedOperations = ["setGroupColumns"];
const exact = (actual: unknown, expected: unknown) => JSON.stringify(actual) === JSON.stringify(expected);

export function validateDemoOptionsModel(value: unknown): DemoOptionsModel {
  const model = demoOptionsModelSchema.parse(value);
  if (
    model.structureHash !== DEMO_OPTIONS_POLICY.structureHash ||
    model.hostId !== DEMO_OPTIONS_POLICY.hostId ||
    model.screenId !== DEMO_OPTIONS_POLICY.screenId ||
    model.structureVersion !== DEMO_OPTIONS_POLICY.structureVersion
  ) {
    throw new Error("OPTIONS_STRUCTURE_HASH_MISMATCH");
  }
  if (model.constraintHash !== demoOptionsHash(JSON.stringify(model.constraints))) {
    throw new Error("OPTIONS_CONSTRAINT_HASH_MISMATCH");
  }
  if (
    !exact(model.groups, expectedGroups) ||
    !exact(model.requiredIds, requiredIds) ||
    !exact(model.protectedProperties, protectedProperties) ||
    !exact(model.allowedOperations, allowedOperations)
  ) {
    throw new Error("UNSUPPORTED_OPTIONS_MODEL");
  }

  const forcesSingleColumn =
    model.viewportClass === "compact" ||
    model.constraints.textScale !== "standard" ||
    model.constraints.buttonScale === "large";
  const expectedColumns: number[] = forcesSingleColumn ? [1] : [1, 2];
  const expectedDefault = expectedColumns.includes(2) ? 2 : 1;
  if (
    !exact(model.constraints.allowedColumns, expectedColumns) ||
    model.constraints.defaultColumns !== expectedDefault
  ) {
    throw new Error("INVALID_OPTIONS_COLUMN_CONSTRAINTS");
  }
  return model;
}

const operationSchema = z.object({
  type: z.literal("setGroupColumns"),
  targetId: z.literal(DEMO_OPTIONS_GROUP_ID),
  columns: z.union([z.literal(1), z.literal(2)]),
}).strict();

const planSchema = z.object({
  schemaVersion: z.literal(1),
  screenId: z.literal("cafe.product-options"),
  structureHash: z.string().regex(/^[a-f0-9]{8}$/),
  constraintHash: z.string().regex(/^[a-f0-9]{8}$/),
  viewportClass: z.enum(["compact", "regular"]),
  operations: z.array(operationSchema).length(1),
}).strict();

export type DemoOptionsPlan = z.infer<typeof planSchema>;

export function validateDemoOptionsPlan(value: unknown, model: DemoOptionsModel): DemoOptionsPlan {
  const plan = planSchema.parse(value);
  if (
    plan.screenId !== model.screenId ||
    plan.structureHash !== model.structureHash ||
    plan.constraintHash !== model.constraintHash ||
    plan.viewportClass !== model.viewportClass
  ) {
    throw new Error("OPTIONS_PLAN_MODEL_MISMATCH");
  }
  if (!model.constraints.allowedColumns.includes(plan.operations[0].columns)) {
    throw new Error("DISALLOWED_OPTION_COLUMN_COUNT");
  }
  return plan;
}

export async function generateDemoOptionsPlan(
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
): Promise<DemoOptionsPlan> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!client && !apiKey) throw new Error("AI_NOT_CONFIGURED");
  const openai = client ?? new OpenAI({ apiKey, timeout: 18_000, maxRetries: 0 });
  onDiagnostic?.("openai_attempt");

  let response;
  try {
    response = await openai.responses.create({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      store: false,
      max_output_tokens: 400,
      input: [
        {
          role: "system",
          content: "Return only a safe DemoCoffee product-options v1 layout plan. Choose only the allowed column count for the option button group. Preserve option items, their order and names, selection state, requiredness, additional prices, quantity, cart, order, payment, and navigation behavior. Never generate operations that modify those values or target any other group. Follow the validated model's allowedColumns and viewport/accessibility constraints; do not infer or change option content. Never generate code.",
        },
        { role: "user", content: JSON.stringify(model) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "democoffee_product_options_layout_v1",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["schemaVersion", "screenId", "structureHash", "constraintHash", "viewportClass", "operations"],
            properties: {
              schemaVersion: { type: "integer", enum: [1] },
              screenId: { type: "string", enum: ["cafe.product-options"] },
              structureHash: { type: "string", enum: [model.structureHash] },
              constraintHash: { type: "string", enum: [model.constraintHash] },
              viewportClass: { type: "string", enum: [model.viewportClass] },
              operations: {
                type: "array",
                minItems: 1,
                maxItems: 1,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "targetId", "columns"],
                  properties: {
                    type: { type: "string", enum: ["setGroupColumns"] },
                    targetId: { type: "string", enum: [DEMO_OPTIONS_GROUP_ID] },
                    columns: { type: "integer", enum: model.constraints.allowedColumns },
                  },
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
  const parsed: unknown = JSON.parse(response.output_text);
  onDiagnostic?.("json_parsed");
  onDiagnostic?.("plan_validation_started");
  const plan = validateDemoOptionsPlan(parsed, model);
  onDiagnostic?.("plan_validated");
  return plan;
}
