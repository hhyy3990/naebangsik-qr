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
  validateUniversalLayoutV2OptionSelections,
  type UniversalLayoutV2Accessibility,
  type UniversalLayoutV2Policy,
} from "./universal-layout-contract-v2";
import { CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY } from "./universal-layout-mock-policies";
import {
  UniversalLayoutV2GenerationError,
  createUniversalLayoutV2PlanJsonSchema,
  generateUniversalLayoutV2Plan,
  type UniversalLayoutV2PromptPayload,
} from "./universal-layout-generator-v2";
import {
  DEMO_COFFEE_UNIVERSAL_V2_CONFORMANCE_POLICY as optionDemoCoffeePolicy,
  CIVIL_UNIVERSAL_V2_CONFORMANCE_POLICY as optionCivilPolicy,
} from "./universal-v2-conformance-fixtures";

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

const optionPolicies = [optionCivilPolicy, optionDemoCoffeePolicy] as const;

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

function fixtureOptionModel(
  policy: UniversalLayoutV2Policy,
  layoutCapabilities: readonly ("reserved-bottom-controls")[] = [],
  accessibility: UniversalLayoutV2Accessibility = standardAccessibility,
) {
  return createUniversalLayoutV2Model(policy, {
    viewportClass: "regular",
    accessibility,
    layoutCapabilities,
    componentState: policy.components.map((component) => {
      const itemCount = Math.max(12, component.itemCountRange[0]);
      return {
        id: component.id,
        itemCount,
        itemOrderHash: universalSha256({ fixture: component.id, itemCount }),
      };
    }),
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

type FakeOptionResponse = {
  basis: { structureHash: string; constraintHash: string };
  selection: unknown;
};

function fakeOptionProvider(selection: unknown) {
  return {
    async choose(model: ReturnType<typeof fixtureOptionModel>): Promise<FakeOptionResponse> {
      return {
        basis: { structureHash: model.structureHash, constraintHash: model.constraintHash },
        selection,
      };
    },
  };
}

function validateFakeOptionResponse(
  response: FakeOptionResponse,
  currentModel: ReturnType<typeof fixtureOptionModel>,
) {
  if (
    response.basis.structureHash !== currentModel.structureHash ||
    response.basis.constraintHash !== currentModel.constraintHash
  ) {
    throw new UniversalLayoutV2ValidationError("STALE_FAKE_OPTION_RESULT");
  }
  return validateUniversalLayoutV2OptionSelection(response.selection, currentModel, optionPolicies);
}

test("test-only fake provider selects declared options for DemoCoffee and Civil; setColumns remains separate", async () => {
  for (const policy of [optionDemoCoffeePolicy, optionCivilPolicy]) {
    const model = validateUniversalLayoutV2Model(fixtureOptionModel(policy), optionPolicies);
    const component = model.components[0];
    const group = component.optionGroups?.[0];
    if (!group || !group.optionIds.includes("compact-grid")) {
      throw new Error("FAKE_FIXTURE_OPTION_MISSING");
    }
    const selection = {
      componentId: component.id,
      groupId: group.id,
      optionId: "compact-grid",
    };
    const response = await fakeOptionProvider(selection).choose(model);
    assert.deepEqual(validateFakeOptionResponse(response, model), selection);
    assert.ok(group.optionIds.includes(selection.optionId));

    const setColumnsPlan = {
      schemaVersion: model.schemaVersion,
      contractVersion: model.contractVersion,
      hostId: model.hostId,
      screenId: model.screenId,
      structureVersion: model.structureVersion,
      structureHash: model.structureHash,
      constraintHash: model.constraintHash,
      viewportClass: model.viewportClass,
      operations: [{
        type: "setColumns" as const,
        targetId: component.id,
        columns: component.allowedColumns[0],
      }],
    };
    assert.doesNotThrow(() => validateUniversalLayoutV2Plan(setColumnsPlan, model, optionPolicies));
  }
});

test("fake option selections reject unsupported, missing, extra, capability, accessibility, and footer-invalid choices", () => {
  const standardCivil = validateUniversalLayoutV2Model(
    fixtureOptionModel(optionCivilPolicy),
    optionPolicies,
  );
  const reservedCivil = validateUniversalLayoutV2Model(
    fixtureOptionModel(optionCivilPolicy, ["reserved-bottom-controls"]),
    optionPolicies,
  );
  const largeTextCivil = validateUniversalLayoutV2Model(
    fixtureOptionModel(optionCivilPolicy, [], { ...standardAccessibility, textScale: "large" }),
    optionPolicies,
  );
  const componentId = optionCivilPolicy.components[0].id;
  const selection = (optionId: string) => ({
    componentId,
    groupId: "arrangement",
    optionId,
  });

  assert.throws(
    () => validateUniversalLayoutV2OptionSelection(selection("not-registered"), standardCivil, optionPolicies),
    /UNSUPPORTED_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2OptionSelection(
      { componentId, groupId: "arrangement" },
      standardCivil,
      optionPolicies,
    ),
    /INVALID_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2OptionSelection(
      { ...selection("compact-grid"), css: "display:none" },
      standardCivil,
      optionPolicies,
    ),
    /INVALID_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2OptionSelection(
      selection("reserved-safe-list"),
      standardCivil,
      optionPolicies,
    ),
    /UNSUPPORTED_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2OptionSelection(
      selection("compact-grid"),
      reservedCivil,
      optionPolicies,
    ),
    /UNSUPPORTED_OPTION_SELECTION/,
  );
  assert.equal(
    validateUniversalLayoutV2OptionSelection(
      selection("reserved-safe-list"),
      reservedCivil,
      optionPolicies,
    ).optionId,
    "reserved-safe-list",
  );
  assert.throws(
    () => validateUniversalLayoutV2OptionSelection(
      selection("compact-grid"),
      largeTextCivil,
      optionPolicies,
    ),
    /UNSUPPORTED_OPTION_SELECTION/,
  );
  assert.equal(
    validateUniversalLayoutV2OptionSelection(
      selection("large-text-list"),
      largeTextCivil,
      optionPolicies,
    ).optionId,
    "large-text-list",
  );
});

test("fake option results reject stale hashes and duplicate or conflicting selections", async () => {
  const standard = validateUniversalLayoutV2Model(
    fixtureOptionModel(optionCivilPolicy),
    optionPolicies,
  );
  const reserved = validateUniversalLayoutV2Model(
    fixtureOptionModel(optionCivilPolicy, ["reserved-bottom-controls"]),
    optionPolicies,
  );
  const largeText = validateUniversalLayoutV2Model(
    fixtureOptionModel(optionCivilPolicy, [], { ...standardAccessibility, textScale: "large" }),
    optionPolicies,
  );
  const compactSelection = {
    componentId: optionCivilPolicy.components[0].id,
    groupId: "arrangement",
    optionId: "compact-grid",
  };
  const response = await fakeOptionProvider(compactSelection).choose(standard);

  assert.notEqual(standard.constraintHash, reserved.constraintHash);
  assert.throws(
    () => validateFakeOptionResponse(response, reserved),
    /STALE_FAKE_OPTION_RESULT/,
  );
  assert.throws(
    () => validateFakeOptionResponse(response, largeText),
    /STALE_FAKE_OPTION_RESULT/,
  );
  assert.throws(
    () => validateFakeOptionResponse({
      ...response,
      basis: { ...response.basis, constraintHash: "0".repeat(64) },
    }, standard),
    /STALE_FAKE_OPTION_RESULT/,
  );
  assert.throws(
    () => validateUniversalLayoutV2OptionSelections(
      [compactSelection, compactSelection],
      standard,
      optionPolicies,
    ),
    /DUPLICATE_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2OptionSelections(
      [compactSelection, { ...compactSelection, optionId: "large-text-list" }],
      standard,
      optionPolicies,
    ),
    /CONFLICTING_OPTION_SELECTION/,
  );
});

test("selectLayoutOption wire operation reuses option validation across fixture policies", () => {
  const scenarios = [
    { policy: optionDemoCoffeePolicy, optionId: "compact-grid", capabilities: [], accessibility: standardAccessibility },
    { policy: optionCivilPolicy, optionId: "compact-grid", capabilities: [], accessibility: standardAccessibility },
    {
      policy: optionCivilPolicy,
      optionId: "reserved-safe-list",
      capabilities: ["reserved-bottom-controls"] as const,
      accessibility: standardAccessibility,
    },
    {
      policy: optionCivilPolicy,
      optionId: "large-text-list",
      capabilities: [],
      accessibility: { ...standardAccessibility, textScale: "large" as const },
    },
  ] as const;

  for (const scenario of scenarios) {
    const model = validateUniversalLayoutV2Model(
      fixtureOptionModel(scenario.policy, scenario.capabilities, scenario.accessibility),
      optionPolicies,
    );
    const component = model.components[0];
    const operation = {
      type: "selectLayoutOption" as const,
      targetId: component.id,
      groupId: "arrangement",
      optionId: scenario.optionId,
    };
    const plan = {
      schemaVersion: model.schemaVersion,
      contractVersion: model.contractVersion,
      hostId: model.hostId,
      screenId: model.screenId,
      structureVersion: model.structureVersion,
      structureHash: model.structureHash,
      constraintHash: model.constraintHash,
      viewportClass: model.viewportClass,
      operations: [operation],
    };
    assert.ok(model.allowedOperations.includes("selectLayoutOption"));
    assert.ok(component.operations.includes("selectLayoutOption"));
    assert.deepEqual(validateUniversalLayoutV2Plan(plan, model, optionPolicies).operations, [operation]);
  }
});

test("selectLayoutOption rejects malformed, unsupported, stale, duplicate, and conflicting plans", () => {
  const standard = validateUniversalLayoutV2Model(
    fixtureOptionModel(optionCivilPolicy),
    optionPolicies,
  );
  const reserved = validateUniversalLayoutV2Model(
    fixtureOptionModel(optionCivilPolicy, ["reserved-bottom-controls"]),
    optionPolicies,
  );
  const componentId = optionCivilPolicy.components[0].id;
  const operation = (optionId: string, groupId = "arrangement") => ({
    type: "selectLayoutOption",
    targetId: componentId,
    groupId,
    optionId,
  });
  const plan = (model: typeof standard, operations: unknown[]) => ({
    schemaVersion: model.schemaVersion,
    contractVersion: model.contractVersion,
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    operations,
  });

  assert.throws(
    () => validateUniversalLayoutV2Plan(plan(standard, [operation("unknown-option")]), standard, optionPolicies),
    /UNSUPPORTED_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      plan(standard, [{ ...operation("compact-grid"), targetId: "missing.component" }]),
      standard,
      optionPolicies,
    ),
    /UNSUPPORTED_PLAN_OPERATION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(plan(standard, [operation("compact-grid", "unknown-group")]), standard, optionPolicies),
    /UNSUPPORTED_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(plan(standard, [{ type: "selectLayoutOption", targetId: componentId, optionId: "compact-grid" }]), standard, optionPolicies),
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(plan(standard, [{ ...operation("compact-grid"), style: "grid" }]), standard, optionPolicies),
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(plan(reserved, [operation("compact-grid")]), reserved, optionPolicies),
    /UNSUPPORTED_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(plan(standard, [operation("compact-grid")]), reserved, optionPolicies),
    /PLAN_MODEL_MISMATCH/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      { ...plan(standard, [operation("compact-grid")]), constraintHash: "0".repeat(64) },
      standard,
      optionPolicies,
    ),
    /PLAN_MODEL_MISMATCH/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      { ...plan(standard, [operation("compact-grid")]), contractVersion: "universal-layout.v1" },
      standard,
      optionPolicies,
    ),
  );
  const noOptionModel = validateUniversalLayoutV2Model(
    fixtureOptionModel(demoCoffeePolicy),
    [demoCoffeePolicy],
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      plan(noOptionModel, [{
        type: "selectLayoutOption",
        targetId: noOptionModel.components[0].id,
        groupId: "arrangement",
        optionId: "compact-grid",
      }]),
      noOptionModel,
      [demoCoffeePolicy],
    ),
    /UNSUPPORTED_PLAN_OPERATION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      plan(standard, [operation("compact-grid"), operation("compact-grid")]),
      standard,
      optionPolicies,
    ),
    /DUPLICATE_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      plan(standard, [operation("compact-grid"), operation("large-text-list")]),
      standard,
      optionPolicies,
    ),
    /CONFLICTING_OPTION_SELECTION/,
  );
  assert.throws(
    () => validateUniversalLayoutV2Plan(
      plan(standard, [
        operation("compact-grid"),
        { type: "setColumns", targetId: componentId, columns: 1 },
      ]),
      standard,
      optionPolicies,
    ),
    /CONFLICTING_OPERATION_TARGET/,
  );
});

function fakePlanFromPayload(payload: UniversalLayoutV2PromptPayload, operations: unknown[]) {
  return {
    schemaVersion: payload.schemaVersion,
    contractVersion: payload.contractVersion,
    hostId: payload.hostId,
    screenId: payload.screenId,
    structureVersion: payload.structureVersion,
    structureHash: payload.structureHash,
    constraintHash: payload.constraintHash,
    viewportClass: payload.viewportClass,
    operations,
  };
}

function fakeOptionOperation(payload: UniversalLayoutV2PromptPayload, optionId: string) {
  const component = payload.components[0];
  const group = component.optionGroups?.[0];
  if (!group) throw new Error("FAKE_FIXTURE_OPTION_GROUP_MISSING");
  return {
    type: "selectLayoutOption",
    targetId: component.id,
    groupId: group.id,
    optionId,
  };
}

test("v2 generator runs model through test-only Fake provider, strict schema, and common validator", async () => {
  const scenarios = [
    { policy: optionDemoCoffeePolicy, optionId: "compact-grid", capabilities: [], accessibility: standardAccessibility },
    { policy: optionCivilPolicy, optionId: "compact-grid", capabilities: [], accessibility: standardAccessibility },
    {
      policy: optionCivilPolicy,
      optionId: "reserved-safe-list",
      capabilities: ["reserved-bottom-controls"] as const,
      accessibility: standardAccessibility,
    },
    {
      policy: optionCivilPolicy,
      optionId: "large-text-list",
      capabilities: [],
      accessibility: { ...standardAccessibility, textScale: "large" as const },
    },
  ] as const;

  for (const scenario of scenarios) {
    const model = fixtureOptionModel(scenario.policy, scenario.capabilities, scenario.accessibility);
    const provider = {
      async generate({ payload, responseSchema }: {
        payload: UniversalLayoutV2PromptPayload;
        responseSchema: { properties: Record<string, unknown> };
      }) {
        const componentSchema = responseSchema.properties.operations as {
          items: { anyOf?: Array<{ properties?: Record<string, { enum?: string[] }> }> };
        };
        assert.ok(componentSchema.items.anyOf?.some((variant) =>
          variant.properties?.optionId?.enum?.includes(scenario.optionId),
        ));
        assert.equal("itemCount" in payload.components[0], false);
        assert.equal("itemOrderHash" in payload.components[0], false);
        return fakePlanFromPayload(payload, [fakeOptionOperation(payload, scenario.optionId)]);
      },
    };
    const plan = await generateUniversalLayoutV2Plan({
      model,
      policies: optionPolicies,
      provider,
    });
    assert.equal(plan.operations[0].type, "selectLayoutOption");
    assert.equal(plan.operations[0].optionId, scenario.optionId);
  }
});

test("v2 generator rejects invalid or stale Fake plans without repair or fallback", async () => {
  const model = fixtureOptionModel(optionCivilPolicy);
  const providerFor = (makeOutput: (payload: UniversalLayoutV2PromptPayload) => unknown) => ({
    async generate({ payload }: { payload: UniversalLayoutV2PromptPayload }) {
      return makeOutput(payload);
    },
  });
  const validOperation = (payload: UniversalLayoutV2PromptPayload) =>
    fakeOptionOperation(payload, "compact-grid");
  const invalidOutputs = [
    (payload: UniversalLayoutV2PromptPayload) => fakePlanFromPayload(payload, [
      fakeOptionOperation(payload, "unregistered-option"),
    ]),
    (payload: UniversalLayoutV2PromptPayload) => fakePlanFromPayload(payload, [
      { ...validOperation(payload), targetId: "missing.component" },
    ]),
    (payload: UniversalLayoutV2PromptPayload) => fakePlanFromPayload(payload, [
      { ...validOperation(payload), groupId: "unknown-group" },
    ]),
    (payload: UniversalLayoutV2PromptPayload) => fakePlanFromPayload(payload, [
      validOperation(payload),
      validOperation(payload),
    ]),
    (payload: UniversalLayoutV2PromptPayload) => fakePlanFromPayload(payload, [
      validOperation(payload),
      fakeOptionOperation(payload, "large-text-list"),
    ]),
    (payload: UniversalLayoutV2PromptPayload) => fakePlanFromPayload(payload, [
      validOperation(payload),
      { type: "setColumns", targetId: payload.components[0].id, columns: 1 },
    ]),
    (payload: UniversalLayoutV2PromptPayload) => ({
      ...fakePlanFromPayload(payload, [validOperation(payload)]),
      constraintHash: "0".repeat(64),
    }),
    (payload: UniversalLayoutV2PromptPayload) => ({
      ...fakePlanFromPayload(payload, [validOperation(payload)]),
      extra: "not-allowed",
    }),
  ];
  let providerCalls = 0;
  for (const makeOutput of invalidOutputs) {
    await assert.rejects(
      generateUniversalLayoutV2Plan({
        model,
        policies: optionPolicies,
        provider: {
          async generate({ payload }: { payload: UniversalLayoutV2PromptPayload }) {
            providerCalls += 1;
            return makeOutput(payload);
          },
        },
      }),
      (error: unknown) => error instanceof UniversalLayoutV2GenerationError &&
        ["PLAN_REJECTED", "INVALID_STRUCTURED_OUTPUT"].includes(error.code),
    );
  }
  assert.equal(providerCalls, invalidOutputs.length);
});

test("v2 generator rejects a valid plan produced against a stale capability model", async () => {
  const previousModel = validateUniversalLayoutV2Model(
    fixtureOptionModel(optionCivilPolicy),
    optionPolicies,
  );
  const currentModel = fixtureOptionModel(optionCivilPolicy, ["reserved-bottom-controls"]);
  const stalePlan = fakePlanFromPayload(
    {
      ...previousModel,
      components: previousModel.components.map((component) => ({
        ...component,
        optionGroups: component.optionGroups ?? [],
      })),
    } as UniversalLayoutV2PromptPayload,
    [{
      type: "selectLayoutOption",
      targetId: previousModel.components[0].id,
      groupId: "arrangement",
      optionId: "compact-grid",
    }],
  );
  await assert.rejects(
    generateUniversalLayoutV2Plan({
      model: currentModel,
      policies: optionPolicies,
      provider: { async generate() { return stalePlan; } },
    }),
    (error: unknown) => error instanceof UniversalLayoutV2GenerationError &&
      error.code === "PLAN_REJECTED" && error.validationCode === "PLAN_MODEL_MISMATCH",
  );
});

test("v2 generator reports provider failures and timeout without retries or fallback", async () => {
  for (const [error, expectedCode] of [
    [new Error("fake provider failure"), "PROVIDER_FAILURE"],
    [Object.assign(new Error("fake timeout"), { name: "FakeProviderTimeoutError" }), "PROVIDER_TIMEOUT"],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      generateUniversalLayoutV2Plan({
        model: fixtureOptionModel(optionCivilPolicy),
        policies: optionPolicies,
        provider: {
          async generate() {
            calls += 1;
            throw error;
          },
        },
      }),
      (actual: unknown) => actual instanceof UniversalLayoutV2GenerationError &&
        actual.code === expectedCode,
    );
    assert.equal(calls, 1);
  }
});
