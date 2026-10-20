---
name: AI kiosk layout planning
description: Product constraints for the first AI-selected kiosk layout transformation.
---

The first demonstration targets only the DemoCafe menu-list screen. The user states its current menu is already one column, but the exact screen/element contract is not yet verified; do not assume a 2-column starting layout or register invented element IDs. OpenAI may select only from server- and host-allowlisted common layout operations. Never execute model-generated HTML, CSS, or JavaScript. Preserve every product, category, price, and existing click/order/payment behavior. Validate the plan centrally and again in the host or SDK; if the request or validation fails, keep the existing layout.

**Why:** The goal is to demonstrate an actual model-selected layout while keeping the kiosk's data and business actions under application control; the first screen's exact implementation must be verified in its own repository.

**How to apply:** Keep layout analysis and plan schemas reusable across hosts, but scope the first implementation and UI behavior to the DemoCafe menu list.
