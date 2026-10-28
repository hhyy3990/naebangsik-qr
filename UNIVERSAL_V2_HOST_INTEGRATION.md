# Universal Layout v2 — Host Integration Contract

## Source of truth and current status

This guide and `universal-v2-contract-export.ts` expose the central v2 model, plan schema, hash functions, and validators. The exporter re-exports the existing implementation; it does not define another contract.

**Important:** the central project has a Development-only host policy registry, but it does not expose a v2 endpoint/provider or make Production registrations. The sample model/plan remains a synthetic conformance fixture; supplied host snapshots are validated separately and `hostPolicyVerified` remains false. See `server/UNIVERSAL_V2_DEVELOPMENT_REGISTRY.md` for the distinction between those policies and host evidence.

The contract versions are:

- `schemaVersion`: `2`
- `contractVersion`: `"universal-layout.v2"`

The v1 contract, hashes, and generator remain separate. Do not send v2 fields or operations to a v1 validator.

## Import and dependency requirements

`universal-v2-contract-export.ts` is the public facade. When copying it to another project, preserve its relative imports by copying these central source dependencies into a `server/` directory:

- `server/universal-layout-contract-v2.ts`
- `server/universal-layout-contract.ts`

The host project also needs Zod 4 and Node.js `node:crypto` support for the exported SHA-256 helper. The exported `UNIVERSAL_LAYOUT_V2_MODEL_JSON_SCHEMA` and `UNIVERSAL_LAYOUT_V2_PLAN_JSON_SCHEMA` are generated directly from the central Zod schemas with `z.toJSONSchema`; use the exported validators as well because JSON Schema cannot express policy reconstruction and hash equality.

```ts
import {
  UNIVERSAL_LAYOUT_V2_MODEL_JSON_SCHEMA,
  UNIVERSAL_LAYOUT_V2_PLAN_JSON_SCHEMA,
  validateUniversalLayoutV2Model,
  validateUniversalLayoutV2Plan,
  type UniversalLayoutV2Model,
  type UniversalLayoutV2Plan,
  type UniversalLayoutV2Policy,
} from "./universal-v2-contract-export";
```

## Exact model and plan types

The canonical TypeScript types are exported from the actual Zod schemas:

```ts
type UniversalLayoutV2Model = z.infer<typeof universalLayoutV2ModelSchema>;
type UniversalLayoutV2Plan = z.infer<typeof universalLayoutV2PlanSchema>;
type UniversalLayoutV2Component = UniversalLayoutV2Model["components"][number];
type UniversalLayoutV2Operation = UniversalLayoutV2Plan["operations"][number];
```

Model top-level fields:

```ts
{
  schemaVersion: 2;
  contractVersion: "universal-layout.v2";
  hostId: string;
  screenId: string;
  structureVersion: string;
  structureHash: string;       // lowercase 64-character SHA-256 hex
  constraintHash: string;     // lowercase 64-character SHA-256 hex
  viewportClass: "compact" | "regular" | "wide";
  accessibility: {
    textScale: "standard" | "large" | "extraLarge";
    buttonScale: "standard" | "large";
    contrast: "standard" | "high";
    viewportMode: null | { mode: "bottom"; heightPercent: 60 | 70 | 80 };
  };
  layoutCapabilities: ("reserved-bottom-controls")[];
  components: UniversalLayoutV2Component[];
  allowedOperations: ("setColumns" | "selectLayoutOption")[];
}
```

The exact inferred component shape is:

```ts
type UniversalLayoutV2Component = {
  id: string;
  kind: string;
  role: string;
  order: number;
  itemCount: number;
  itemOrderHash: string;
  operations: ("setColumns" | "selectLayoutOption")[];
  allowedColumns: number[];
  optionGroups?: { id: string; optionIds: string[] }[];
  minimumTouchTargetPx: number;
  protectedProperties: string[];
};
```

An option group is `{ id, optionIds }`. The model JSON Schema is available as `UNIVERSAL_LAYOUT_V2_MODEL_JSON_SCHEMA`. It is generated from the central schema; cross-field uniqueness and policy-derived checks are additionally enforced by the central validator.

The plan top-level fields are `schemaVersion`, `contractVersion`, `hostId`, `screenId`, `structureVersion`, `structureHash`, `constraintHash`, `viewportClass`, and `operations`.

`UniversalLayoutV2Operation` is inferred from the plan schema and is the union below:

```ts
type UniversalLayoutV2Operation =
  | { type: "setColumns"; targetId: string; columns: number }
  | { type: "selectLayoutOption"; targetId: string; groupId: string; optionId: string };
```

All plan objects and operation variants are strict: missing required fields and additional fields are rejected. `selectLayoutOption` only selects a declared identifier; it does not define CSS or apply a host preset. The plan JSON Schema is available as `UNIVERSAL_LAYOUT_V2_PLAN_JSON_SCHEMA`.

The generated schemas encode field types, enum values, bounds, required fields, and `additionalProperties: false`. Zod `.superRefine` checks are not representable in JSON Schema; duplicate IDs/operations and registry/hash consistency still require the exported validator.

## Hash calculations

`canonicalUniversalJson` recursively normalizes strings and object keys to Unicode NFC, sorts object keys lexically, preserves array order, converts `-0` to `0`, rejects non-safe-integer numbers, and rejects object keys that collide after normalization. `universalSha256(value)` computes SHA-256 over that canonical JSON encoded as UTF-8 and returns lowercase hex. These functions are exported from the facade.

The central `computeUniversalLayoutV2StructureHash` hashes this object:

```ts
{
  schemaVersion: 2,
  contractVersion: "universal-layout.v2",
  hostId,
  screenId,
  structureVersion,
  components: components
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(({ id, kind, role, order, itemCount, itemOrderHash }) =>
      ({ id, kind, role, order, itemCount, itemOrderHash }))
}
```

The central `computeUniversalLayoutV2ConstraintHash` hashes:

```ts
{
  schemaVersion: 2,
  contractVersion: "universal-layout.v2",
  viewportClass,
  accessibility,
  layoutCapabilities: [...layoutCapabilities].sort(),
  allowedOperations,
  components: components
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(({ id, operations, allowedColumns, minimumTouchTargetPx,
            protectedProperties, optionGroups }) => ({
      id, operations, allowedColumns, minimumTouchTargetPx, protectedProperties,
      ...(optionGroups ? { optionGroups } : {})
    }))
}
```

Use the exported functions rather than reimplementing these projections. Any changed component structure must change `structureHash`; changed accessibility, capabilities, operations, allowed columns, protected properties, or resolved option IDs must change `constraintHash`.

## Policy, options, and validation

Policies are passed to `createUniversalLayoutV2Model` and the validators. A host policy declares component structure, column limits, minimum touch size, protected properties, and optional option groups. Each option group must contain at least one unique option ID. Option IDs and group IDs must match `^[a-z0-9][a-z0-9._:-]{0,63}$`.

Each option may require or exclude capabilities and may restrict accessibility values. Referenced capabilities must be allowed by that policy; contradictory or duplicate capability declarations are rejected. The model contains only options that survive the current capability/accessibility filters. The central validator reconstructs the model from the supplied policy and compares the hashes and resolved components; a caller cannot add an option by editing the model.

An option's accessibility allowlists, when present, must be non-empty and unique. Values are the model enums: text scale `standard|large|extraLarge`, button scale `standard|large`, contrast `standard|high`, and viewport mode `none|bottom-60|bottom-70|bottom-80`. All declared dimensions must match for that option to appear in the model.

`minimumTouchTargetPx` is an integer from 44 through 96; the policy value is reflected in the model and hash. This validates the declared policy value—it does not prove the host rendered a real target at that size.

### `reserved-bottom-controls`

This capability means the host has positively detected persistent bottom UI that reserves usable screen space. It is a layout constraint, not a user preference, and does not authorize moving, hiding, or resizing the footer. Its absence means “not asserted,” not “no fixed UI.” A host that cannot determine the state must not treat absence as proof that the bottom is clear.

The option ID filtering and column limit are policy-specific. In the Civil test fixture, the capability limits the certificate component to one column and excludes `compact-grid`; it is not a universal rule that every host must use one column.

### Operation conflicts

- Duplicate `setColumns` for one target are rejected.
- A component/group may be selected only once; repeated or conflicting option IDs are rejected.
- `setColumns` and `selectLayoutOption` on the same component are rejected because this contract does not define their combined application semantics.
- Stale plans, wrong target/group/option IDs, and hash mismatches are rejected.

Example invalid plan operation:

```json
{
  "type": "selectLayoutOption",
  "targetId": "menu.product-list",
  "groupId": "arrangement",
  "optionId": "unregistered-grid",
  "css": "display: grid"
}
```

It is rejected because the option is not policy-resolved and `css` is an additional field.

## DemoCoffee compact-grid conformance fixture

`universal-v2-valid-fixtures.json` contains a model/plan pair generated from the test-only conformance policy and verified against the central v2 validator. Its item count and item-order hash are synthetic fixture values, not a real menu snapshot.

```json
{
  "type": "selectLayoutOption",
  "targetId": "menu.product-list",
  "groupId": "arrangement",
  "optionId": "compact-grid"
}
```

The fixture includes `structureHash` `51616a81efd7fe21b9d215a697532924cacd3e37aff2c250af43d0944d910182` and `constraintHash` `6aabe7d629c36395e1cb12ec3b45085f077e8d8c445cdfbe676cc8fe0eed0d5e`. The fixture test recomputes both with the exported central functions and validates the full plan.

**Do not interpret this test fixture as a production DemoCoffee registration.** The central v2 implementation has no Production host registration, v2 endpoint, or host-side preset application. A real integration needs an approved policy and matching host implementation first.

## v1 / v2 separation

- Keep v1 requests, models, plans, validators, routes, and hashes on their existing v1 code path.
- Use `schemaVersion: 2` and `contractVersion: "universal-layout.v2"` only with v2 model/plan schemas and validators.
- Do not translate a v1 plan into v2 implicitly or accept a v2 plan with the v1 validator.
- Keep the full v2 model/policy validation immediately before any host-side application.

## Files to provide to a host project

Primary handoff:

1. `UNIVERSAL_V2_HOST_INTEGRATION.md`
2. `universal-v2-contract-export.ts`
3. `universal-v2-valid-fixtures.json`

For executable validation outside this repository, also copy the exporter dependencies while preserving the `server/` paths:

4. `server/universal-layout-contract-v2.ts`
5. `server/universal-layout-contract.ts`

Install Zod 4 in the receiving project. `server/universal-v2-conformance-fixtures.ts` contains conformance fixtures and Development policies reconstructed from submitted host reports; it is not a Production policy registry to install or register.
