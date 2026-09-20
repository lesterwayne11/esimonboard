# Roamly eSIM Store

Roamly is a travel eSIM storefront that loads live plans from eSIM Access and provisions purchased eSIMs.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/esim-store` — React/Vite storefront with live catalog, balance, purchase, and order-install screens.
- `artifacts/api-server/src/routes/esim.ts` — server-side eSIM catalog, balance, order, and status routes.
- `artifacts/api-server/src/lib/esim-access.ts` — HMAC-signed eSIM Access provider client.
- `lib/api-spec/openapi.yaml` — source of truth for the storefront API contract.

## Architecture decisions

- eSIM Access credentials stay server-side in `ESIM_ACCESS_CODE`; the browser only receives normalized catalog and order data.
- New orders poll the provider briefly so the storefront can return ICCID and QR install details in the purchase result.
- The storefront uses the provider's live catalog rather than seeded or hardcoded plan data.

## Product

- Browse and filter live eSIM plans by country or region.
- View current account credit and compare plan details.
- Purchase a live eSIM and open the provisioning result with QR and short install links.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The storefront purchase route places real orders against the connected eSIM Access balance; add customer payment and access control before public launch.
- Regenerate the API client after every OpenAPI change.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
