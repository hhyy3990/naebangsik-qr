---
name: Universal v2 host policy evidence
description: Distinguish central conformance fixtures from host-confirmed policy registrations.
---

DemoCoffee and Civil Universal v2 policies in the central Development registry are conformance fixtures, not verified host registrations. The Civil fixture uses mock identifiers (`civil-kiosk-mock`, `civil-main-mock.v1`). Do not treat either host's structure version, model hashes, component manifest, option declarations, accessibility state, or reserved-bottom-controls detection as matching the fixture without host evidence.

**Why:** the user stated that exact host model/hash/structureVersion/option-definition compatibility has not been confirmed and must not be assumed.

**How to apply:** keep entries Development-only and explicitly unverified. Compare host-provided model and policy data, recompute both hashes, and confirm runtime footer/QR-dock capability detection before promoting a host registration.
