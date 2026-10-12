---
name: QR prototype rollout
description: User-reported rollout stage and compatibility expectations for the central QR service.
---

The user says the central “내 방식 QR” service is a prototype before real-user rollout, and existing QR codes are test-only. Compatibility with old QR tokens or SDKs is not required.

**Why:** The user stated this product context and compatibility boundary.

**How to apply:** Do not preserve old SDK compatibility by default. Before deleting profiles or applying a destructive database migration, first verify that every targeted profile is test data.

The user reports that the demo coffee and unattended civil-service kiosk projects use common SDK v0.5.5 and passed mocked v3 response tests. Those consumer projects are not present in this central-service workspace.

**Why:** This was stated as current rollout context for the v3 Production review.

**How to apply:** Treat this as user-reported compatibility evidence, not as independently verified integration coverage; inspect the consumer projects when they are available.
