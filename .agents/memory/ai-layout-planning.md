---
name: AI kiosk layout planning
description: Product constraints for the first AI-selected kiosk layout transformation.
---

The first demonstration targets only DemoCafe `cafe.menu` contract v2 (`menu.v2`, structure hash `837f86b3`, host `democoffee`). Its source-defined structure hash is JS `charCodeAt` FNV-1a over an ordered string array; constraint hash is the same FNV-1a over insertion-ordered `JSON.stringify(constraints)`. Plans support only columns, paired card flow+basis, and the documented ordering/ranges. Never trust caller hashes without recomputing, execute model-generated code, or change product/category/price/order/payment behavior. The model has viewport class but no numeric width, so central column checks must fail closed if they cannot verify a condition; the host must validate again.

**Why:** The goal is to demonstrate an actual model-selected layout while keeping the kiosk's data and business actions under application control; trusting opaque hashes or operation semantics could authorize unsafe layouts.

**How to apply:** Keep host-specific request/plan contracts isolated from the legacy generic SHA-256 schema; recompute the documented hashes and enforce the host's model, accessibility, pairing, and ordering rules.

For central AI-layout diagnostics, log only a random request ID, controlled stage names, status/error codes, OpenAI-attempt and timeout booleans. Never log credentials, QR/profile data, request bodies, generated plans, or token-bearing URLs; keep client errors generic.

**Why:** Cross-app failures need stage-level evidence without turning diagnostic logs into a source of credentials or user data.

**How to apply:** Add diagnostics at the central endpoint and provider adapter, expose the random request ID as a response header for relay correlation, and use mocked providers for tests.
