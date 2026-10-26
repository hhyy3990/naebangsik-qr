# Universal v1 Civil Development API Integration

**Scope:** This document describes the current central source-code contract for the opt-in Development Mock endpoint. It is not a Production API contract. `civil-kiosk-mock` is a Development fixture, not a confirmed real or Production host identity.

## 1. Endpoint and enablement

```text
POST https://<current-development-host>/api/dev/universal-layout/plan
Content-Type: application/json
Authorization: Bearer <AI_LAYOUT_SERVICE_TOKEN>
```

The route is registered only when both conditions are true:

- `NODE_ENV=development`
- `UNIVERSAL_LAYOUT_DEV_MOCK_API=true`

The current route invokes only the deterministic in-memory Development Mock provider. It returns the first value from each component's `allowedColumns`; for the regular civil fixture that is `1`, even though both `1` and `2` are allowed. The endpoint does not invoke OpenAI or persist data.

## 2. Request envelope and strict model schema

The JSON body is a strict envelope containing exactly one key, `model`:

```json
{
  "model": {
    "schemaVersion": 1,
    "contractVersion": "universal-layout.v1",
    "hostId": "civil-kiosk-mock",
    "screenId": "civil.main-menu",
    "structureVersion": "civil-main-mock.v1",
    "structureHash": "<64 lowercase hex characters>",
    "constraintHash": "<64 lowercase hex characters>",
    "viewportClass": "regular",
    "accessibility": {
      "textScale": "standard",
      "buttonScale": "standard",
      "contrast": "standard",
      "viewportMode": null
    },
    "components": [
      {
        "id": "civil.certificate-grid",
        "kind": "repeated-card-list",
        "role": "certificate-choice-list",
        "order": 0,
        "itemCount": 18,
        "itemOrderHash": "<64 lowercase hex characters>",
        "operations": ["setColumns"],
        "allowedColumns": [1, 2],
        "minimumTouchTargetPx": 44,
        "protectedProperties": [
          "items",
          "order",
          "selection",
          "issuance-actions"
        ]
      }
    ],
    "allowedOperations": ["setColumns"]
  }
}
```

The placeholders above are explanatory. The exact privacy-free regular civil golden vector is shown in section 8.

The central Zod model schema enforces the following exact shapes and ranges:

| Field | Exact restriction |
|---|---|
| `schemaVersion` | literal integer `1` |
| `contractVersion` | literal string `"universal-layout.v1"` |
| `hostId` | `/^[a-z0-9][a-z0-9-]{0,63}$/` |
| `screenId` | `/^[a-z0-9][a-z0-9._-]{0,95}$/` |
| `structureVersion` | `/^[a-z0-9][a-z0-9._-]{0,95}$/` |
| `structureHash`, `constraintHash` | `/^[a-f0-9]{64}$/` |
| `viewportClass` | `"compact"`, `"regular"`, or `"wide"` |
| `accessibility` | strict object with `textScale` in `"standard"|"large"|"extraLarge"`, `buttonScale` in `"standard"|"large"`, `contrast` in `"standard"|"high"`, and `viewportMode` either `null` or a strict `{ "mode": "bottom", "heightPercent": 60|70|80 }` object |
| `components` | array of 1–100 strict objects |
| component `id` | `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/` |
| component `kind`, `role` | strings, each 1–64 characters |
| component `order`, `itemCount` | integers ≥0 |
| component `itemOrderHash` | `/^[a-f0-9]{64}$/` |
| component `operations` | exactly `["setColumns"]` |
| component `allowedColumns` | array of 1–6 unique integers, each 1–6 |
| component `minimumTouchTargetPx` | integer 44–96 |
| component `protectedProperties` | array of 1–32 unique strings, each 1–64 characters |
| `allowedOperations` | exactly `["setColumns"]` |

The envelope and model reject additional properties. Component IDs and orders must be unique. The registered civil policy further narrows these schema-level ranges to its exact host/screen/component values, count, order, fields, accessibility-derived columns, and hashes.

Those are schema constraints, not permission for arbitrary values: central policy validation additionally requires the registered host/screen, structure version, component metadata, accessibility-derived columns, and all hash values to agree with the central registry.

## 3. Central civil fixture values

The current central `CIVIL_SERVICE_UNIVERSAL_MOCK_POLICY` registers:

| Field | Value |
|---|---|
| `hostId` | `civil-kiosk-mock` |
| `screenId` | `civil.main-menu` |
| `structureVersion` | `civil-main-mock.v1` |
| Component `id` | `civil.certificate-grid` |
| `kind` / `role` | `repeated-card-list` / `certificate-choice-list` |
| `order` | `0` |
| `itemCountRange` | exactly `18` |
| `operations` | `["setColumns"]` |
| `allowedColumnsByViewport` | compact `[1]`; regular `[1,2]`; wide `[1,2]` |
| `minimumTouchTargetPx` | `44` |
| `protectedProperties` | `items`, `order`, `selection`, `issuance-actions` |

Central policy also restricts the component to one column for large text, large buttons, high contrast, or bottom viewport mode. The central fixture does not define a `bottomControls` input.

## 4. Hash computation and validation

The implementation in `server/universal-layout-contract.ts` uses the following canonical JSON and digest rules:

1. Recursively normalize object keys and strings to Unicode NFC.
2. Sort object keys lexicographically after key normalization.
3. Preserve array order.
4. Normalize negative zero to zero; accept only safe integers as numbers.
5. JSON-stringify the canonical value, encode it as UTF-8, and calculate SHA-256. The digest is lowercase hexadecimal.

**Structure hash input** is an object with `hostId`, `screenId`, `structureVersion`, and `components`. Components are sorted by `order`, then `id`, and include exactly `id`, `kind`, `role`, `order`, `itemCount`, and `itemOrderHash`.

**Constraint hash input** is an object with `contractVersion`, `viewportClass`, `accessibility`, `allowedOperations`, and sorted `components`. Each component contributes `id`, `operations`, `allowedColumns`, `minimumTouchTargetPx`, and `protectedProperties`. `schemaVersion` and `structureHash` are not part of this constraint-hash object.

The server does not trust caller-provided columns or hashes. It checks the submitted component against the registered policy, recomputes both hashes from the submitted model values, and rejects mismatches. For plans, it checks all model identity/hash fields and verifies every target and column value against the validated model.

## 5. Response JSON

Success is HTTP `200` with the plan itself at the JSON top level; there is no response envelope:

```json
{
  "schemaVersion": 1,
  "contractVersion": "universal-layout.v1",
  "hostId": "civil-kiosk-mock",
  "screenId": "civil.main-menu",
  "structureVersion": "civil-main-mock.v1",
  "structureHash": "<same as the validated model>",
  "constraintHash": "<same as the validated model>",
  "viewportClass": "regular",
  "operations": [
    {
      "type": "setColumns",
      "targetId": "civil.certificate-grid",
      "columns": 1
    }
  ]
}
```

The plan schema is strict. It requires the version/identity/hash/viewport fields and 1–20 operations. Each operation has exactly `type: "setColumns"`, a nonempty `targetId`, and integer `columns` 1–6; the validator then narrows target and columns to the model's registered allowlist.

## 6. HTTP errors and error bodies

The route's `fail` helper returns JSON shaped as `{ "error": "<string>" }`.

| HTTP | Current condition | Error body |
|---|---|---|
| `503` | Service token is not configured in the server runtime | `{"error":"Development Mock API 인증 설정이 없습니다."}` |
| `401` | Missing or incorrect application Bearer token | `{"error":"인증이 필요합니다."}` |
| `400` | Request envelope/model fails strict Zod schema | `{"error":"Universal v1 모델을 확인해 주세요."}` |
| `404` | Syntactically valid but unregistered host/screen | `{"error":"등록되지 않은 Development Mock 화면입니다."}` |
| `400` | Registered screen fails model/policy/hash validation inside the generator | `{"error":"INVALID_MODEL"}` |
| `502` | A later generation/plan error reaches the route catch block | `{"error":"<generation error code>"}` (or `GENERATION_FAILED` if no code is available) |

With the fixed deterministic Mock provider, a provider/network failure is not expected. If the route is disabled or the process is in Production, the route is not registered and the request falls through to the app's not-found handling; do not treat that as an API-level model error.

## 7. Two authentication layers and browser boundary

**Application/service authentication:** the exact header name is `Authorization`; the required format is `Authorization: Bearer <AI_LAYOUT_SERVICE_TOKEN>`. The route compares that token with the configured server-side service token. A literal `project-protection-bypass: true` header is not accepted as a bypass; the in-process test confirms it still receives `401`.

**Replit Development protection:** this is an outer Replit project-access gate, separate from the app's service token. Replit's External Access Token documentation recommends an `Authorization: Bearer` header for the external token. Since this app also requires that same header for its service token, a caller cannot place both tokens in one Authorization header. Replit documents `?project-protection-bypass=<external-access-token>` as a fallback; URL tokens can leak through logs, so use that only with an explicitly approved Development test and avoid logging or displaying the token-bearing URL.

Earlier supplied DemoCoffee diagnostic notes record this arrangement: Replit External Access Token in the `project-protection-bypass` query parameter and `AI_LAYOUT_SERVICE_TOKEN` in the `Authorization: Bearer` header. The current DemoCoffee source is not present in this central workspace, so that historical note is not an independent verification of its current code.

**Never expose to browser JavaScript, HTML, client bundles, browser storage, or user-visible logs:**

- `AI_LAYOUT_SERVICE_TOKEN`;
- a Replit External Access Token or any URL containing `project-protection-bypass`;
- any other server credential.

The host should call through its server-side relay. The example below uses no live token or real Development hostname. Official Replit references: [Development URLs](https://docs.replit.com/core-concepts/project-editor/app-setup/development-urls), [External Access Tokens](https://docs.replit.com/features/deployment-customization/external-access-tokens).

## 8. Privacy-free central regular golden request/response

This fixture uses only stable synthetic menu IDs and contains no end-user data. `itemOrderHash` is SHA-256 of the canonical object containing the ordered IDs `civil.certificate.01` through `civil.certificate.18`.

Expected hashes for this vector:

- `itemOrderHash`: `1f984cacde0e9014a80a73b90f15ea8a2ca3002ee5a1a65b737cd8fe11e9342c`
- `structureHash`: `70dbb9c683297736d73f982a88c107394d7c643385a653c4c3480723a1a2419b`
- `constraintHash`: `d18ee30970e42458e830b1add156184eb862d14c10633a44aa22ab1f41213b2a`

Request body:

```json
{
  "model": {
    "schemaVersion": 1,
    "contractVersion": "universal-layout.v1",
    "hostId": "civil-kiosk-mock",
    "screenId": "civil.main-menu",
    "structureVersion": "civil-main-mock.v1",
    "structureHash": "70dbb9c683297736d73f982a88c107394d7c643385a653c4c3480723a1a2419b",
    "constraintHash": "d18ee30970e42458e830b1add156184eb862d14c10633a44aa22ab1f41213b2a",
    "viewportClass": "regular",
    "accessibility": {
      "textScale": "standard",
      "buttonScale": "standard",
      "contrast": "standard",
      "viewportMode": null
    },
    "components": [
      {
        "id": "civil.certificate-grid",
        "kind": "repeated-card-list",
        "role": "certificate-choice-list",
        "order": 0,
        "itemCount": 18,
        "itemOrderHash": "1f984cacde0e9014a80a73b90f15ea8a2ca3002ee5a1a65b737cd8fe11e9342c",
        "operations": ["setColumns"],
        "allowedColumns": [1, 2],
        "minimumTouchTargetPx": 44,
        "protectedProperties": [
          "items",
          "order",
          "selection",
          "issuance-actions"
        ]
      }
    ],
    "allowedOperations": ["setColumns"]
  }
}
```

Expected deterministic HTTP `200` response body:

```json
{
  "schemaVersion": 1,
  "contractVersion": "universal-layout.v1",
  "hostId": "civil-kiosk-mock",
  "screenId": "civil.main-menu",
  "structureVersion": "civil-main-mock.v1",
  "structureHash": "70dbb9c683297736d73f982a88c107394d7c643385a653c4c3480723a1a2419b",
  "constraintHash": "d18ee30970e42458e830b1add156184eb862d14c10633a44aa22ab1f41213b2a",
  "viewportClass": "regular",
  "operations": [
    {
      "type": "setColumns",
      "targetId": "civil.certificate-grid",
      "columns": 1
    }
  ]
}
```

Although `[1,2]` is allowed for this regular model, the Development Mock deliberately returns the first allowed value, `1`. This is not evidence that an AI model chose one column.

## 9. Host-local Mock model versus central API model

The actual civil-kiosk project source is not in this workspace. The following host-side facts come from the previously supplied host golden-vector document; they have not been re-read from the current kiosk source:

- It describes the same v1 field names and the experimental identifiers `civil-kiosk-mock`, `civil.main-menu`, and `civil-main-mock.v1`, with component `civil.certificate-grid`.
- Its standard local columns are compact `[1]`, regular `[1,2]`, and wide `[1,2]`, and its 18 stable mock IDs produce the `itemOrderHash` shown above.
- It describes a host-local `bottomControls=true` policy that narrows regular columns to `[1]`. Universal v1 has no `bottomControls` model field. The central registry has no matching separate policy: the supplied golden-vector test explicitly shows that this narrowed regular model is rejected centrally as `COMPONENT_POLICY_MISMATCH`.
- The local `bottomControls` choice must therefore not be assumed to have central v1 semantics. This document does not add a v1 field or silently reinterpret the model.
- The host document records a previous wide test fixture that allowed three columns; the central fixture allows at most two. The attached host golden-vector document says its execution/mock policy was aligned to `[1,2]`, but the host source is unavailable here for current verification.

Thus the fixture values and golden hashes are reproducible in this central repository, but they do not establish the real kiosk's final `hostId`, `structureVersion`, runtime policy, or compatibility with a current external request. A separate host-source review is required before using this fixture as a real host identity.

## Sources and verification boundary

Central implementation evidence:

- `server/app.ts` — opt-in route, application Bearer authentication, host/screen gate, response/error mapping.
- `server/universal-layout-development-mock.ts` — strict `{ model }` envelope and deterministic Mock response.
- `server/universal-layout-contract.ts` — v1 schema, canonicalization, hash calculation, and model/plan validators.
- `server/universal-layout-mock-policies.ts` — current central DemoCoffee and civil Development fixture policies.
- `server/universal-layout-development-api.test.ts` and `server/universal-layout-contract.test.ts` — in-process route/auth/fixture/golden-vector assertions.

No external request, OpenAI call, Production change, Secret change, SDK change, or host-source change is part of this document.
