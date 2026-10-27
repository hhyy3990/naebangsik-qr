---
name: Development API access
description: Separate Replit development protection from the central app's own service authentication.
---

Replit External Access Tokens normally use `Authorization: Bearer ...`, while the central Development API independently requires `Authorization: Bearer AI_LAYOUT_SERVICE_TOKEN`. These credentials cannot both occupy the same Authorization header. Replit documents `?project-protection-bypass=<token>` as a fallback for the outer Development protection, but tokens in URLs can leak through logs; keep that URL out of output and logs and use a short-lived token. A literal `project-protection-bypass: true` header is not an authentication bypass.

**Why:** External callers must pass both the Replit project gate and the application's service authentication without conflating credentials.

**How to apply:** For an explicitly authorized external Development test, use the Replit-issued protection token only through its documented mechanism and the service token only as the API's Authorization Bearer. Never log or print either credential or a token-bearing URL. Do not attempt this for Production unless separately authorized.

The Development workflow's inline `NODE_ENV=development` assignment does not propagate to separate shell commands. Local scripts that need to assert Development mode must set `NODE_ENV=development` explicitly; the running workflow itself should still be verified independently.

**Why:** A local preflight initially stopped before sending any request because the shell process did not inherit the workflow command's inline environment assignment.

**How to apply:** Check workflow state and environment configuration separately, and set the mode explicitly in any one-off local validation process without printing secret values.
