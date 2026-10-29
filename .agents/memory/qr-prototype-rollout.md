---
name: QR prototype rollout
description: User-reported rollout stage and compatibility expectations for the central QR service.
---

The user says the central “내 방식 QR” service is being prepared for real QR integration tests. Existing Production QR profiles must be preserved; do not change, delete, migrate, or publish Production without explicit authorization.

**Why:** The user stated this testing scope and preservation boundary.

**How to apply:** Keep approved integration tests in Development. Do not infer that mocked SDK tests prove a live central-service connection.

The user currently reports DemoCoffee uses SDK v0.5.31 local source and Civil uses the v0.5.31 package; both reportedly pass fake schemaVersion 5 parsing. These host details are not independently verifiable from the central workspace. Real Production QR-to-host application is still failing and its failure stage is unlocalized.

**Why:** The user supplied updated host-version and fake-v5 test results and explicitly asked not to assume an SDK-version mismatch; the Production symptom has not been tied to a specific stage.

**How to apply:** Treat host versions and fake-v5 results as user-reported until inspected. Do not treat older SDK artifacts in the central workspace as proof of host runtime. Use sanitized status/content-type evidence before locating a Production relay failure; do not change Production without approval.

The user reports that Demo Coffee accepts official QR links only from the Production origin, its browser calls its own same-origin `POST /api/qr-profile`, and its server relays to the central Production `POST /api/profiles/resolve`; in that architecture browser CORS is not a blocker. This relay path has not been independently inspected.

**Why:** The user provided these diagnostics for Production v4 readiness; they supersede assumptions based on direct browser-to-central API calls.

**How to apply:** Treat the relay details as user-reported until the kiosk project is available, and still verify the SDK accepts the v4 response before publishing.

Before any approved Production schema change, the user requires confirmation of an actual recoverable Production backup/PITR point and review of the exact Publish schema diff. The existence of backup features alone is insufficient.

**Why:** Production QR profiles must be preserved, and recovery must be available before schema changes.

**How to apply:** Verify a concrete restore point in the Production Database tool and stop if it cannot be confirmed; permit only the explicitly approved schema changes.

The civil-service kiosk has a known unresolved issue at 320×844 with bottom controls at 80% and extremely long easy-language text: the guide body is clipped by about 11 px. Do not add a workaround or change the SDK without approval.

**Why:** The user explicitly identified this as an existing issue to verify with ordinary real-QR guidance, not to fix in the current preparation step.

**How to apply:** Include it in follow-up visual validation after an actual QR is applied; do not infer it is fixed from central API tests.
