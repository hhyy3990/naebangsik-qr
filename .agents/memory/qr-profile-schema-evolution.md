---
name: QR profile schema evolution
description: Preserve existing QR profile data while introducing versioned preference fields.
---

When the central QR profile preference contract changes, normalize legacy v1/v2 settings into the current API response without rewriting stored JSONB on reads. For the retired `bottomControls` flag, expose `viewportMode: null`; retain all unrelated preferences, profile IDs, and QR token hashes. New user-initiated saves persist the current schema version and shape.

**Why:** This lets old QR profiles remain readable without bulk data changes, keeps token and management behavior stable, and avoids forcing an unreviewed Production data migration.

**How to apply:** Add the next version to the schema-version CHECK and default only in the approved environment, cover legacy normalization and no-write-on-read with tests, and inspect the Production schema diff before publishing.
