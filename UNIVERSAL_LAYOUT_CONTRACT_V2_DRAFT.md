# Universal Layout Contract v2 — Draft

**Status:** local prototype only. No API route, provider, host, SDK, cache, or Production integration is enabled.

## Why v2 is separate

Universal v1 expresses user accessibility preferences (`textScale`, `buttonScale`, `contrast`, `viewportMode`) and registry-resolved `allowedColumns`. It has no field for other layout conditions such as persistent controls reserving the bottom edge. The v1 registry therefore correctly rejects a regular model that claims `[1]` when its registered policy calculates `[1, 2]`.

Do not weaken that equality check or modify v1 hashes. A v1 payload cannot carry this state without changing its strict wire schema and hash inputs.

## Proposed v2 field

```ts
layoutCapabilities: ["reserved-bottom-controls"]
```

This is a small, extensible set of registered layout conditions, distinct from a user preference or a host-supplied column count. `reserved-bottom-controls` means that the host has positively determined that active, persistent UI reserves usable screen space along the bottom edge, and that content governed by the registered policy must not be laid out as if that space were available. It is not a control's preference flag and is not merely a claim that a footer element exists in the DOM.

The capability's presence is an assertion about current layout state. Its absence means only “not asserted”; it is not evidence that no fixed footer, navigation, or other bottom UI exists. The current prototype interprets absence as no additional capability-based restriction, so a production host must not send an empty capability list when detection is unknown or incomplete if that could permit an unsafe layout. In that case the host should withhold AI layout application and use its safe non-AI layout until it can determine the state.

The capability is generic across kiosks. It can describe a fixed control bar, bottom navigation, or any other persistent UI that reduces the usable content area or creates a no-overlap region. Its name and v2 wire representation remain unchanged in this prototype. The one-column effect below is a registry policy choice for the affected component, not an inherent rule that every bottom reservation universally requires one column.

Each host/screen policy declares:

- which capabilities it permits;
- which registered component(s) each capability affects;
- the maximum permitted columns for those components.

The central resolver starts with the registered viewport/accessibility columns and applies the capability rules. It then compares the submitted `allowedColumns` against that derived result. Unknown, duplicate, unsupported, or misconfigured capabilities are rejected. The caller cannot widen or narrow the resolved set by editing `allowedColumns`.

The local prototype registers `reserved-bottom-controls` for the civil fixture and limits its certificate grid to one column. It does not register this capability for DemoCoffee. These are mock policies, not approval of either real host's policy.

## v2 fields and hashes

v2 retains the v1 model and plan fields, with `schemaVersion: 2`, `contractVersion: "universal-layout.v2"`, and required `layoutCapabilities`.

- **Structure hash:** SHA-256 over canonical JSON containing schema/contract version, host, screen, structure version, and ordered component identity/state including `itemCount` and `itemOrderHash`.
- **Constraint hash:** SHA-256 over canonical JSON containing schema/contract version, viewport, accessibility summary, sorted `layoutCapabilities`, allowed operations, and registry-resolved component constraints including `allowedColumns`.
- v1 continues to use its existing hash input unchanged. v2 explicitly namespaces both hashes with its schema and contract versions.

The prototype reuses the v1 canonical JSON/SHA-256 primitive, but has independent v2 model and plan schemas, policy resolution, and validators. It is not wired to the v1 generator or route.

## Compatibility and cache isolation

- v1 requests and plans remain accepted only by the v1 schema and validator.
- v2 requests and plans are accepted only by the v2 schema and validator.
- Cross-version model/plan use fails strict schema validation.
- Any future cache must include schema version, contract version, host, screen, structure version/hash, and constraint hash in its key. No cache was added or changed in this prototype.
- The current generator is typed to v1 model/plan types and calls the v1 validator; it cannot safely be reused as-is. A future integration should extract only the provider transport/orchestration after contract selection, while keeping each version's strict schema and final validator separate.

## Host and trust boundary

The capability is a host-reported runtime condition. Central validation can ensure that the capability is registered and that its policy-derived effect is enforced; it cannot independently inspect the kiosk DOM or prove the host reported the physical layout correctly. User preference and actual reserved space are separate: for example, `bottomControls: false` does not imply that no footer is fixed, and `bottomControls: true` alone does not prove that it occupies space in the current viewport. Likewise, viewport mode is an independent accessibility setting and must not be used as a proxy for this capability.

The host adapter must derive the capability from its actual screen state, and the host must validate the returned plan again. No universal CSS measurement rule is established yet. Before a real host can safely assert this capability, it needs a documented measurement/state rule covering at least:

- whether the control region is currently visible, enabled, and fixed/sticky for the active screen;
- its rendered bounding rectangle relative to the visual/layout viewport, including bottom edge and overlap with the content region;
- the usable content rectangle after safe-area insets and reserved controls, plus viewport dimensions and orientation;
- changes caused by resize, orientation, zoom, keyboard/overlay appearance, responsive breakpoints, or controls being added/removed;
- the threshold and rounding rule for deciding that a non-zero region is reserved, and how unknown/measurement failure is handled.

Possible browser inputs include `getBoundingClientRect()`, viewport dimensions, safe-area insets, and resize/layout observation, but these are candidates for host implementation—not a prescribed or browser-tested algorithm in this draft.

Any capability addition/removal changes the constraint hash. A plan produced for the previous state must therefore be rejected against the new model. A host must also cancel or ignore already-issued stale plans when the measured state changes.

The requested SDK v0.5.31 and kiosk host source were not present in this workspace. Only a v0.5.28 SDK archive was attached. Therefore this prototype does not claim that v0.5.31 exposes the required state or that either real host currently sends it.

## Mock verification

`server/universal-layout-contract-v2.test.ts` covers:

- normal civil fixture: 1- and 2-column plans accepted;
- registered `reserved-bottom-controls`: 1-column accepted, 2-column rejected;
- no capability asserted: the mock registry applies no capability-specific restriction; this does not prove the physical absence of bottom UI;
- capability asserted for a persistent reserved area regardless of the user's preference value: policy limits the registered component to one column;
- viewport-mode accessibility restriction without the capability: any one-column result comes from the independent accessibility policy, not from an inferred bottom-control capability;
- capability appearance/removal: constraint hashes change, and a plan from the old model is rejected;
- unknown and cross-host capabilities rejected;
- caller-edited column sets and hash mismatches rejected;
- cross-host plans rejected;
- v1-shaped models/plans rejected by v2 validation.

These are pure policy/validator mocks. They do not measure CSS, establish a real host's detection algorithm, or prove that a particular SDK preference matches physical layout.

The v2 module and these tests are local-only. No OpenAI call, central API request, Production deployment, host/SDK change, or v1 behavior change is part of this draft.

## Host synchronization before integration

Before registering or using v2 in a service:

1. Confirm the real host ID, screen, structure version, and whether the SDK exposes the persistent-control state.
2. Implement host-side capability detection from actual layout state; do not infer the capability from a user profile preference alone. Treat unknown detection as unsafe for AI layout application rather than assuming no reserved area.
3. Have both sides use the same v2 schema, capability registry, canonicalization, hash inputs, and golden vectors.
4. Keep v1 clients on v1 and v2 clients on v2; do not silently reinterpret v1 requests.
5. Add an explicitly gated Development API/provider integration only after host conformance tests pass.

No Production identity or capability policy is approved by this draft.
