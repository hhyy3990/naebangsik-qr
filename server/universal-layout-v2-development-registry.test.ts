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
          hostId: "civil-kiosk-development-test",
          screenId: "civil.main-menu",
          componentId: "civil.certificate-grid",
          optionIds: ["reserved-safe-list"],
        },
        {
          hostLabel: "Civil mock fixture",
          hostId: "civil-kiosk-mock",
          screenId: "civil.main-menu",
          componentId: "civil.certificate-grid",
          optionIds: ["reserved-safe-list"],
        },
      ],
    );
    assert.ok(registrations.every((entry) =>
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
      "civil-kiosk-development-test",
      "civil.main-menu",
    );
    const civilModel = buildModel(
      "civil-kiosk-development-test",
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
    const largeButtonModel = buildModel("democoffee", "cafe.menu", {
      ...standardAccessibility,
      buttonScale: "large",
    });
    assert.throws(() => validateDevelopmentUniversalLayoutV2Plan(
      selectPlan(largeButtonModel, demoRegistration.componentId, "compact-grid"),
      largeButtonModel,
    ));

    const noFooterCapabilityModel = buildModel("civil-kiosk-mock", "civil.main-menu");
    assert.throws(() => validateDevelopmentUniversalLayoutV2Plan(
      selectPlan(noFooterCapabilityModel, civilRegistration.componentId, "reserved-safe-list"),
      noFooterCapabilityModel,
    ));
    const unassertedActualCivil = buildModel(
      "civil-kiosk-development-test",
      "civil.main-menu",
    );
    assert.throws(() => validateDevelopmentUniversalLayoutV2Plan(
      selectPlan(unassertedActualCivil, civilRegistration.componentId, "reserved-safe-list"),
      unassertedActualCivil,
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

test("host-supplied DemoCoffee and Civil snapshots reproduce central hashes and validate", () => {
  withNodeEnv("development", () => {
    const demo = resolveDevelopmentUniversalLayoutV2Registration("democoffee", "cafe.menu");
    const demoOrderHash = "af0c4a1b243d46755fc31fa279e936f612bf2b3914b293d67e585d6aa5fb091a";
    const demoExpectedConstraints = {
      compact: "2f008c8481d1fbf7b91886a0ed2a00dc5720a1cd2ba0eae83a27706ebfeb8747",
      regular: "6aabe7d629c36395e1cb12ec3b45085f077e8d8c445cdfbe676cc8fe0eed0d5e",
      wide: "52888ec8f0fdd8b30431ecd4281d1ecbcfa581fab3681c35b60b09bd6aafa456",
    } as const;
    let regularDemoModel: ReturnType<typeof createUniversalLayoutV2Model> | undefined;

    for (const viewportClass of ["compact", "regular", "wide"] as const) {
      const model = createUniversalLayoutV2Model(demo.policy, {
        viewportClass,
        accessibility: standardAccessibility,
        layoutCapabilities: [],
        componentState: [{
          id: demo.componentId,
          itemCount: 5,
          itemOrderHash: demoOrderHash,
        }],
      });
      assert.equal(
        model.structureHash,
        "c4e004d4df6fd7f4b0084b0b83569667239cd81284519d46108ad5921dd5cc4e",
      );
      assert.equal(model.constraintHash, demoExpectedConstraints[viewportClass]);
      assert.deepEqual(model.components[0].optionGroups, [{
        id: "arrangement",
        optionIds: ["compact-grid"],
      }]);
      assert.doesNotThrow(() => validateDevelopmentUniversalLayoutV2Model(model));
      if (viewportClass === "regular") regularDemoModel = model;
    }
    assert.ok(regularDemoModel);
    assert.doesNotThrow(() => validateDevelopmentUniversalLayoutV2Plan(
      selectPlan(regularDemoModel!, demo.componentId, "compact-grid"),
      regularDemoModel,
    ));

    const civil = resolveDevelopmentUniversalLayoutV2Registration(
      "civil-kiosk-development-test",
      "civil.main-menu",
    );
    const orderedItemIds = Array.from(
      { length: 18 },
      (_, index) => `civil.certificate.${String(index + 1).padStart(2, "0")}`,
    );
    const civilModel = createUniversalLayoutV2Model(civil.policy, {
      viewportClass: "wide",
      accessibility: standardAccessibility,
      layoutCapabilities: ["reserved-bottom-controls"],
      componentState: [{
        id: civil.componentId,
        itemCount: 18,
        itemOrderHash: universalSha256({ orderedItemIds }),
      }],
    });
    assert.equal(
      civilModel.structureHash,
      "5ee50fd98eb1ba357232fbc21a39c78b1721925491635b9943a7027cab4eed0b",
    );
    assert.equal(
      civilModel.constraintHash,
      "285382bce15365551f61890fc36ae5e66f8d225bd8592e4385197e44aebb1c69",
    );
    assert.deepEqual(civilModel.components[0].allowedColumns, [1]);
    assert.deepEqual(civilModel.components[0].optionGroups, [{
      id: "arrangement",
      optionIds: ["reserved-safe-list"],
    }]);
    const civilPlan = selectPlan(civilModel, civil.componentId, "reserved-safe-list");
    assert.doesNotThrow(() => validateDevelopmentUniversalLayoutV2Plan(civilPlan, civilModel));
  });
});
