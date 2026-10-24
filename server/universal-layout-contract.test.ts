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

test("civil kiosk nine golden vectors are independently reproduced by the shared Universal v1 hashing code", () => {
  const orderedItemIds = Array.from(
    { length: 18 },
    (_, index) => `civil.certificate.${String(index + 1).padStart(2, "0")}`,
  );
  const itemOrderHash = universalSha256({ orderedItemIds });
  assert.equal(itemOrderHash, "1f984cacde0e9014a80a73b90f15ea8a2ca3002ee5a1a65b737cd8fe11e9342c");

  const vectors: {
    name: string;
    viewportClass: "compact" | "regular" | "wide";
    accessibility: typeof standardAccessibility | {
      textScale: "large";
      buttonScale: "standard";
      contrast: "standard";
      viewportMode: null;
    } | {
      textScale: "standard";
      buttonScale: "large";
      contrast: "standard";
      viewportMode: null;
    } | {
      textScale: "standard";
      buttonScale: "standard";
      contrast: "high";
      viewportMode: null;
    } | {
      textScale: "standard";
      buttonScale: "standard";
      contrast: "standard";
      viewportMode: { mode: "bottom"; heightPercent: 80 };
    };
    allowedColumns: number[];
    constraintHash: string;
    bottomControls?: boolean;
  }[] = [
    { name: "320px standard", viewportClass: "compact", accessibility: standardAccessibility, allowedColumns: [1], constraintHash: "adb813aa6fb8276e2dfe63188e7a169e5d38395eac11c8312e43aad5496ef1d5" },
    { name: "360px standard", viewportClass: "compact", accessibility: standardAccessibility, allowedColumns: [1], constraintHash: "adb813aa6fb8276e2dfe63188e7a169e5d38395eac11c8312e43aad5496ef1d5" },
    { name: "390px standard", viewportClass: "regular", accessibility: standardAccessibility, allowedColumns: [1, 2], constraintHash: "d18ee30970e42458e830b1add156184eb862d14c10633a44aa22ab1f41213b2a" },
    { name: "1080px standard", viewportClass: "wide", accessibility: standardAccessibility, allowedColumns: [1, 2], constraintHash: "1b771f4cd9c43c7311cd95c27eb316aa96909cda355d13dc7c6cc24940a44463" },
    { name: "390px large text", viewportClass: "regular", accessibility: { ...standardAccessibility, textScale: "large" }, allowedColumns: [1], constraintHash: "2cd8c25f2b197832d1b6d9cba75a9e4bd28fdf6742e896bc1ba3a048aff008af" },
    { name: "390px large button", viewportClass: "regular", accessibility: { ...standardAccessibility, buttonScale: "large" }, allowedColumns: [1], constraintHash: "32b8db345f531bbf63728d7270d70133b35a079a8067d92d2a12f28500d500bc" },
    { name: "390px high contrast", viewportClass: "regular", accessibility: { ...standardAccessibility, contrast: "high" }, allowedColumns: [1], constraintHash: "1fbc74335278dc9bdeaded6b953b2802f641301c3a8fab1d9a236f0bb60921c2" },
    { name: "390px bottom viewport", viewportClass: "regular", accessibility: { ...standardAccessibility, viewportMode: { mode: "bottom", heightPercent: 80 } }, allowedColumns: [1], constraintHash: "abce520b55c6e47350afe6317646109afef0fba7a400c1eb12de17ff15e7fc54" },
    { name: "390px bottom controls (host-local policy)", viewportClass: "regular", accessibility: standardAccessibility, allowedColumns: [1], constraintHash: "cbe6a636f748e176e38529d5211f262b307fa1de3351a54efdea91974d634ef1", bottomControls: true },
  ];

  for (const vector of vectors) {
    const policy: UniversalLayoutPolicy = vector.bottomControls
      ? {
          ...CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY,
          components: CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY.components.map((component) => ({
            ...component,
            allowedColumnsByViewport: { ...component.allowedColumnsByViewport, regular: [1] },
          })),
        }
      : CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY;
    const model = createUniversalLayoutModel(policy, {
      viewportClass: vector.viewportClass,
      accessibility: vector.accessibility,
      componentState: [{ id: "civil.certificate-grid", itemCount: 18, itemOrderHash }],
    });

    assert.equal(model.schemaVersion, 1, vector.name);
    assert.equal(model.contractVersion, "universal-layout.v1", vector.name);
    assert.equal(model.hostId, "civil-kiosk-mock", vector.name);
    assert.equal(model.screenId, "civil.main-menu", vector.name);
    assert.equal(model.structureVersion, "civil-main-mock.v1", vector.name);
    assert.equal(model.components[0].id, "civil.certificate-grid", vector.name);
    assert.deepEqual(model.components[0].allowedColumns, vector.allowedColumns, vector.name);
    assert.equal(model.structureHash, "70dbb9c683297736d73f982a88c107394d7c643385a653c4c3480723a1a2419b", vector.name);
    assert.equal(model.constraintHash, vector.constraintHash, vector.name);

    if (vector.bottomControls) {
      const hostPolicyModel = validateUniversalLayoutModel(model, [policy]);
      assert.doesNotThrow(() =>
        validateUniversalLayoutPlan(planFor(hostPolicyModel, "civil.certificate-grid", 1), hostPolicyModel, [policy]),
      );
      assert.throws(() =>
        validateUniversalLayoutPlan(planFor(hostPolicyModel, "civil.certificate-grid", 2), hostPolicyModel, [policy]),
        /DISALLOWED_COLUMN_COUNT/,
      );
      assert.throws(
        () => validateUniversalLayoutModel(model, policies),
        /COMPONENT_POLICY_MISMATCH/,
        "central registry has no separate bottomControls policy",
      );
    } else {
      const registeredModel = validateUniversalLayoutModel(model, policies);
      assert.doesNotThrow(() =>
        validateUniversalLayoutPlan(planFor(registeredModel, "civil.certificate-grid", 1), registeredModel, policies),
      );
      if (vector.allowedColumns.includes(2)) {
        assert.doesNotThrow(() =>
          validateUniversalLayoutPlan(planFor(registeredModel, "civil.certificate-grid", 2), registeredModel, policies),
        );
      } else {
        assert.throws(() =>
          validateUniversalLayoutPlan(planFor(registeredModel, "civil.certificate-grid", 2), registeredModel, policies),
          /DISALLOWED_COLUMN_COUNT/,
        );
      }
    }
  }
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
  assert.throws(() => validateUniversalLayoutModel({
    ...model,
    constraintHash: "0".repeat(64),
  }, policies), /CONSTRAINT_HASH_MISMATCH/);
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
