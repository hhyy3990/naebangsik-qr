import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createUniversalLayoutModel,
  universalSha256,
} from "./universal-layout-contract";
import {
  DEMO_COFFEE_UNIVERSAL_MOCK_POLICY,
} from "./universal-layout-mock-policies";
import {
  createUniversalLayoutPlanJsonSchema,
  UNIVERSAL_LAYOUT_SYSTEM_INSTRUCTION,
} from "./universal-layout-generator";
import {
  createUniversalLayoutOpenAIProvider,
  type UniversalLayoutOpenAIClient,
} from "./universal-layout-openai-provider";

test("OpenAI adapter sends only abstract payload with strict JSON schema and storage disabled", async () => {
  const model = createUniversalLayoutModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY, {
    viewportClass: "regular",
    accessibility: {
      textScale: "standard",
      buttonScale: "standard",
      contrast: "standard",
      viewportMode: null,
    },
    componentState: [{
      id: "menu.product-list",
      itemCount: 12,
      itemOrderHash: universalSha256({ source: "private item sequence sentinel" }),
    }],
  });
  const payload = {
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
      allowedColumns: component.allowedColumns,
      operations: component.operations,
      minimumTouchTargetPx: component.minimumTouchTargetPx,
      protectedProperties: component.protectedProperties,
    })),
  };
  let captured: Record<string, unknown> | undefined;
  const client = {
    responses: {
      create: async (args: Record<string, unknown>) => {
        captured = args;
        return { output_text: "{\"test\":\"fake\"}" };
      },
    },
  } as unknown as UniversalLayoutOpenAIClient;
  const provider = createUniversalLayoutOpenAIProvider({ client });
  const result = await provider.generate({
    systemInstruction: UNIVERSAL_LAYOUT_SYSTEM_INSTRUCTION,
    payload,
    responseSchema: createUniversalLayoutPlanJsonSchema(model),
  });

  assert.equal(result, "{\"test\":\"fake\"}");
  assert.ok(captured);
  assert.equal(captured.store, false);
  assert.equal(captured.model, "gpt-4o-mini");
  const text = JSON.stringify(captured);
  assert.equal(text.includes("private item sequence sentinel"), false);
  assert.equal(text.includes("itemOrderHash"), false);
  assert.equal(text.includes("itemCount"), false);
  const textOptions = captured.text as { format: { type: string; strict: boolean; schema: unknown } };
  assert.equal(textOptions.format.type, "json_schema");
  assert.equal(textOptions.format.strict, true);
  assert.deepEqual(
    (textOptions.format.schema as { additionalProperties: boolean }).additionalProperties,
    false,
  );

});

test("OpenAI adapter fails explicitly when no API key or injected client exists", () => {
  assert.throws(
    () => createUniversalLayoutOpenAIProvider({ apiKey: "" }),
    /AI_NOT_CONFIGURED/,
  );
});
