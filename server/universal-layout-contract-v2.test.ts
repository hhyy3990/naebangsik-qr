import { test } from "node:test";
import assert from "node:assert/strict";
import { createUniversalLayoutModel, universalSha256 } from "./universal-layout-contract";
import {
  UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION,
  UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION,
  UniversalLayoutV2ValidationError,
  createUniversalLayoutV2Model,
  validateUniversalLayoutV2Model,
  validateUniversalLayoutV2Plan,
  validateUniversalLayoutV2OptionSelection,
  type UniversalLayoutV2Accessibility,
  type UniversalLayoutV2Policy,
} from "./universal-layout-contract-v2";
import { CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY } from "./universal-layout-mock-policies";

const civilPolicy: UniversalLayoutV2Policy = {
  hostId: "civil-kiosk-mock",
  screenId: "civil.main-menu",
  structureVersion: "civil-main-mock.v1",
  allowedCapabilities: ["reserved-bottom-controls"],
  capabilityRules: {
    "reserved-bottom-controls": {
      componentIds: ["civil.certificate-grid"],
      maximumColumns: 1,
    },
  },
  components: [{
    id: "civil.certificate-grid",
    kind: "repeated-card-list",
    role: "certificate-choice-list",
    order: 0,
    itemCountRange: [18, 18],
    allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: true,
    singleColumnForBottomViewport: true,
    operations: ["setColumns"],
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "issuance-actions"],
  }],
};

const demoCoffeePolicy: UniversalLayoutV2Policy = {
  hostId: "democoffee",
  screenId: "cafe.menu",
  structureVersion: "menu.v2",
  allowedCapabilities: [],
  capabilityRules: {},
  components: [{
    id: "menu.product-list",
    kind: "repeated-card-list",
    role: "ordered-menu-list",
    order: 0,
    itemCountRange: [0, 100],
    allowedColumnsByViewport: { compact: [1], regular: [1, 2], wide: [1, 2] },
    singleColumnForLargeText: true,
    singleColumnForLargeButtons: true,
    singleColumnForHighContrast: false,
    singleColumnForBottomViewport: false,
    operations: ["setColumns"],
    minimumTouchTargetPx: 44,
    protectedProperties: ["items", "order", "selection", "actions"],
  }],
};

const optionCivilPolicy: UniversalLayoutV2Policy = {
  ...civilPolicy,
  components: [{
    ...civilPolicy.components[0],
    optionGroups: [{
      id: "arrangement",
      options: [
        {
          id: "compact-grid",
          excludesCapabilities: ["reserved-bottom-controls"],
          accessibility: { textScale: ["standard"] },
        },
        { id: "reserved-safe-list", requiresCapabilities: ["reserved-bottom-controls"] },
        { id: "large-text-list", accessibility: { textScale: ["large", "extraLarge"] } },
      ],
    }],
  }],
};
const optionPolicies = [optionCivilPolicy, demoCoffeePolicy] as const;

const standardAccessibility = {
  textScale: "standard" as const,
  buttonScale: "standard" as const,
  contrast: "standard" as const,
  viewportMode: null,
};
const itemOrderHash = universalSha256({ orderedItemIds: Array.from(
  { length: 18 }, (_, index) => `civil.certificate.${String(index + 1).padStart(2, "0")}`,
) });
const policies = [civilPolicy, demoCoffeePolicy] as const;

function civilModel(
  layoutCapabilities: readonly ("reserved-bottom-controls")[] = [],
  accessibility: UniversalLayoutV2Accessibility = standardAccessibility,
) {
  return createUniversalLayoutV2Model(civilPolicy, {
    viewportClass: "regular",
    accessibility,
    layoutCapabilities,
    componentState: [{ id: "civil.certificate-grid", itemCount: 18, itemOrderHash }],
  });
}

function optionCivilModel(
  layoutCapabilities: readonly ("reserved-bottom-controls")[] = [],
  accessibility: UniversalLayoutV2Accessibility = standardAccessibility,
) {
  return createUniversalLayoutV2Model(optionCivilPolicy, {
    viewportClass: "regular",
    accessibility,
    layoutCapabilities,
    componentState: [{ id: "civil.certificate-grid", itemCount: 18, itemOrderHash }],
  });
}

function planFor(model: ReturnType<typeof civilModel>, columns: number) {
  return {
    schemaVersion: model.schemaVersion,
    contractVersion: model.contractVersion,
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    operations: [{ type: "setColumns" as const, targetId: "civil.certificate-grid", columns }],
  };
}

test("Universal v2 standard permits 1 and 2 columns without changing the v1 implementation", () => {
  const model = validateUniversalLayoutV2Model(civilModel(), policies);
  assert.equal(model.schemaVersion, UNIVERSAL_LAYOUT_V2_SCHEMA_VERSION);
  assert.equal(model.contractVersion, UNIVERSAL_LAYOUT_V2_CONTRACT_VERSION);
  assert.deepEqual(model.components[0].allowedColumns, [1, 2]);
  for (const columns of [1, 2]) {
    assert.doesNotThrow(() => validateUniversalLayoutV2Plan(planFor(model, columns), model, policies));
  }
});

test("registered reserved-bottom-controls capability permits 1 column and rejects 2", () => {
  const model = validateUniversalLayoutV2Model(civilModel(["reserved-bottom-controls"]), policies);
  assert.deepEqual(model.layoutCapabilities, ["reserved-bottom-controls"]);
  assert.deepEqual(model.components[0].allowedColumns, [1]);
  assert.doesNotThrow(() => validateUniversalLayoutV2Plan(planFor(model, 1), model, policies));
  assert.throws(
    () => validateUniversalLayoutV2Plan(planFor(model, 2), model, policies),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError && error.code === "DISALLOWED_COLUMN_COUNT",
  );
  assert.notEqual(model.constraintHash, civilModel().constraintHash);
});

test("policy-owned option groups filter choices by capabilities without defining AI operations", () => {
  const standard = validateUniversalLayoutV2Model(optionCivilModel(), optionPolicies);
  const reserved = validateUniversalLayoutV2Model(
    optionCivilModel(["reserved-bottom-controls"]),
    optionPolicies,
  );
  const largeText = validateUniversalLayoutV2Model(
    optionCivilModel([], { ...standardAccessibility, textScale: "large" }),
    optionPolicies,
  );
  const componentId = "civil.certificate-grid";

  assert.deepEqual(standard.components[0].optionGroups, [{
    id: "arrangement",
    optionIds: ["compact-grid"],
  }]);
  assert.deepEqual(reserved.components[0].optionGroups, [{
    id: "arrangement",
    optionIds: ["reserved-safe-list"],
  }]);
  assert.deepEqual(largeText.components[0].optionGroups, [{
    id: "arrangement",
    optionIds: ["large-text-list"],
  }]);
  assert.deepEqual(
    validateUniversalLayoutV2OptionSelection(
      { componentId, groupId: "arrangement", optionId: "compact-grid" },
      standard,
      optionPolicies,
    ),
    { componentId, groupId: "arrangement", optionId: "compact-grid" },
  );
  assert.deepEqual(
    validateUniversalLayoutV2OptionSelection(
      { componentId, groupId: "arrangement", optionId: "reserved-safe-list" },
      reserved,
      optionPolicies,
    ).optionId,
    "reserved-safe-list",
  );
  assert.equal(
    validateUniversalLayoutV2OptionSelection(
      { componentId, groupId: "arrangement", optionId: "large-text-list" },
      largeText,
      optionPolicies,
    ).optionId,
    "large-text-list",
  );
  assert.throws(
    () => validateUniversalLayoutV2OptionSelection(
      { componentId, groupId: "arrangement", optionId: "compact-grid" },
      reserved,
      optionPolicies,
    ),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError &&
      error.code === "UNSUPPORTED_OPTION_SELECTION",
  );
  assert.throws(
    () => validateUniversalLayoutV2OptionSelection(
      { componentId, groupId: "arrangement", optionId: "unregistered-option" },
      standard,
      optionPolicies,
    ),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError &&
      error.code === "UNSUPPORTED_OPTION_SELECTION",
  );
  assert.notEqual(standard.constraintHash, reserved.constraintHash);
});

test("option declarations are hash-bound and malformed policy option groups are rejected", () => {
  const model = validateUniversalLayoutV2Model(optionCivilModel(), optionPolicies);
  const forgedOptionModel = {
    ...model,
    components: [{
      ...model.components[0],
      optionGroups: [{ id: "arrangement", optionIds: ["forged-option"] }],
    }],
  };
  assert.throws(
    () => validateUniversalLayoutV2Model(forgedOptionModel, optionPolicies),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError &&
      (error.code === "CONSTRAINT_HASH_MISMATCH" || error.code === "COMPONENT_POLICY_MISMATCH"),
  );

  const duplicateOptionPolicy: UniversalLayoutV2Policy = {
    ...optionCivilPolicy,
    components: [{
      ...optionCivilPolicy.components[0],
      optionGroups: [{
        id: "arrangement",
        options: [{ id: "duplicate" }, { id: "duplicate" }],
      }],
    }],
  };
  assert.throws(
    () => createUniversalLayoutV2Model(duplicateOptionPolicy, {
      viewportClass: "regular",
      accessibility: standardAccessibility,
      layoutCapabilities: [],
      componentState: [{ id: "civil.certificate-grid", itemCount: 18, itemOrderHash }],
    }),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError &&
      error.code === "INVALID_OPTION_POLICY",
  );
});

test("bottom reservation capability is independent of user preference and viewport mode", () => {
  // The mock's input represents positively detected reserved screen space,
  // not the SDK's bottomControls preference value.
  const noReservationAsserted = validateUniversalLayoutV2Model(civilModel(), policies);
  const reservationPresent = validateUniversalLayoutV2Model(
    civilModel(["reserved-bottom-controls"]), policies,
  );
  assert.deepEqual(noReservationAsserted.components[0].allowedColumns, [1, 2]);
  assert.deepEqual(reservationPresent.components[0].allowedColumns, [1]);

  const bottomViewportOnly = validateUniversalLayoutV2Model(civilModel([], {
    ...standardAccessibility,
    viewportMode: { mode: "bottom", heightPercent: 60 },
  }), policies);
  assert.deepEqual(bottomViewportOnly.layoutCapabilities, []);
  assert.deepEqual(bottomViewportOnly.components[0].allowedColumns, [1]);
  assert.notEqual(bottomViewportOnly.constraintHash, noReservationAsserted.constraintHash);
});

test("capability appearance or removal changes constraint hash and invalidates stale plans", () => {
  const modelWithReservation = validateUniversalLayoutV2Model(
    civilModel(["reserved-bottom-controls"]), policies,
  );
  const modelWithoutReservation = validateUniversalLayoutV2Model(civilModel(), policies);
  assert.notEqual(modelWithReservation.constraintHash, modelWithoutReservation.constraintHash);
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      planFor(modelWithReservation, 1), modelWithoutReservation, policies,
    ),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError &&
      error.code === "PLAN_MODEL_MISMATCH",
  );
});

test("unknown and cross-host capabilities are rejected by registry policy", () => {
  assert.throws(
    () => createUniversalLayoutV2Model(civilPolicy, {
      viewportClass: "regular",
      accessibility: standardAccessibility,
      layoutCapabilities: ["unregistered" as "reserved-bottom-controls"],
      componentState: [{ id: "civil.certificate-grid", itemCount: 18, itemOrderHash }],
    }),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError && error.code === "UNSUPPORTED_LAYOUT_CAPABILITY",
  );
  assert.throws(
    () => createUniversalLayoutV2Model(demoCoffeePolicy, {
      viewportClass: "regular",
      accessibility: standardAccessibility,
      layoutCapabilities: ["reserved-bottom-controls"],
      componentState: [{ id: "menu.product-list", itemCount: 12, itemOrderHash }],
    }),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError && error.code === "UNSUPPORTED_LAYOUT_CAPABILITY",
  );
});

test("invalid accessibility declarations are rejected by the strict v2 schema", () => {
  assert.throws(() => createUniversalLayoutV2Model(civilPolicy, {
    viewportClass: "regular",
    accessibility: { ...standardAccessibility, contrast: "unknown" } as never,
    layoutCapabilities: [],
    componentState: [{ id: "civil.certificate-grid", itemCount: 18, itemOrderHash }],
  }));
});

test("models cannot narrow or expand registry-derived columns, and hash mismatches fail", () => {
  const model = civilModel();
  assert.throws(
    () => validateUniversalLayoutV2Model({
      ...model,
      components: [{ ...model.components[0], allowedColumns: [1] }],
    }, policies),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError &&
      (error.code === "CONSTRAINT_HASH_MISMATCH" || error.code === "COMPONENT_POLICY_MISMATCH"),
  );
  assert.throws(
    () => validateUniversalLayoutV2Model({
      ...model,
      components: [{ ...model.components[0], allowedColumns: [1, 2, 3] }],
    }, policies),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError &&
      (error.code === "CONSTRAINT_HASH_MISMATCH" || error.code === "COMPONENT_POLICY_MISMATCH"),
  );
  assert.throws(() => validateUniversalLayoutV2Model({ ...model, structureHash: "0".repeat(64) }, policies),
    /STRUCTURE_HASH_MISMATCH/);
  assert.throws(() => validateUniversalLayoutV2Model({ ...model, constraintHash: "0".repeat(64) }, policies),
    /CONSTRAINT_HASH_MISMATCH/);
});

test("v1 models and plans cannot be mixed into v2 validation", () => {
  const model = civilModel();
  const v1Model = createUniversalLayoutModel(CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY, {
    viewportClass: "regular",
    accessibility: standardAccessibility,
    componentState: [{ id: "civil.certificate-grid", itemCount: 18, itemOrderHash }],
  });
  assert.notEqual(model.structureHash, v1Model.structureHash);
  assert.notEqual(model.constraintHash, v1Model.constraintHash);
  const v1ShapedModel = { ...model, schemaVersion: 1, contractVersion: "universal-layout.v1" };
  assert.throws(() => validateUniversalLayoutV2Model(v1ShapedModel, policies));
  const v1ShapedPlan = { ...planFor(model, 1), schemaVersion: 1, contractVersion: "universal-layout.v1" };
  assert.throws(() => validateUniversalLayoutV2Plan(v1ShapedPlan, model, policies));
});

test("v2 rejects unapproved wire operations and conflicting duplicate targets", () => {
  const model = validateUniversalLayoutV2Model(civilModel(), policies);
  assert.throws(
    () => validateUniversalLayoutV2Plan({
      ...planFor(model, 1),
      operations: [{
        type: "setArrangement",
        targetId: "civil.certificate-grid",
        optionId: "compact-grid",
      }],
    }, model, policies),
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan({
      ...planFor(model, 1),
      operations: [
        { type: "setColumns", targetId: "civil.certificate-grid", columns: 1 },
        { type: "setColumns", targetId: "civil.certificate-grid", columns: 2 },
      ],
    }, model, policies),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError &&
      error.code === "CONFLICTING_OPERATION_TARGET",
  );
});

test("plans for a different host are rejected", () => {
  const model = validateUniversalLayoutV2Model(civilModel(), policies);
  assert.throws(
    () => validateUniversalLayoutV2Plan({ ...planFor(model, 1), hostId: "democoffee" }, model, policies),
    (error: unknown) => error instanceof UniversalLayoutV2ValidationError && error.code === "PLAN_MODEL_MISMATCH",
  );
});
