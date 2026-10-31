# Production Universal Layout v2 demo API

## Status

This is a separate Production-only server-to-server endpoint. It is not registered
unless both `NODE_ENV=production` and
`UNIVERSAL_LAYOUT_PROD_V2_OPENAI_PROVIDER=true`. The gate is not configured by
application code; it is controlled by the Production environment.

The Production registration list contains the DemoCoffee and Civil candidates.
Both supplied item IDs and hashes reproduce under their central strict v2 model
policies. The Production gate remains OFF; other host/screen pairs fail closed
with `503 PRODUCTION_HOST_UNVERIFIED`.

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
`authSecretEnv` field: `DEMO_COFFEE_PROD_AI_TOKEN` or `CIVIL_PROD_AI_TOKEN`.
No Secrets are configured by this implementation. Replit External Access Tokens
are not application credentials and are not reused here.

## Scope and provider behavior

Each Production registration defines its own exact accessibility tuple, allowed
`viewportClass` values, capabilities, component identity/order/count/item hash,
option group, and allowed option IDs. DemoCoffee's compact and regular models
use large text, large buttons, high contrast, and bottom viewport at 70%. Both
expose option IDs in canonical order `["large-card-row", "single-column-list"]`;
each is constrained to that same accessibility tuple. The layout option is a
host-defined preset ID; the central service does not infer viewport height,
scroll burden, or DOM geometry.
The component structure hash and item-order hash are unchanged. The constraint
hash changes because the model now advertises both option IDs. A host must send
the matching new constraint hash and option list. Plans selecting the existing
`single-column-list` remain valid, while the response schema also allows
`large-card-row`. The central expected constraint hashes are
`f15b39448657ea7ff40a7ca3976ae1705eed011f3b336ef0fc3841a6ad2e0f16` for
`compact` and `30230ce0e515bb85aab7b6571de080b10eeb0153bda7e23aa990181f0c441843`
for `regular`.
This confirms reproduction by the central model generator; the host repositories
were not available for source-level review in this workspace.

Civil's supplied Production item-order, structure, and constraint hashes
reproduce under the strict policy for the exact submitted `wide` model,
`large / large / high / bottom-70` accessibility tuple,
`reserved-bottom-controls` capability, 18 ordered certificate items, and
`reserved-safe-list` option. The submitted host report also records a Production
Chromium check of the single-column layout, ordering, touch target, final-item
scroll/hit-test/click, QR dock/Footer overlap, and rollback behavior.

The model schema only carries `viewportClass` (`compact`, `regular`, or `wide`);
it has no physical pixel width/height fields. Central validation therefore
cannot prove Civil is exactly 1080×1920. Registration relies on Civil's host
runtime to fail closed unless the physical viewport is exactly 1080×1920 and to
recheck DOM overlap, hit-testing, and rollback safety after applying any plan.
These are mandatory host trust conditions, not checks performed by this API.
The supplied browser-test report is evidence of those checks, but the host
source/runtime is not present here for independent source-level review.
DemoCoffee must similarly enforce its own compact/regular runtime classification.

The plan passes the existing v2 model and plan validators; there is no Fake
fallback or SDK retry. The OpenAI response uses `store:false`, an 18-second
timeout, and a 500-token output limit.

Both entries are limited to their reproduced Production candidates. Civil's
physical viewport guard and applied-DOM safety checks remain mandatory host-side
preconditions even though the central API cannot independently enforce them.

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

1. Reconfirm both Production host snapshots and keep the Production allowlist
   separate from the Development registry.
2. Review and apply `migrations/20261031_production_v2_ai.sql` to the intended
   database through the approved schema-change process.
3. Add distinct host tokens and `OPENAI_API_KEY` to Production Secrets, and set
   a fixed `UNIVERSAL_LAYOUT_PROD_OPENAI_MODEL`.
4. Ensure host backends keep credentials server-side and use one stable
   idempotency key per demo interaction.
5. Before enabling Civil, independently confirm the host's fail-closed
   1080×1920 guard and post-apply DOM overlap/hit-test/rollback checks.
6. Obtain separate approval before enabling the Production gate or publishing.

The DemoCoffee and Civil candidate hash reproductions and central registry
entries are completed. Civil's supplied browser verification report was used;
its host source/runtime was not independently reviewed. No migration, Secrets
update, gate enablement, or deployment was performed.
