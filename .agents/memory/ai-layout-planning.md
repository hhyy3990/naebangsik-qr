---
name: AI kiosk layout planning
description: Product constraints for the first AI-selected kiosk layout transformation.
---

The first demonstration targets only the DemoCafe menu-list screen. OpenAI must choose from a server- and host-allowlisted set of predefined layouts (initially two-column cards or a one-column list). Never execute model-generated HTML, CSS, or JavaScript. Preserve every product, category, price, and existing click/order/payment behavior. Validate the plan centrally and again in the host or SDK; if the request or validation fails, keep the existing layout.

**Why:** The goal is to demonstrate an actual model-selected layout while keeping the kiosk's data and business actions under application control.

**How to apply:** Keep layout analysis and plan schemas reusable across hosts, but scope the first implementation and UI behavior to the DemoCafe menu list.
