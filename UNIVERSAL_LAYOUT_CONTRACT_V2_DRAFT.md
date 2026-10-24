# Universal Layout Contract v2 — Draft

**Status:** local prototype only. No API route, provider, host, SDK, cache, or Production integration is enabled.

## Why v2 is separate

Universal v1 expresses user accessibility preferences (`textScale`, `buttonScale`, `contrast`, `viewportMode`) and registry-resolved `allowedColumns`. It has no field for other layout conditions such as persistent controls reserving the bottom edge. The v1 registry therefore correctly rejects a regular model that claims `[1]` when its registered policy calculates `[1, 2]`.

Do not weaken that equality check or modify v1 hashes. A v1 payload cannot carry this state without changing its strict wire schema and hash inputs.

## Proposed v2 field

```ts
layoutCapabilities: ["reserved-bottom-controls"]
```

This is a small, extensible set of registered layout conditions, distinct from a user preference or a host-supplied column count. `reserved-bottom-controls` is a generic layout condition, not a civil-kiosk exception.

Each host/screen policy declares:

- which capabilities it permits;
- which registered component(s) each capability affects;
- the maximum permitted columns for those components.

The central resolver starts with the registered viewport/accessibility columns and applies the capability rules. It then compares the submitted `allowedColumns` against that derived result. Unknown, duplicate, unsupported, or misconfigured capabilities are rejected. The caller cannot widen or narrow the resolved set by editing `allowedColumns`.

The local prototype currently registers `reserved-bottom-controls` for the civil fixture and limits its certificate grid to one column. It does not register this capability for DemoCoffee.

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

The capability is a host-reported runtime condition. Central validation can ensure that the capability is registered and that its policy-derived effect is enforced; it cannot independently inspect the kiosk DOM or prove the host reported the physical layout correctly. The host adapter must derive the capability from its actual screen state, and the host must validate the returned plan again.

The requested SDK v0.5.31 and kiosk host source were not present in this workspace. Only a v0.5.28 SDK archive was attached. Therefore this prototype does not claim that v0.5.31 exposes the required state or that either real host currently sends it.

## Mock verification

`server/universal-layout-contract-v2.test.ts` covers:

- normal civil fixture: 1- and 2-column plans accepted;
- registered `reserved-bottom-controls`: 1-column accepted, 2-column rejected;
- unknown and cross-host capabilities rejected;
- caller-edited column sets and hash mismatches rejected;
- cross-host plans rejected;
- v1-shaped models/plans rejected by v2 validation.

The v2 module and these tests are local-only. No OpenAI call, central API request, Production deployment, host/SDK change, or v1 behavior change is part of this draft.

## Host synchronization before integration

Before registering or using v2 in a service:

1. Confirm the real host ID, screen, structure version, and whether the SDK exposes the persistent-control state.
2. Implement host-side capability detection from actual layout state; do not infer the capability from a user profile preference alone.
3. Have both sides use the same v2 schema, capability registry, canonicalization, hash inputs, and golden vectors.
4. Keep v1 clients on v1 and v2 clients on v2; do not silently reinterpret v1 requests.
5. Add an explicitly gated Development API/provider integration only after host conformance tests pass.

No Production identity or capability policy is approved by this draft.
