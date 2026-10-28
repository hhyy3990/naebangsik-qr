---
name: Universal v2 host policy evidence
description: Distinguish central conformance fixtures from host-confirmed policy registrations.
---

Submitted Development compatibility reports now provide snapshots whose DemoCoffee and Civil hashes and plans reproduce with the central v2 validator. The DemoCoffee report uses the real five-item structure rather than the synthetic fixture; Civil's reported ID is `civil-kiosk-development-test`, distinct from the preserved central mock ID `civil-kiosk-mock`.

These reports establish only the supplied Development states, not complete host compatibility. Keep `hostPolicyVerified` false until the host source/runtime and relevant viewport, accessibility, item-order, and capability transitions are independently checked. Civil's mock ID/version remain test-only.

**Why:** the user supplied observed snapshots and required separating verified fields from unresolved policy scope; one matching snapshot is not sufficient to approve a full host registration.

**How to apply:** keep entries Development-only and explicitly unverified. Preserve the legacy mock row, recompute hashes for each host-provided model, and confirm runtime footer/QR-dock detection and profile transitions before promoting a host registration.
