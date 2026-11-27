# HTTP API (M1)

JSON over HTTPS. Responses: `{ "data": … }` or `{ "error": { "code", "message", "details?" }, "correlationId" }`.
Every response carries `x-request-id` (a well-formed incoming `x-request-id` is reused). Error codes and HTTP
statuses come from `src/shared/errors.ts`; validation errors are `422` with `issues`.

Cookie-authenticated mutations must come from our own origin (Origin header or `Sec-Fetch-Site: same-origin`),
otherwise `403 { reason: "csrf" }`. Bodies are strict: unknown fields (e.g. prices) are rejected.

## Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/events` | Published, upcoming events with "from" price |
| GET | `/api/events/:slug` | Event, published experiences, items with live `available` / `soldOut` |

## Attendee (session cookie)

| Method | Path | Body / headers | Limits |
| --- | --- | --- | --- |
| POST | `/api/reservations` | `{ eventId, items: [{ inventoryItemId, quantity }] }`, `Idempotency-Key` | 20/min, 3 active holds |
| GET | `/api/reservations/:id` | — | owner only; includes `payments[]`, `orderId` |
| DELETE | `/api/reservations/:id` | — | owner only; releases the hold |
| POST | `/api/reservations/:id/payments` | `{ scenario? }`, `Idempotency-Key` | 10/min; amount comes from the reservation |
| GET | `/api/me/orders` | — | own orders |
| GET | `/api/me/tickets` | — | own tickets |
| GET | `/api/me/tickets/:id` | — | owner only |

`scenario` (simulator only): `success` (default), `decline`, `delayed_success`, `duplicate_notification`,
`out_of_order`, `timeout`, `unavailable`. Non-default scenarios require `PAYMENT_SIMULATOR_SCENARIOS=enabled`
(default on for local/test only) and return `403` otherwise. Every payment response has `simulated: true`.

## Organizer (session cookie + organization membership)

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/organizer/organizations/:organizationId/events` | `event.read` |
| POST | `/api/organizer/organizations/:organizationId/events` | `event.write` (creates a draft) |
| PATCH | `/api/organizer/events/:eventId` | `event.write` (fields, lifecycle) |
| POST | `/api/organizer/events/:eventId/experiences` | `experience.write` (draft + draft inventory) |
| POST | `/api/organizer/experiences/:experienceId/publish` | `experience.publish` |
| PATCH | `/api/organizer/inventory/:inventoryItemId` | `inventory.write` (capacity ≥ reserved + sold) |

Tenant is always derived from the stored row, never from the request. Non-members get `404`.

## Machine endpoints

| Method | Path | Authentication |
| --- | --- | --- |
| POST | `/api/payments/simulator/webhook` | HMAC-SHA256 `x-simulator-signature: t=<unix>,v1=<hex>` over `t.body`, 5-minute window |
| GET, POST | `/api/operations/run` | `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it automatically) |
