---
name: Store build environment
description: The standalone ESIM ONBOARD Vite build needs the same environment values supplied by its managed workflow.
---

Run the storefront production build with both `PORT` and `BASE_PATH` defined. A missing `PORT` or `BASE_PATH` causes Vite configuration to fail before the app is compiled, while the managed storefront workflow supplies both automatically.

**Why:** The Vite configuration reads these values directly to configure the dev server and artifact base path.

**How to apply:** When verifying outside the workflow, use a temporary port and the intended artifact base path, for example `PORT=22995 BASE_PATH=/`.