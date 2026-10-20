# AI layout planning API

`POST /api/ai-layout/plan` returns a validated layout plan. It does not render or apply a plan. The host application must validate the response against its current screen and preserve existing controls and business behavior.

## Availability and authentication

- The route requires `Authorization: Bearer <service-token>`.
- Configure `AI_LAYOUT_SERVICE_TOKEN` in Replit Secrets separately for each environment. Do not put it in browser code, source files, or the shared SDK.
- The existing `OPENAI_API_KEY` is reused server-side. `OPENAI_MODEL` is optional; the default is `gpt-4o-mini`.
- No host/screen policy is currently registered in `server/layout-policies.ts`. Until a reviewed screen contract is added there, requests are rejected. This is intentional: DemoCafe's current exact element and layout contract has not been verified.
- The in-memory request limit defaults to 10 distinct requests per host per 10 minutes. Identical requests reuse a 30-second in-memory plan to avoid duplicate calls. Both mechanisms are per process, not global across Autoscale instances.

## Request

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
