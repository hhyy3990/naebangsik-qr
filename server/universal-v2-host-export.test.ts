import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNIVERSAL_LAYOUT_V2_MODEL_JSON_SCHEMA,
  UNIVERSAL_LAYOUT_V2_PLAN_JSON_SCHEMA,
  computeUniversalLayoutV2ConstraintHash,
  computeUniversalLayoutV2StructureHash,
  parseUniversalLayoutV2Plan,
  validateUniversalLayoutV2Model,
  validateUniversalLayoutV2Plan,
} from "../universal-v2-contract-export";
import { DEMO_COFFEE_UNIVERSAL_V2_CONFORMANCE_POLICY } from "./universal-v2-conformance-fixtures";

test("exported DemoCoffee compact-grid fixture matches the central v2 model and plan validator", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("../universal-v2-valid-fixtures.json", import.meta.url), "utf8"),
  ) as { model: unknown; plan: unknown };
  const model = validateUniversalLayoutV2Model(
    fixture.model,
    [DEMO_COFFEE_UNIVERSAL_V2_CONFORMANCE_POLICY],
  );
  const plan = parseUniversalLayoutV2Plan(fixture.plan);

  assert.deepEqual(
    validateUniversalLayoutV2Plan(
      plan,
      model,
      [DEMO_COFFEE_UNIVERSAL_V2_CONFORMANCE_POLICY],
    ),
    plan,
  );
  assert.equal(
    computeUniversalLayoutV2StructureHash(model),
    model.structureHash,
  );
  assert.equal(
    computeUniversalLayoutV2ConstraintHash(model),
    model.constraintHash,
  );
  assert.equal(plan.operations[0].type, "selectLayoutOption");
  if (plan.operations[0].type === "selectLayoutOption") {
    assert.equal(plan.operations[0].optionId, "compact-grid");
  }
});

test("exported JSON Schemas are generated from the same strict central Zod schemas", () => {
  assert.equal(UNIVERSAL_LAYOUT_V2_MODEL_JSON_SCHEMA.type, "object");
  assert.equal(UNIVERSAL_LAYOUT_V2_MODEL_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual(UNIVERSAL_LAYOUT_V2_MODEL_JSON_SCHEMA.required, [
    "schemaVersion", "contractVersion", "hostId", "screenId", "structureVersion",
    "structureHash", "constraintHash", "viewportClass", "accessibility",
    "layoutCapabilities", "components", "allowedOperations",
  ]);
  assert.equal(UNIVERSAL_LAYOUT_V2_PLAN_JSON_SCHEMA.type, "object");
  assert.equal(UNIVERSAL_LAYOUT_V2_PLAN_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual(UNIVERSAL_LAYOUT_V2_PLAN_JSON_SCHEMA.required, [
    "schemaVersion", "contractVersion", "hostId", "screenId", "structureVersion",
    "structureHash", "constraintHash", "viewportClass", "operations",
  ]);
});
