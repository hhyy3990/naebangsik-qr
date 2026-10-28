import assert from "node:assert/strict";
import { test } from "node:test";
import { universalSha256 } from "./universal-layout-contract";
import { createUniversalLayoutV2Model } from "./universal-layout-contract-v2";
import { createUniversalLayoutV2PlanJsonSchema } from "./universal-layout-generator-v2";
import {
  CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY,
  DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY,
} from "./universal-v2-conformance-fixtures";

const supportedSchemaKeys = new Set([
  "type",
  "additionalProperties",
  "required",
  "properties",
  "items",
  "minItems",
  "maxItems",
  "enum",
  "const",
  "anyOf",
]);

function assertOpenAIStrictSchema(
  value: unknown,
  path = "$",
  root = true,
): asserts value is Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
  const schema = value as Record<string, unknown>;

  for (const key of Object.keys(schema)) {
    assert.ok(supportedSchemaKeys.has(key), `${path} contains unsupported keyword ${key}`);
  }
  if (root) {
    assert.equal(schema.type, "object", "root schema must be an object");
    assert.equal("anyOf" in schema, false, "root schema cannot be anyOf");
  }

  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false, `${path} must set additionalProperties:false`);
    assert.ok(
      schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties),
      `${path}.properties must be an object`,
    );
    assert.ok(Array.isArray(schema.required), `${path}.required must be an array`);
    const propertyNames = Object.keys(schema.properties as Record<string, unknown>).sort();
    assert.deepEqual([...(schema.required as string[])].sort(), propertyNames, `${path} must require every property`);
  }

  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    for (const [name, nested] of Object.entries(schema.properties as Record<string, unknown>)) {
      assertOpenAIStrictSchema(nested, `${path}.properties.${name}`, false);
    }
  }
  if ("items" in schema) assertOpenAIStrictSchema(schema.items, `${path}.items`, false);
  if ("anyOf" in schema) {
    assert.ok(Array.isArray(schema.anyOf) && schema.anyOf.length > 0, `${path}.anyOf must not be empty`);
    for (const [index, nested] of (schema.anyOf as unknown[]).entries()) {
      assertOpenAIStrictSchema(nested, `${path}.anyOf[${index}]`, false);
    }
  }
}

function demoModel() {
  return createUniversalLayoutV2Model(DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY, {
    viewportClass: "regular",
    accessibility: {
      textScale: "standard",
      buttonScale: "standard",
      contrast: "standard",
      viewportMode: null,
    },
    layoutCapabilities: [],
    componentState: [{
      id: "menu.product-list",
      itemCount: 5,
      itemOrderHash: "af0c4a1b243d46755fc31fa279e936f612bf2b3914b293d67e585d6aa5fb091a",
    }],
  });
}

function civilModel() {
  const orderedItemIds = Array.from(
    { length: 18 },
    (_, index) => `civil.certificate.${String(index + 1).padStart(2, "0")}`,
  );
  return createUniversalLayoutV2Model(CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY, {
    viewportClass: "wide",
    accessibility: {
      textScale: "standard",
      buttonScale: "standard",
      contrast: "standard",
      viewportMode: null,
    },
    layoutCapabilities: ["reserved-bottom-controls"],
    componentState: [{
      id: "civil.certificate-grid",
      itemCount: 18,
      itemOrderHash: universalSha256({ orderedItemIds }),
    }],
  });
}

test("DemoCoffee and Civil final OpenAI output schemas satisfy strict structured-output rules", () => {
  const demoSchema = createUniversalLayoutV2PlanJsonSchema(demoModel());
  const civilSchema = createUniversalLayoutV2PlanJsonSchema(civilModel());

  assertOpenAIStrictSchema(demoSchema);
  assertOpenAIStrictSchema(civilSchema);

  const demoItems = (demoSchema.properties.operations as { items: Record<string, unknown> }).items;
  const civilItems = (civilSchema.properties.operations as { items: Record<string, unknown> }).items;
  assert.ok(Array.isArray(demoItems.anyOf));
  assert.ok(Array.isArray(civilItems.anyOf));
});

test("strict schema regression checker rejects oneOf, optional fields, and open objects", () => {
  const generated = createUniversalLayoutV2PlanJsonSchema(demoModel());
  const schema = structuredClone(generated) as Record<string, any>;
  const items = schema.properties.operations.items as Record<string, unknown>;
  items.oneOf = items.anyOf;
  delete items.anyOf;
  assert.throws(() => assertOpenAIStrictSchema(schema), /unsupported keyword oneOf/);

  const optionalField = structuredClone(generated) as Record<string, any>;
  optionalField.required.pop();
  assert.throws(() => assertOpenAIStrictSchema(optionalField), /must require every property/);

  const openObject = structuredClone(generated) as Record<string, any>;
  openObject.properties.operations.items.anyOf[0].additionalProperties = true;
  assert.throws(() => assertOpenAIStrictSchema(openObject), /additionalProperties:false/);
});
