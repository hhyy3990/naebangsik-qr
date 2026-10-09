---
name: Preview browser interaction checks
description: Reliable interactive verification of the running Replit Preview in Chromium.
---

For interactive Preview tests, attach through the browser-level DevTools connection and create an isolated browser context rather than connecting directly to a page target. Return booleans from DOM readiness expressions; `Runtime.evaluate` with by-value results cannot serialize DOM elements. Allow for the app to finish mounting after navigation.

**Why:** Direct page-target connections can fail even when the browser debugger is available, and treating a returned DOM node as a value can make a loaded page look unready.

**How to apply:** Use a fresh context for test-only UI flows, wait for boolean DOM/API conditions, and clean up only the test record created by the check.
