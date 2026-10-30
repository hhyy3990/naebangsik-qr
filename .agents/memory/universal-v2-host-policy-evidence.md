---
name: Universal v2 host policy evidence
description: Distinguish central conformance fixtures from host-confirmed policy registrations.
---

Submitted host reports can establish model/hash compatibility when their Production Chromium candidate reproduces under the central v2 validator. DemoCoffee and Civil Production candidates now reproduce their supplied item-order, structure, and constraint hashes under their exact registered policies.

Central v2 carries viewport classes, not physical pixel dimensions, so it cannot independently prove Civil's 1080×1920 requirement. Civil may be registered based on the supplied Production browser report only while treating fail-closed exact-viewport enforcement and post-apply DOM overlap/hit-test/rollback checks as mandatory host trust conditions. The host repository is not necessarily available for independent source review.

**Why:** the user authorized Civil's central Production registration after submitting a Production Chromium safety report, while explicitly requiring the central limitation and host-side safeguards to remain visible and mandatory.

**How to apply:** recompute all submitted hashes and enforce the exact G profile, structure, item order, option, capabilities, and viewport class centrally. Document physical viewport and DOM-safety controls as non-central host preconditions; never imply the central API verifies them.
