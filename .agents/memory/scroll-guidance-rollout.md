---
name: Scroll-guidance rollout
description: User-defined default and rollout constraints for the planned QR scroll-content hint.
---

The planned user-facing preference is “아래쪽 내용 안내”. It is opt-in: new QR profiles default to OFF; profiles missing the field normalize to OFF; kiosks without a QR keep it OFF; only an explicitly stored ON enables the hint. The preview should let users scroll to the bottom and see the hint disappear. Do not overlap fixed controls such as the QR dock or footer. The central service and shared kiosk SDK both need changes; central storage alone does not make kiosks implement the feature. The user stated SDK v0.5.29 is the current stable release and plans to manage the feature in v0.5.30.

**Why:** These defaults and release boundaries were explicitly chosen by the user to avoid enabling a new visual behavior without consent and to keep the central profile contract aligned with kiosk behavior.

**How to apply:** When implementing this feature, propagate the opt-in field through profile defaults, legacy normalization, API validation, AI recommendations, preview behavior, and the shared SDK; keep existing profiles and no-QR use disabled unless the saved profile explicitly opts in.
