---
name: OpenAI recommendation privacy
description: Privacy constraints for sending optional accessibility questionnaire answers to OpenAI.
---

Do not persist recommendation questionnaire answers in the app database or logs. Send only validated, minimal fields, block likely sensitive free text before provider calls, and set Responses API `store:false`. Explain that answers are sent to OpenAI and that default API abuse-monitoring logs may retain content for up to 30 days; `store:false` alone is not Zero Data Retention.

**Why:** The app's own no-save behavior does not eliminate OpenAI's default abuse-monitoring retention.

**How to apply:** Whenever adding AI questionnaire or recommendation flows, keep the privacy notice accurate, validate structured output before applying it, and avoid promising that external provider processing is never retained.
