import assert from "node:assert/strict";
import { test } from "node:test";
import {
  universalSha256,
} from "./universal-layout-contract";
import {
  createUniversalLayoutV2Model,
  type UniversalLayoutV2Accessibility,
} from "./universal-layout-contract-v2";
import {
  DevelopmentUniversalLayoutV2RegistryError,
  listDevelopmentUniversalLayoutV2Registrations,
  resolveDevelopmentUniversalLayoutV2Registration,
  validateDevelopmentUniversalLayoutV2Model,
  validateDevelopmentUniversalLayoutV2Plan,
} from "./universal-layout-v2-development-registry";

const standardAccessibility: UniversalLayoutV2Accessibility = {
  textScale: "standard",
  buttonScale: "standard",
  contrast: "standard",
  viewportMode: null,
};

function withNodeEnv<T>(value: string, callback: () => T): T {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

function buildModel(
  hostId: string,
  screenId: string,
  accessibility: UniversalLayoutV2Accessibility = standardAccessibility,
  layoutCapabilities: ("reserved-bottom-controls")[] = [],
) {
  const registration = resolveDevelopmentUniversalLayoutV2Registration(hostId, screenId);
  const component = registration.policy.components[0];
  const itemCount = Math.max(12, component.itemCountRange[0]);
  return createUniversalLayoutV2Model(registration.policy, {
    viewportClass: "regular",
    accessibility,
    layoutCapabilities,
    componentState: [{
      id: component.id,
      itemCount,
      itemOrderHash: universalSha256({ fixture: component.id, itemCount }),
    }],
  });
}

function selectPlan(
  model: ReturnType<typeof buildModel>,
  componentId: string,
  optionId: string,
) {
  return {
    schemaVersion: model.schemaVersion,
    contractVersion: model.contractVersion,
    hostId: model.hostId,
    screenId: model.screenId,
    structureVersion: model.structureVersion,
    structureHash: model.structureHash,
    constraintHash: model.constraintHash,
    viewportClass: model.viewportClass,
    operations: [{
      type: "selectLayoutOption" as const,
      targetId: componentId,
      groupId: "arrangement",
      optionId,
    }],
  };
}

test("Development registry scopes conformance policies and reuses the central v2 validator", () => {
  withNodeEnv("development", () => {
    const registrations = listDevelopmentUniversalLayoutV2Registrations();
    assert.deepEqual(
      registrations.map(({ hostLabel, hostId, screenId, componentId, optionIds }) => ({
        hostLabel, hostId, screenId, componentId, optionIds,
      })),
      [
        {
          hostLabel: "DemoCoffee",
          hostId: "democoffee",
          screenId: "cafe.menu",
          componentId: "menu.product-list",
          optionIds: ["compact-grid"],
        },
        {
          hostLabel: "Civil",
          hostId: "civil-kiosk-mock",
          screenId: "civil.main-menu",
          componentId: "civil.certificate-grid",
          optionIds: ["reserved-safe-list"],
        },
      ],
    );
    assert.ok(registrations.every((entry) =>
      entry.policyEvidence === "central-conformance-fixture-only" &&
      entry.hostPolicyVerified === false,
    ));

    const demoRegistration = resolveDevelopmentUniversalLayoutV2Registration(
      "democoffee",
      "cafe.menu",
    );
    assert.throws(() => (demoRegistration.optionIds as string[]).push("injected-option"));
    assert.deepEqual(
      resolveDevelopmentUniversalLayoutV2Registration("democoffee", "cafe.menu").optionIds,
      ["compact-grid"],
    );
    const demoModel = buildModel("democoffee", "cafe.menu");
    const demoPlan = selectPlan(demoModel, demoRegistration.componentId, "compact-grid");
    assert.equal(
      validateDevelopmentUniversalLayoutV2Plan(demoPlan, demoModel).operations[0].type,
      "selectLayoutOption",
    );

    const civilRegistration = resolveDevelopmentUniversalLayoutV2Registration(
      "civil-kiosk-mock",
      "civil.main-menu",
    );
    const civilModel = buildModel(
      "civil-kiosk-mock",
      "civil.main-menu",
      standardAccessibility,
      ["reserved-bottom-controls"],
    );
    assert.deepEqual(civilModel.components[0].allowedColumns, [1]);
    const civilPlan = selectPlan(
      civilModel,
      civilRegistration.componentId,
      "reserved-safe-list",
    );
    assert.equal(
      validateDevelopmentUniversalLayoutV2Plan(civilPlan, civilModel).operations[0].type,
      "selectLayoutOption",
    );

    assert.throws(
      () => validateDevelopmentUniversalLayoutV2Model({
        ...demoModel,
        hostId: "unregistered-host",
      }),
      (error: unknown) => error instanceof DevelopmentUniversalLayoutV2RegistryError &&
        error.code === "UNREGISTERED_HOST_SCREEN",
    );
    assert.throws(
      () => validateDevelopmentUniversalLayoutV2Plan({
        ...demoPlan,
        hostId: "civil-kiosk-mock",
      }, demoModel),
      (error: unknown) => error instanceof DevelopmentUniversalLayoutV2RegistryError &&
        error.code === "UNREGISTERED_HOST_SCREEN",
    );
    assert.throws(
      () => validateDevelopmentUniversalLayoutV2Plan(
        selectPlan(demoModel, demoRegistration.componentId, "not-registered"),
        demoModel,
      ),
      (error: unknown) => error instanceof DevelopmentUniversalLayoutV2RegistryError &&
        error.code === "UNREGISTERED_OPTION",
    );

    const largeTextModel = buildModel("democoffee", "cafe.menu", {
      ...standardAccessibility,
      textScale: "large",
    });
    assert.throws(() => validateDevelopmentUniversalLayoutV2Plan(
      selectPlan(largeTextModel, demoRegistration.componentId, "compact-grid"),
      largeTextModel,
    ));

    const noFooterCapabilityModel = buildModel("civil-kiosk-mock", "civil.main-menu");
    assert.throws(() => validateDevelopmentUniversalLayoutV2Plan(
      selectPlan(noFooterCapabilityModel, civilRegistration.componentId, "reserved-safe-list"),
      noFooterCapabilityModel,
    ));
    assert.throws(() => validateDevelopmentUniversalLayoutV2Plan(
      selectPlan(civilModel, civilRegistration.componentId, "compact-grid"),
      civilModel,
    ));

    assert.throws(() => validateDevelopmentUniversalLayoutV2Model({
      ...demoModel,
      structureHash: "0".repeat(64),
    }));
    assert.throws(() => validateDevelopmentUniversalLayoutV2Model({
      ...demoModel,
      constraintHash: "0".repeat(64),
    }));
  });
});

test("Development registry is inaccessible when NODE_ENV is not development", () => {
  for (const environment of ["test", "production"]) {
    withNodeEnv(environment, () => {
      assert.throws(
        () => listDevelopmentUniversalLayoutV2Registrations(),
        (error: unknown) => error instanceof DevelopmentUniversalLayoutV2RegistryError &&
          error.code === "DEVELOPMENT_REGISTRY_DISABLED",
      );
    });
  }
});
