---
name: AI kiosk layout planning
description: Product constraints for the first AI-selected kiosk layout transformation.
---

The first demonstration targets only DemoCafe `cafe.menu` contract v2 (`menu.v2`, reported structure hash `837f86b3`, host `democoffee`). The current menu is one column. Known semantic IDs, required elements, QR accessibility fields, and three operation families are in the user's v2 contract brief. Do not activate the policy until the exact FNV-1a and constraint-hash canonicalization plus v2 operation combinations/accessibility boundaries are verifiable; the central API's prior SHA-256/request/operation contract is incompatible. Never execute model-generated HTML, CSS, or JavaScript. Preserve every product, category, price, and existing click/order/payment behavior. Validate the plan centrally and again in the host or SDK; if the request or validation fails, keep the existing layout.

**Why:** The goal is to demonstrate an actual model-selected layout while keeping the kiosk's data and business actions under application control; mismatched or opaque hashes and operation semantics must not be accepted as proof of host compatibility.

**How to apply:** Keep layout analysis and plan schemas reusable across hosts, but only register DemoCafe v2 after its hash recipes and validator rules are confirmed; never infer them from the reported digest values alone.
