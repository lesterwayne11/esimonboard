---
name: eSIM provisioning responses
description: Temporary eSIM Access responses observed during asynchronous order provisioning.
---

eSIM Access may return error codes `200002` or `200010` from an order-status query while the order is still provisioning. These responses should be treated as retryable rather than as permanent order failures.

**Why:** Order creation is asynchronous, and the provider can report a transient status before ICCID or QR details are available.

**How to apply:** Keep polling with the provider's recommended interval and surface a pending/provisioning state until the order details become available.