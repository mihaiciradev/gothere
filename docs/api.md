# HTTP API (M1–M3)

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

## Discovery and demand (M3, session optional)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/concierge` | `{ message }` (2–500 chars) → `{ mode: "ai" \| "search", reply, notice, picks }`. 30/min per IP; AI mode 6 per 10 min per person, then plain search. |
| POST | `/api/demand/views` | `{ inventoryItemIds }` (≤ 12); only sold-out items count; once per person, item and day. |
| POST | `/api/demand/searches` | `{ query }`; recorded only if the catalogue has no match (re-checked on the server). |
| POST | `/api/demand/waitlist` | `{ inventoryItemId }`; signed in; sold-out items only; idempotent. |

Anonymous callers receive a random first-party `gt_vid` cookie (HttpOnly, SameSite=Lax), stored only as a keyed hash.

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

### Intelligence and governed actions (M3)

The organization in the path is checked against the caller's stored membership; resources referenced inside must
belong to it (`404` otherwise).

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/organizer/organizations/:organizationId/actions/:actionId` | Any organization-scope registry action invoked by a person (`initiator: user`). Body: the action's input. `200` executed, `202` pending approval. |
| POST | `/api/organizer/organizations/:organizationId/analysis` | `demand.analyze`; AI briefs are written afterwards when AI is configured. |
| POST | `/api/organizer/organizations/:organizationId/recommendations/:id/delegate` | The agent (or, without AI, a fixed automation) drafts and requests publication. |
| POST | `/api/organizer/organizations/:organizationId/recommendations/:id/dismiss` | `experience.write` |
| POST | `/api/organizer/organizations/:organizationId/action-requests/:id/decision` | `{ decision: "approve" \| "reject", paramsHash, note? }`; needs `action.approve` and the action's permission. Approval executes. |
| POST | `/api/organizer/organizations/:organizationId/action-requests/:id/execute` | Approver only; retries an approved request that did not complete; at most once. |

## Machine endpoints

| Method | Path | Authentication |
| --- | --- | --- |
| POST | `/api/payments/simulator/webhook` | HMAC-SHA256 `x-simulator-signature: t=<unix>,v1=<hex>` over `t.body`, 5-minute window |
| GET, POST | `/api/operations/run` | `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it automatically) |
