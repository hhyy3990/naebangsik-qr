import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNIVERSAL_LAYOUT_CONTRACT_VERSION,
  UNIVERSAL_LAYOUT_SCHEMA_VERSION,
  canonicalUniversalJson,
  createUniversalLayoutModel,
  universalSha256,
  validateUniversalLayoutModel,
  validateUniversalLayoutPlan,
  type UniversalLayoutModel,
  type UniversalLayoutPlan,
  type UniversalLayoutPolicy,
} from "./universal-layout-contract";
import {
  CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY,
  DEMO_COFFEE_UNIVERSAL_MOCK_POLICY,
  UNIVERSAL_LAYOUT_MOCK_POLICIES,
} from "./universal-layout-mock-policies";

const fixtureHash = (name: string) => universalSha256({ fixture: name });
const policies = UNIVERSAL_LAYOUT_MOCK_POLICIES;
const standardAccessibility = {
  textScale: "standard" as const,
  buttonScale: "standard" as const,
  contrast: "standard" as const,
  viewportMode: null,
};

function modelFor(policy: UniversalLayoutPolicy, viewportClass: "compact" | "regular" | "wide" = "regular") {
  return createUniversalLayoutModel(policy, {
    viewportClass,
    accessibility: standardAccessibility,
    componentState: policy.components.map((component) => ({
      id: component.id,
      itemCount: component.id === "civil.certificate-grid" ? 18 : 12,
      itemOrderHash: fixtureHash(`${component.id}-ordered-fixture-v1`),
    })),
  });
}

function planFor(model: UniversalLayoutModel, targetId: string, columns: number): UniversalLayoutPlan {
  return {
    schemaVersion: UNIVERSAL_LAYOUT_SCHEMA_VERSION,
    contractVersion: UNIVERSAL_LAYOUT_CONTRACT_VERSION,
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    operations: [{ type: "setColumns", targetId, columns }],
  };
}

test("canonical JSON sorts keys, normalizes Unicode and negative zero, preserves array order and null", () => {
  assert.equal(canonicalUniversalJson({ b: -0, a: "e\u0301" }), '{"a":"é","b":0}');
  assert.equal(canonicalUniversalJson({ a: "é", b: 0 }), '{"a":"é","b":0}');
  assert.notEqual(canonicalUniversalJson({ values: [1, 2] }), canonicalUniversalJson({ values: [2, 1] }));
  assert.notEqual(canonicalUniversalJson({ value: null }), canonicalUniversalJson({}));
  assert.throws(() => canonicalUniversalJson({ value: 1.25 }), /CANONICAL_NUMBER_MUST_BE_SAFE_INTEGER/);
});

test("SHA-256 canonical JSON matches a stable golden vector", () => {
  assert.equal(universalSha256({ b: 2, a: "é" }), "06c264c46ad5ada9493abd3aa2383fb205ae99d7d0bad40b03a43bfec8a1b8de");
});

test("one policy validator accepts menu.v2 one- and two-column mock plans", () => {
  const model = validateUniversalLayoutModel(modelFor(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY), policies);
  for (const columns of [1, 2]) {
    assert.doesNotThrow(() =>
      validateUniversalLayoutPlan(planFor(model, "menu.product-list", columns), model, policies),
    );
  }
});

test("civil kiosk fixture uses the same repeated-card-list validator and explicit mock columns", () => {
  const model = validateUniversalLayoutModel(modelFor(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY), policies);
  assert.equal(model.components[0].itemCount, 18);
  assert.deepEqual(model.components[0].allowedColumns, [1, 2]);
  assert.doesNotThrow(() =>
    validateUniversalLayoutPlan(planFor(model, "civil.certificate-grid", 2), model, policies),
  );

  const wideModel = validateUniversalLayoutModel(modelFor(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY, "wide"), policies);
  assert.deepEqual(wideModel.components[0].allowedColumns, [1, 2]);
  assert.equal(wideModel.structureHash, model.structureHash);
  assert.notEqual(wideModel.constraintHash, model.constraintHash);
  assert.doesNotThrow(() =>
    validateUniversalLayoutPlan(planFor(wideModel, "civil.certificate-grid", 2), wideModel, policies),
  );
  assert.throws(() =>
    validateUniversalLayoutPlan(planFor(wideModel, "civil.certificate-grid", 3), wideModel, policies),
    /DISALLOWED_COLUMN_COUNT/,
  );
  const compactModel = validateUniversalLayoutModel(modelFor(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY, "compact"), policies);
  assert.deepEqual(compactModel.components[0].allowedColumns, [1]);
  assert.throws(() =>
    validateUniversalLayoutPlan(planFor(model, "civil.certificate-grid", 3), model, policies),
    /DISALLOWED_COLUMN_COUNT/,
  );
});

test("accessibility policy restricts columns and enforces minimum touch target", () => {
  const largeTextModel = createUniversalLayoutModel(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY, {
    viewportClass: "regular",
    accessibility: { ...standardAccessibility, textScale: "large" },
    componentState: [{ id: "menu.product-list", itemCount: 12, itemOrderHash: fixtureHash("menu-large-text-fixture") }],
  });
  assert.deepEqual(largeTextModel.components[0].allowedColumns, [1]);
  assert.throws(() =>
    validateUniversalLayoutPlan(planFor(largeTextModel, "menu.product-list", 2), largeTextModel, policies),
    /DISALLOWED_COLUMN_COUNT/,
  );
  assert.throws(() => createUniversalLayoutModel({
    ...DEMO_COFFEE_UNIVERSAL_MOCK_POLICY,
    components: [{ ...DEMO_COFFEE_UNIVERSAL_MOCK_POLICY.components[0], minimumTouchTargetPx: 43 }],
  }, {
    viewportClass: "regular",
    accessibility: standardAccessibility,
    componentState: [{ id: "menu.product-list", itemCount: 12, itemOrderHash: fixtureHash("menu-fixture") }],
  }), /POLICY_COMPONENT_INVALID/);
});

test("civil kiosk fixture forces one column for large text, large buttons, high contrast, and bottom viewport", () => {
  const profiles = [
    { ...standardAccessibility, textScale: "large" as const },
    { ...standardAccessibility, buttonScale: "large" as const },
    { ...standardAccessibility, contrast: "high" as const },
    { ...standardAccessibility, viewportMode: { mode: "bottom" as const, heightPercent: 70 as const } },
  ];
  for (const accessibility of profiles) {
    const model = createUniversalLayoutModel(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY, {
      viewportClass: "regular",
      accessibility,
      componentState: [{
        id: "civil.certificate-grid",
        itemCount: 18,
        itemOrderHash: fixtureHash("civil-accessibility-fixture"),
      }],
    });
    assert.deepEqual(model.components[0].allowedColumns, [1]);
    assert.throws(() =>
      validateUniversalLayoutPlan(planFor(model, "civil.certificate-grid", 2), model, policies),
      /DISALLOWED_COLUMN_COUNT/,
    );
  }
});

test("unregistered operations, targets, model mutations, and cross-host plans are rejected", () => {
  const model = modelFor(DEMO_COFFEE_UNIVERSAL_MOCK_POLICY);
  const goodPlan = planFor(model, "menu.product-list", 1);
  assert.throws(() => validateUniversalLayoutPlan({
    ...goodPlan,
    operations: [{ type: "setColumns", targetId: "menu.product-list", columns: 2, order: ["changed"] }],
  }, model, policies));
  assert.throws(() => validateUniversalLayoutPlan({
    ...goodPlan,
    operations: [{ type: "setColumns", targetId: "unknown.component", columns: 1 }],
  }, model, policies), /UNSUPPORTED_PLAN_OPERATION/);
  assert.throws(() => validateUniversalLayoutModel({
    ...model,
    structureHash: "0".repeat(64),
  }, policies), /STRUCTURE_HASH_MISMATCH/);
  const civilModel = modelFor(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY);
  assert.throws(() =>
    validateUniversalLayoutPlan(goodPlan, civilModel, policies),
    /PLAN_MODEL_MISMATCH/,
  );
});

test("the 18-item mock cannot change item count or order through the plan contract", () => {
  const model = modelFor(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY);
  const plan = planFor(model, "civil.certificate-grid", 2);
  assert.equal(model.components[0].itemCount, 18);
  assert.equal(model.components[0].itemOrderHash, fixtureHash("civil.certificate-grid-ordered-fixture-v1"));
  assert.throws(() => validateUniversalLayoutPlan({
    ...plan,
    operations: [{ type: "setColumns", targetId: "civil.certificate-grid", columns: 2, itemCount: 17 }],
  }, model, policies));
  assert.throws(() => validateUniversalLayoutPlan({
    ...plan,
    operations: [{ type: "setOrder", targetId: "civil.certificate-grid", order: [] }],
  }, model, policies));
});
