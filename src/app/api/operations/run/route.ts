import { timingSafeEqual } from "node:crypto";
import { runOperationsCycle } from "@/composition/runtime";
import { serverEnv } from "@/infrastructure/env";
import { AppError } from "@/shared/errors";
import { json, route } from "../../_lib/http";

function authorize(request: Request): void {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) throw new AppError("UNAVAILABLE", "Operations runner is not configured.");
  const presented = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    throw new AppError("UNAUTHENTICATED", "Invalid operations credentials.");
  }
}

/** Vercel Cron (GET, Authorization: Bearer $CRON_SECRET) and protected manual runs (POST). */
const run = route(
  async ({ request }) => {
    authorize(request);
    return json(await runOperationsCycle());
  },
  { csrf: false },
);

export const GET = run;
export const POST = run;
