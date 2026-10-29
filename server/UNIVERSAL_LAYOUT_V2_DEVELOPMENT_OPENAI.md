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
  `menu.product-list`, five items with the tested item-order hash, no
  capabilities, and either Profile A (`standard/standard/standard/no viewport`,
  `arrangement/compact-grid`) or Profile G
  (`large/large/high/bottom-70`, `arrangement/single-column-list`).
  Viewport classes must also be accepted by the central policy.
- Civil: `civil-kiosk-development-test / civil.main-menu /
  civil-main-menu.v2-test`, component `civil.certificate-grid`, 18 items with
  the tested item-order hash, either Profile A or G, `wide` model viewport,
  `reserved-bottom-controls`, and registered
  `arrangement/reserved-safe-list`.

Profile G is exactly `textScale=large`, `buttonScale=large`, `contrast=high`,
and `viewportMode={mode:"bottom",heightPercent:70}`. Other combinations remain
rejected. Easy language, smart guide, scroll guidance, and voice guidance are
not v2 layout inputs and are not changed by this policy.

For the tested DemoCoffee item order, Profile G uses the same structure hash
`c4e004d4df6fd7f4b0084b0b83569667239cd81284519d46108ad5921dd5cc4e`.
Its constraint hash is `8b5e0cd6b04a2f140758ca7ed6d6652bea0a592818c55317f9f39a96fbaed594`
for `compact` and `34f297aaeb54dfce542b9478a623b6b92420bd576e10e13766558bdc83b86e28`
for `regular`. Civil Profile G uses structure hash
`5ee50fd98eb1ba357232fbc21a39c78b1721925491635b9943a7027cab4eed0b` and
constraint hash `67db940ccb6a69a59f0d13cc902dfa610d4e24a929021efbc2270b7e5033d3e9`.

The Development registry accepts only the exact A and G accessibility tuples
for these host registrations. The v2 model contains a viewport class, not numeric dimensions. In particular,
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
