# Universal v2 Development OpenAI endpoint

## Gate and endpoint

- Route: `POST /api/dev/universal-layout/v2/openai-plan`
- Registered only when `NODE_ENV=development` and
  `UNIVERSAL_LAYOUT_DEV_V2_OPENAI_PROVIDER=true`.
- The route does not depend on the v1 Mock/OpenAI flags or the v2 Fake API flag.
- Production has no route registration. The opt-in defaults to OFF.
- Authentication is the existing `Authorization: Bearer AI_LAYOUT_SERVICE_TOKEN`.
- Request body: `{ "model": <Universal v2 model> }`.
- Success response: the top-level Universal v2 plan object.
- Responses set `Cache-Control: no-store`.

## Limited Development pilot scope

The route validates the v2 schema, Development registry policy, recomputed model
hashes, and this independent pilot allow-scope before provider invocation.
`hostPolicyVerified` remains false.

- DemoCoffee: `democoffee / cafe.menu / menu.v2`, component
  `menu.product-list`, five items with the tested item-order hash,
  standard accessibility, no capabilities, and registered
  `arrangement/compact-grid`. Viewport classes must also be accepted by the
  central policy.
- Civil: `civil-kiosk-development-test / civil.main-menu /
  civil-main-menu.v2-test`, component `civil.certificate-grid`, 18 items with
  the tested item-order hash, standard accessibility, `wide` model viewport,
  `reserved-bottom-controls`, and registered
  `arrangement/reserved-safe-list`.

The v2 model contains a viewport class, not numeric dimensions. In particular,
the central endpoint cannot prove Civil is running at 1080×1920. The host's
existing 1080×1920 fail-closed gate is still mandatory. Unsupported host
profiles must not send or apply plans.

## Provider and limits

The OpenAI adapter implements the existing v2 provider interface and uses the
configured `UNIVERSAL_LAYOUT_DEV_OPENAI_MODEL` (falling back to the existing
v1 default). It sends the existing v2 prompt projection with strict JSON Schema,
`store: false`, an 18-second SDK timeout, no SDK retries, and a 500-token output
limit. The common v2 generator and Development registry validator check the
result; invalid output is rejected without repair or Fake fallback.

Each server process allows one provider invocation. Identical concurrent model
fingerprints share one in-flight result; successful plans are cached in memory
for 30 seconds. Failures are not cached and consume the process call allowance.
No request or plan bodies, credentials, URLs, or host data are written to the
new diagnostic events.

This endpoint is not enabled by setting it up. Keep the opt-in OFF until a
separately approved single real-provider test. Tests inject a fake SDK client
or v2 provider and do not make network requests.
