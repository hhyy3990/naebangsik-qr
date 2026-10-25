---
name: Universal v2 bottom reservation
description: Meaning and safe host handling for the Universal v2 reserved-bottom-controls capability.
---

In the local Universal v2 prototype, `reserved-bottom-controls` means the host positively detected active persistent UI reserving bottom screen space. It is separate from a user preference such as `bottomControls`, and the current one-column effect comes from registered host/screen policy, not from a universal inherent rule.

Capability absence means “not asserted,” not proof that no fixed bottom UI exists. A host with unknown or incomplete detection must not apply an AI plan as though the space were free; use its safe non-AI layout until runtime state is known. Any capability transition changes the constraint hash and makes a plan from the prior state stale.

**Why:** SDK preferences, DOM existence, and actual occupied layout space are not equivalent, and treating them as equivalent can cause unsafe overlap.

**How to apply:** Before real host integration, define and test how runtime visibility, rendered bounds, usable viewport, safe-area insets, responsive changes, and measurement failure determine the capability. Do not infer the capability from preference or viewport mode alone.
