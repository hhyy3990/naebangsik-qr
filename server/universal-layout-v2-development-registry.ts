import {
  parseUniversalLayoutV2Plan,
  validateUniversalLayoutV2Model,
  validateUniversalLayoutV2Plan,
  universalLayoutV2ModelSchema,
  type UniversalLayoutV2Model,
  type UniversalLayoutV2Plan,
  type UniversalLayoutV2Policy,
} from "./universal-layout-contract-v2";
import {
  CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY,
  CIVIL_UNIVERSAL_V2_CONFORMANCE_POLICY,
  DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY,
  DEMO_COFFEE_UNIVERSAL_V2_CONFORMANCE_POLICY,
} from "./universal-v2-conformance-fixtures";

export type DevelopmentUniversalLayoutV2Registration = {
  readonly hostLabel: "DemoCoffee" | "Civil" | "Civil mock fixture";
  readonly hostId: string;
  readonly screenId: string;
  readonly structureVersion: string;
  readonly componentId: string;
  readonly optionIds: readonly string[];
  readonly policyEvidence:
    | "central-conformance-fixture-only"
    | "host-development-snapshot-validated";
  readonly hostPolicyVerified: false;
  readonly policy: UniversalLayoutV2Policy;
};

const DEVELOPMENT_REGISTRY: readonly DevelopmentUniversalLayoutV2Registration[] = [
  {
    hostLabel: "DemoCoffee",
    hostId: DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY.hostId,
    screenId: DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY.screenId,
    structureVersion: DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY.structureVersion,
    componentId: DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY.components[0].id,
    optionIds: ["compact-grid"],
    policyEvidence: "host-development-snapshot-validated",
    hostPolicyVerified: false,
    policy: DEMO_COFFEE_HOST_DEVELOPMENT_V2_POLICY,
  },
  {
    hostLabel: "Civil",
    hostId: CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY.hostId,
    screenId: CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY.screenId,
    structureVersion: CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY.structureVersion,
    componentId: CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY.components[0].id,
    optionIds: ["reserved-safe-list"],
    policyEvidence: "host-development-snapshot-validated",
    hostPolicyVerified: false,
    policy: CIVIL_KIOSK_HOST_DEVELOPMENT_V2_POLICY,
  },
  {
    hostLabel: "Civil mock fixture",
    hostId: CIVIL_UNIVERSAL_V2_CONFORMANCE_POLICY.hostId,
    screenId: CIVIL_UNIVERSAL_V2_CONFORMANCE_POLICY.screenId,
    structureVersion: CIVIL_UNIVERSAL_V2_CONFORMANCE_POLICY.structureVersion,
    componentId: CIVIL_UNIVERSAL_V2_CONFORMANCE_POLICY.components[0].id,
    optionIds: ["reserved-safe-list"],
    policyEvidence: "central-conformance-fixture-only",
    hostPolicyVerified: false,
    policy: CIVIL_UNIVERSAL_V2_CONFORMANCE_POLICY,
  },
];

export class DevelopmentUniversalLayoutV2RegistryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "DevelopmentUniversalLayoutV2RegistryError";
  }
}

function copyRegistration(
  entry: DevelopmentUniversalLayoutV2Registration,
): DevelopmentUniversalLayoutV2Registration {
  return {
    ...entry,
    optionIds: Object.freeze([...entry.optionIds]),
    policy: structuredClone(entry.policy),
  };
}

function assertDevelopmentOnly(): void {
  if (process.env.NODE_ENV !== "development") {
    throw new DevelopmentUniversalLayoutV2RegistryError("DEVELOPMENT_REGISTRY_DISABLED");
  }
}

export function listDevelopmentUniversalLayoutV2Registrations():
readonly Omit<DevelopmentUniversalLayoutV2Registration, "policy">[] {
  assertDevelopmentOnly();
  return DEVELOPMENT_REGISTRY.map(({ policy: _policy, ...metadata }) => ({
    ...metadata,
    optionIds: Object.freeze([...metadata.optionIds]),
  }));
}

export function resolveDevelopmentUniversalLayoutV2Registration(
  hostId: string,
  screenId: string,
): DevelopmentUniversalLayoutV2Registration {
  assertDevelopmentOnly();
  const registration = DEVELOPMENT_REGISTRY.find(
    (entry) => entry.hostId === hostId && entry.screenId === screenId,
  );
  if (!registration) {
    throw new DevelopmentUniversalLayoutV2RegistryError("UNREGISTERED_HOST_SCREEN");
  }
  return copyRegistration(registration);
}

export function validateDevelopmentUniversalLayoutV2Model(
  modelValue: unknown,
): UniversalLayoutV2Model {
  assertDevelopmentOnly();
  const candidate = universalLayoutV2ModelSchema.parse(modelValue);
  const registration = resolveDevelopmentUniversalLayoutV2Registration(
    candidate.hostId,
    candidate.screenId,
  );
  if (candidate.structureVersion !== registration.structureVersion) {
    throw new DevelopmentUniversalLayoutV2RegistryError("UNREGISTERED_STRUCTURE_VERSION");
  }
  return validateUniversalLayoutV2Model(candidate, [registration.policy]);
}

export function validateDevelopmentUniversalLayoutV2Plan(
  planValue: unknown,
  modelValue: unknown,
): UniversalLayoutV2Plan {
  assertDevelopmentOnly();
  const model = validateDevelopmentUniversalLayoutV2Model(modelValue);
  const plan = parseUniversalLayoutV2Plan(planValue);
  const registration = resolveDevelopmentUniversalLayoutV2Registration(
    plan.hostId,
    plan.screenId,
  );

  for (const operation of plan.operations) {
    if (operation.targetId !== registration.componentId) {
      throw new DevelopmentUniversalLayoutV2RegistryError("UNREGISTERED_COMPONENT");
    }
    if (
      operation.type === "selectLayoutOption" &&
      !registration.optionIds.includes(operation.optionId)
    ) {
      throw new DevelopmentUniversalLayoutV2RegistryError("UNREGISTERED_OPTION");
    }
  }

  return validateUniversalLayoutV2Plan(plan, model, [registration.policy]);
}
