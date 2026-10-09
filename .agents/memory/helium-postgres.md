---
name: Helium PostgreSQL boundary
description: The existing database provider and preservation boundary for profile and QR data.
---

Use the project's existing Helium PostgreSQL database. Do not replace the provider or alter profile/QR data, permissions, or schema as part of deployment configuration unless the user explicitly asks.

**Why:** The user explicitly requires those existing capabilities and data structures to remain unchanged.

**How to apply:** Keep deployment changes limited to runtime configuration; verify database access without schema mutations or creating real user profiles.
