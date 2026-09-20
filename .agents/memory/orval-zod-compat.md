---
name: OpenAPI integer compatibility
description: The generated Zod client currently targets a Zod version without zod.int().
---

When extending the shared OpenAPI contract, represent numeric quantities as `number` rather than `integer` unless the generator/runtime is upgraded together.

**Why:** The installed Orval output emits `zod.int()` for OpenAPI integer fields, while this workspace resolves Zod 3, which has no top-level `int` helper and breaks the shared library typecheck.

**How to apply:** Preserve numeric validation with minimum/maximum constraints in the OpenAPI schema, regenerate clients after every spec change, and only restore integer schemas after confirming the generated Zod code and dependency version are compatible.