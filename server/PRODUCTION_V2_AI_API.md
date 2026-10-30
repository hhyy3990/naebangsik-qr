# Production Universal Layout v2 demo API

## Status

This is a separate Production-only server-to-server endpoint. It is not registered
unless both `NODE_ENV=production` and
`UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER=true`. The gate is not configured by
this change and must remain OFF until separate approval.

The Production registration list currently contains the DemoCoffee candidate
only. Its supplied item IDs and hashes reproduce under the central strict v2
model policy. The Production gate remains OFF; any other host/screen, including
Civil, fails closed with `503 PRODUCTION_HOST_UNVERIFIED`.

## Host request contract

- Method and path: `POST /api/production/universal-layout/v2/openai-plan`
- Request body: `{ "model": <Universal Layout v2 model> }`
- Required headers:
  - `X-Host-AI-Token`: unique secret for the registered host. This is a
    server-to-server credential and must never be sent by browser code.
  - `Idempotency-Key`: 16–128 ASCII letters, digits, `.`, `_`, `:`, or `-`;
    generate once for one demo interaction and reuse for retries.
- Success: top-level validated Universal Layout v2 plan JSON.
- Responses set `Cache-Control: no-store` and `X-Request-ID`.
- Authentication, registry, quota, and idempotency failures return safe error
  codes without provider details.

The expected auth secret is selected by the trusted Production registration's
`authSecretEnv` field. Recommended per-host names are
`DEMO_COFFEE_PROD_AI_TOKEN` and `CIVIL_PROD_AI_TOKEN`. No Secrets are configured
by this implementation. Replit External Access Tokens are not application
credentials and are not reused here.

## Scope and provider behavior

Each Production registration defines its own exact accessibility tuple, allowed
`viewportClass` values, capabilities, component identity/order/count/item hash,
option group, and single option ID. DemoCoffee's provided compact and regular
constraint hashes both reproduce with the tuple large text, large buttons, high
contrast, and bottom viewport at 70%. Its item IDs produce the supplied item
order hash, and its generated model exposes only `single-column-list`.
This confirms reproduction by the central model generator; the host repositories
were not available for source-level review in this workspace.

Civil's provided item-order, structure, and constraint hashes reproduce under
the central policy when interpreted as the wide viewport class and the same
accessibility tuple. Civil is not registered: `wide` does not prove a physical
1080×1920 viewport, and central v2 has no pixel dimensions. The host must
demonstrably enforce that exact physical viewport fail-closed before Civil can
be included.

The model schema only carries `viewportClass` (`compact`, `regular`, or `wide`);
it has no physical pixel width/height fields. Central validation therefore
cannot prove Civil is exactly 1080×1920. Civil must retain its own fail-closed
physical viewport and DOM overlap/hit-test safeguards before applying a plan.
DemoCoffee must similarly enforce its own compact/regular runtime classification.

The plan passes the existing v2 model and plan validators; there is no Fake
fallback or SDK retry. The OpenAI response uses `store:false`, an 18-second
timeout, and a 500-token output limit.

The current DemoCoffee entry is limited to the reproduced Production candidate.
Do not add Civil until host runtime evidence confirms the physical viewport
guard and its DOM overlap/hit-test protections, in addition to the IDs, item
order, constraints, G profile, and reserved-control capability.

## Shared quota and idempotency

The migration defines a singleton `demo_ai_quota` row with a hard 50-attempt
maximum and `demo_ai_idempotency` rows keyed by host and a SHA-256 hash of the
provided key. A transaction locks the singleton quota row, deletes expired
idempotency records, checks a prior key/fingerprint, and atomically reserves one
attempt before the provider call. Failed attempts remain counted. Matching
completed requests replay the stored validated plan; an in-progress key is
rejected and a key reused with different validated input is rejected.

Only the validated input fingerprint and validated result plan are stored;
raw model input, QR tokens, management keys, host credentials, and provider
responses before validation are not stored. Successful results expire after 24
hours. Expired rows are deleted opportunistically during reservation. The
current demo has a bounded number of requests; a scheduled cleanup job is not
included.

This code does not create the tables or seed the quota row. The SQL migration
must be reviewed and applied separately before enabling the gate. The quota
store fails closed if the tables or seed row are unavailable.

## Pre-deployment checklist

1. Reconfirm the DemoCoffee Production snapshot and keep the Production
   allowlist separate from the Development registry.
2. Review and apply `migrations/20261031_production_v2_ai.sql` to the intended
   database through the approved schema-change process.
3. Add distinct host tokens and `OPENAI_API_KEY` to Production Secrets, and set
   a fixed `UNIVERSAL_LAYOUT_PROD_OPENAI_MODEL`.
4. Ensure host backends keep credentials server-side and use one stable
   idempotency key per demo interaction.
5. Verify each host retains its own final DOM safety/rollback checks.
6. Obtain separate approval before enabling the Production gate or publishing.

The DemoCoffee candidate hash reproduction and central registry entry are the
only preparation steps completed here. No migration, Secrets update, gate
enablement, host-side runtime check, or deployment was performed.
