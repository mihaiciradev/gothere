import { getDb } from "@/infrastructure/db/client";
import { serverEnv } from "@/infrastructure/env";
import { handleProviderNotification } from "@/modules/payments";
import { json, route } from "../../../_lib/http";

/**
 * Provider notification endpoint. Not cookie-authenticated: authenticity comes from the HMAC signature
 * (x-simulator-signature), checked before anything is parsed or stored. A valid notification can only
 * update the attempt it references, and acceptance still requires an active, unexpired reservation and
 * an amount equal to the one we recorded.
 */
export const POST = route(
  async ({ request }) => {
    const body = await request.text();
    if (body.length > 16 * 1024) return json({ received: false }, 413);
    const outcome = await handleProviderNotification(
      getDb(),
      serverEnv().PAYMENT_WEBHOOK_SECRET,
      body,
      request.headers.get("x-simulator-signature"),
    );
    return json({ received: true, outcome });
  },
  { csrf: false },
);
