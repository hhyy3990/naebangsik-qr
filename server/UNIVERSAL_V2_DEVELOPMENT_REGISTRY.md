# Universal v2 Development Policy Registry

## Scope

The registry is an in-process Development-only allowlist. It reuses the existing v2 conformance policies and `validateUniversalLayoutV2Model` / `validateUniversalLayoutV2Plan`; it does not add an API route, provider, prompt, Production registration, or host-side application logic.

Every lookup and validation entry point checks `NODE_ENV === "development"`. Calls in `test` or `production` fail closed. The Development OpenAI opt-in remains OFF; this registry does not call a provider.

## Entries currently available to Development code

| Label | Central fixture host ID | Screen | Central fixture structure version | Component | Registry-allowed option |
|---|---|---|---|---|---|
| DemoCoffee | `democoffee` | `cafe.menu` | `menu.v2` | `menu.product-list` | `compact-grid` |
| Civil | `civil-kiosk-mock` | `civil.main-menu` | `civil-main-mock.v1` | `civil.certificate-grid` | `reserved-safe-list` |

Both entries are marked `central-conformance-fixture-only` and `hostPolicyVerified: false`. The Civil ID and version above are explicitly mock values from the central test policy, not confirmed production host identifiers.

## What is and is not confirmed

Confirmed from central code:

- DemoCoffee conformance fixture declares `democoffee / cafe.menu / menu.v2`, component `menu.product-list`, and the `arrangement` options `compact-grid` and `large-text-list`. `compact-grid` is allowed only for standard text scale. The Development registry allowlist for this registration contains only `compact-grid`.
- Civil conformance policy declares `civil-kiosk-mock / civil.main-menu / civil-main-mock.v1`, component `civil.certificate-grid`, and `reserved-safe-list` requiring `reserved-bottom-controls`. That capability limits this component to one column. The option policy also declares `compact-grid` (excluded when the capability is active) and `large-text-list`.
- The central validator recomputes model policy, structure hash, constraint hash, capabilities, accessibility-filtered options, and plan validity against the supplied central policy.

Not confirmed from the host projects:

- Whether either host sends exactly the fixture's host ID, screen ID, structure version, component IDs/roles/order, item counts, or hashes.
- Whether the hosts' registered option IDs and `arrangement` group definitions exactly match these fixture definitions.
- Whether DemoCoffee can assert that no persistent bottom controls or QR dock reserve usable space. Its central fixture currently declares no allowed capabilities.
- How Civil detects active footer/QR-dock occupancy and when it asserts `reserved-bottom-controls`. The central capability is only a positive reservation signal; it is not inferred from a preference or from missing capability data.
- Whether the two hosts' runtime accessibility state and option availability match the central fixtures.

The registry does not pin either hash or infer a host match from a display label. Hashes are generated from each current model and checked by the common validator. Until the hosts provide their exact model/policy inputs and runtime capability evidence, these entries are conformance-only and must not be treated as confirmed host registrations.

## Safety behavior

- Registry resolution requires an exact `hostId` + `screenId` pair; the Civil test entry deliberately retains `civil-kiosk-mock`, not an assumed production ID.
- Only the registered component and listed option ID are eligible through this Development registry.
- The common validator still rejects stale or altered structure/constraint hashes, policy mismatches, inaccessible or capability-filtered choices, malformed plans, and conflicting operations.
- DemoCoffee `compact-grid` under large text is rejected because the option is absent from that accessibility-filtered model.
- Civil `reserved-safe-list` without `reserved-bottom-controls` is rejected. With the capability, the policy also limits columns to one and excludes `compact-grid`.
- The registry cannot detect a real fixed footer or QR dock by itself. Hosts must positively detect reserved screen space and send the capability; unknown state must not be interpreted as clear space.
- Registry lookups return copied policy data so callers cannot mutate the private allowlist by modifying a returned registration.
- v1 validators, schemas, routes, and hashes are untouched and remain independent.

## How to enable a real host registration later

Before treating either fixture as the host's policy, compare a host-provided v2 model and policy declaration, including structure version, component manifest/order, allowed operations, option definitions, accessibility behavior, capability detection, and freshly computed hashes. Update the Development conformance entry only after that evidence matches. Keep Production registration and any AI/provider route as separate, explicitly approved work.
