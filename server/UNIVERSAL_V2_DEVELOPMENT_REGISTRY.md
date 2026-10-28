# Universal v2 Development Policy Registry

## Scope

The registry is an in-process Development-only allowlist. It reuses the existing v2 conformance policies and `validateUniversalLayoutV2Model` / `validateUniversalLayoutV2Plan`; it does not add an API route, provider, prompt, Production registration, or host-side application logic.

Every lookup and validation entry point checks `NODE_ENV === "development"`. Calls in `test` or `production` fail closed. The Development OpenAI opt-in remains OFF; this registry does not call a provider.

## Entries currently available to Development code

| Label | Development host ID | Screen | Structure version | Component | Registry-allowed option |
|---|---|---|---|---|---|
| DemoCoffee | `democoffee` | `cafe.menu` | `menu.v2` | `menu.product-list` | `compact-grid` |
| Civil Development | `civil-kiosk-development-test` | `civil.main-menu` | `civil-main-menu.v2-test` | `civil.certificate-grid` | `reserved-safe-list` |
| Civil mock fixture | `civil-kiosk-mock` | `civil.main-menu` | `civil-main-mock.v1` | `civil.certificate-grid` | `reserved-safe-list` |

All entries retain `hostPolicyVerified: false`. The DemoCoffee and Civil Development rows are reconstructed from the supplied Development compatibility reports and marked `host-development-snapshot-validated`; the Civil mock row remains `central-conformance-fixture-only`. None is a Production registration.

## What is and is not confirmed

Confirmed from the supplied host reports and reproduced with the central v2 implementation:

- DemoCoffee's host model reports `democoffee / cafe.menu / menu.v2`, component `menu.product-list`, and only `arrangement/compact-grid`. The option requires standard text and standard button scale. For the supplied five-item ordered structure, the central validator reproduces the reported `structureHash`; the regular standard `constraintHash` also matches. Compact, regular, and wide standard constraint hashes all reproduce.
- The central Development policy now uses that host-reported option filter. At large/extra-large text or large button scale, `compact-grid` is filtered out and the host's one-column policy remains.
- Civil's host model reports `civil-kiosk-development-test / civil.main-menu / civil-main-menu.v2-test`, component `civil.certificate-grid`, and `arrangement/reserved-safe-list`. Recreating the reported 18-item ordered-ID hash, `wide` viewport, standard accessibility, and `reserved-bottom-controls` reproduces both reported hashes and validates the plan.
- Civil `reserved-safe-list` requires `reserved-bottom-controls`; the capability caps columns at one. The supplied DOM report says the visible in-flow footer and fixed QR dock both reserve bottom space, so the host includes the capability. The central validator sees the asserted capability; it does not independently inspect that DOM.
- The common v2 validator reconstructs the model from the registered policy and checks hashes, capabilities, accessibility-filtered options, and plan validity.

Still not independently confirmed:

- Direct access to the host source/runtime was not part of this task; the compatibility materials are the evidence for the observed Development snapshots.
- Other DemoCoffee item counts, ordering, accessibility combinations, viewport states, and runtime transitions were not supplied. Its `structureHash` is dynamic and must be recomputed for each current structure; the 12-item synthetic fixture hash is not used for the host.
- Civil profile variants, viewport changes, item-order changes, and capability transitions beyond the supplied live snapshot were not independently exercised.
- `validatorSourceSha256` in the DemoCoffee report does not identify a file set or digest procedure. The local central source files' individual SHA-256 values therefore cannot be compared to it directly; behavioral hashes and plans were tested instead.

The registry does not pin model hashes or infer a host match from a display label. Hashes are generated from each current model and checked by the common validator. `hostPolicyVerified` remains false because the submitted reports establish specific Development snapshot compatibility, not broad or Production host verification.

## Safety behavior

- Registry resolution requires an exact `hostId` + `screenId` pair. The new Civil Development row uses the report's `civil-kiosk-development-test`; the old `civil-kiosk-mock` row remains unchanged for central tests.
- Only the registered component and listed option ID are eligible through this Development registry.
- The common validator still rejects stale or altered structure/constraint hashes, policy mismatches, inaccessible or capability-filtered choices, malformed plans, and conflicting operations.
- DemoCoffee `compact-grid` under large text or large buttons is rejected because the option is absent from that accessibility-filtered model.
- Civil `reserved-safe-list` without `reserved-bottom-controls` is rejected. With the capability, the policy limits columns to one and does not offer `compact-grid`.
- The registry cannot detect a real fixed footer or QR dock by itself. Hosts must positively detect reserved screen space and send the capability; unknown state must not be interpreted as clear space.
- Registry lookups return copied policy data so callers cannot mutate the private allowlist by modifying a returned registration.
- v1 validators, schemas, routes, and hashes are untouched and remain independent.

## How to enable a real host registration later

Before setting `hostPolicyVerified` true or considering Production registration, verify the complete host source/runtime contract across relevant structures, accessibility states, viewports, capability transitions, and freshly computed hashes. Keep any Production registration and AI/provider route as separate, explicitly approved work.
