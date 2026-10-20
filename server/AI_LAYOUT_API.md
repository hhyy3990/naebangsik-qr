# AI layout planning API

`POST /api/ai-layout/plan` returns a validated layout plan. It does not render or apply a plan. The host application must validate the response against its current screen and preserve existing controls and business behavior.

## Availability and authentication

- The route requires `Authorization: Bearer <service-token>`.
- Configure `AI_LAYOUT_SERVICE_TOKEN` in Replit Secrets separately for each environment. Do not put it in browser code, source files, or the shared SDK.
- The existing `OPENAI_API_KEY` is reused server-side. `OPENAI_MODEL` is optional; the default is `gpt-4o-mini`.
- DemoCafe `democoffee` / `cafe.menu` v2 is registered with a host-specific validator. Other hosts/screens still require a separate server policy.
- The in-memory request limit defaults to 10 distinct requests per host per 10 minutes. Identical requests reuse a 30-second in-memory plan to avoid duplicate calls. Both mechanisms are per process, not global across Autoscale instances.

## DemoCafe menu v2 request

DemoCafe v2 uses its source-defined model (`schemaVersion: 2`, `hostId`, `screenId`, `structureVersion`, `structureHash`, `constraintHash`, `viewportClass`, groups, protected properties, allowed operations, and constraints). It is validated separately from the legacy generic SHA-256 layout request; the legacy contract remains available for its own registered hosts.

- The server reconstructs the documented `STRUCTURE` string in its exact order and computes JavaScript `charCodeAt`-based 32-bit FNV-1a. Only `menu.v2` hash `837f86b3` is accepted.
- The server parses the strict, insertion-ordered constraint object, hashes its `JSON.stringify` using the same FNV-1a routine, and compares the resulting 8-character digest. It does not accept a caller-supplied hash without recomputation.
- The model's groups, required/protected IDs, and allowed operation list must match the registered policy.
- Only the three source-defined operations and combinations/order are accepted. Product contents, order, selection behavior, and fixed controls have no mutable operation.
- Since the model has `viewportClass` but does not carry numeric viewport width, column constraints are checked conservatively from class and text/button scales: compact or nonstandard text / large buttons require `[1]`; otherwise regular permits `[1,2]`. This avoids allowing unsafe two-column plans; it can reject a host model at widths outside the verified 360/390px vectors.
- AI plans must echo schema version, screen, both hashes, and viewport class. Card flow and child basis must appear together and require effective columns of one.

The documented test vectors reproduce structure hash `837f86b3`; standard constraint hashes are `207c8de6` at 360px and `df5bb9a5` at 390px, with the supplied large-text/large-button/high-contrast/bottom-80% example `8ea80fa2`.

## Legacy generic request

The strict request schema accepts only:

- `modelVersion`, `hostAppId`, `screenId`, `structureVersion`, `structureHash`
- coarse `viewport` and `availableArea` buckets
- up to 100 stable elements with ID, semantic role, group, order, and kind
- only the required QR constraints: text size, button size, contrast, and viewport mode

It rejects unknown fields, including QR tokens, free text, form values, and business state. The host and screen must match a server-side policy; every element must be registered and required elements must be present.

`structureHash` is lowercase SHA-256 over the JSON serialization of the canonical object produced by `computeLayoutStructureHash`: model version, host ID, screen ID, structure version, and elements sorted by order then ID, with each element represented by `id`, `role`, `groupId`, `order`, and `kind`.

## Plan and safety

The plan contains a schema version, matching screen ID/version/hash, one to twenty operations, and a limited reason code. Operations are restricted to flow, alignment, gap token, column count, media position, or space ratio. A server policy supplies allowed operation names, target IDs, and values/ranges. Reordering/removing elements, changing accessibility settings, moving fixed controls, and changing product, price, order, or payment data are not supported operations.

Responses use strict OpenAI JSON Schema and are parsed and checked again with Zod against the request and registered policy. Responses are not stored (`store:false`), and errors returned to callers do not include provider error details.

## Responses

- `400`: malformed or invalid request
- `401`: missing or invalid service token
- `404`: host/screen has no registered policy
- `429`: per-process host limit exceeded (`Retry-After: 600`)
- `502`: provider failure, timeout, or invalid model plan
- `503`: service token or OpenAI API key is not configured

Production deployment secrets and production DB were not changed as part of this implementation.
