# Universal v2 Development Fake API

This endpoint exposes the existing central v2 generator, Development registry,
strict plan schema, and common validators for local integration testing. It
uses a deterministic in-process Fake provider and never calls OpenAI or another
external service.

## Activation and isolation

- Route: `POST /api/dev/universal-layout/v2/fake-plan`
- Register only when `NODE_ENV=development` and
  `UNIVERSAL_LAYOUT_DEV_V2_FAKE_API=true`.
- The flag is unset by default. This route has no Production registration.
- Authentication uses `Authorization: Bearer <AI_LAYOUT_SERVICE_TOKEN>`.
- `UNIVERSAL_LAYOUT_DEV_OPENAI_PROVIDER` is unrelated and is not used by this
  endpoint.
- Responses set `Cache-Control: no-store`.

## Request

The body is strict JSON with the current v2 model under `model`; extra top-level
or model fields are rejected.

```json
{
  "model": {
    "schemaVersion": 2,
    "contractVersion": "universal-layout.v2",
    "hostId": "democoffee",
    "screenId": "cafe.menu",
    "structureVersion": "menu.v2",
    "structureHash": "c4e004d4df6fd7f4b0084b0b83569667239cd81284519d46108ad5921dd5cc4e",
    "constraintHash": "6aabe7d629c36395e1cb12ec3b45085f077e8d8c445cdfbe676cc8fe0eed0d5e",
    "viewportClass": "regular",
    "accessibility": {
      "textScale": "standard",
      "buttonScale": "standard",
      "contrast": "standard",
      "viewportMode": null
    },
    "layoutCapabilities": [],
    "components": [{
      "id": "menu.product-list",
      "kind": "repeated-card-list",
      "role": "ordered-menu-list",
      "order": 0,
      "itemCount": 5,
      "itemOrderHash": "af0c4a1b243d46755fc31fa279e936f612bf2b3914b293d67e585d6aa5fb091a",
      "operations": ["setColumns", "selectLayoutOption"],
      "allowedColumns": [1, 2],
      "optionGroups": [{
        "id": "arrangement",
        "optionIds": ["compact-grid"]
      }],
      "minimumTouchTargetPx": 44,
      "protectedProperties": ["items", "order", "selection", "actions"]
    }],
    "allowedOperations": ["setColumns", "selectLayoutOption"]
  }
}
```

This is the verified DemoCoffee regular/standard Development snapshot.
The Development registry also permits the reported Civil
(`civil-kiosk-development-test`) host/screen/version registration and preserves
its separate Civil conformance mock row.

The corresponding success plan is:

```json
{
  "schemaVersion": 2,
  "contractVersion": "universal-layout.v2",
  "hostId": "democoffee",
  "screenId": "cafe.menu",
  "structureVersion": "menu.v2",
  "structureHash": "c4e004d4df6fd7f4b0084b0b83569667239cd81284519d46108ad5921dd5cc4e",
  "constraintHash": "6aabe7d629c36395e1cb12ec3b45085f077e8d8c445cdfbe676cc8fe0eed0d5e",
  "viewportClass": "regular",
  "operations": [{
    "type": "selectLayoutOption",
    "targetId": "menu.product-list",
    "groupId": "arrangement",
    "optionId": "compact-grid"
  }]
}
```

## Response

Success is the v2 plan object itself (not wrapped in `{ "plan": ... }` or
`{ "model": ..., "plan": ... }`). The deterministic Fake provider selects the
first option already present in each eligible model component; if none is
available, it uses the first declared allowed column. The common generator
and Development registry validator reject invalid/stale models, options,
capabilities, and plans.

Expected current Development examples:

- DemoCoffee standard profile: `selectLayoutOption` → `arrangement/compact-grid`
- Civil with `reserved-bottom-controls`: `selectLayoutOption` →
  `arrangement/reserved-safe-list`

## Errors

Errors are JSON `{ "error": "<safe code>" }`. Typical statuses are `401`
for missing/invalid Bearer authentication, `400` for malformed or stale model
input, `404` for an unregistered host/screen/version, and `502` for a Fake
provider or plan-validation failure. There is no automatic repair or fallback
to the v1 Mock endpoint.

This is an internal Development integration aid, not a Production contract
approval. Host registrations retain `hostPolicyVerified: false`.
