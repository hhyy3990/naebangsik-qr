---
name: QR prototype rollout
description: User-reported rollout stage and compatibility expectations for the central QR service.
---

The user says the central “내 방식 QR” service is being prepared for real QR integration tests. Existing Production QR profiles must be preserved; do not change, delete, migrate, or publish Production without explicit authorization.

**Why:** The user stated this testing scope and preservation boundary.

**How to apply:** Keep approved integration tests in Development. Do not infer that mocked SDK tests prove a live central-service connection.

The demo coffee and unattended civil-service kiosk projects are separate Replit projects, each reported by the user to use SDK v0.5.27. Previous profile tests used mocked API responses; actual central-service integration has not been verified from this workspace.

**Why:** The user supplied these current project details and asked that unsupported kiosk behavior not be claimed as available.

**How to apply:** Inspect both consumer projects before asserting endpoint or response compatibility. If connection changes are needed, report the exact project, code, and reason and wait for approval.

The civil-service kiosk has a known unresolved issue at 320×844 with bottom controls at 80% and extremely long easy-language text: the guide body is clipped by about 11 px. Do not add a workaround or change the SDK without approval.

**Why:** The user explicitly identified this as an existing issue to verify with ordinary real-QR guidance, not to fix in the current preparation step.

**How to apply:** Include it in follow-up visual validation after an actual QR is applied; do not infer it is fixed from central API tests.
