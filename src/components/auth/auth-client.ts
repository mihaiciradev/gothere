"use client";

import { createAuthClient } from "better-auth/react";

/** Browser client for Better Auth. Same origin; cookies are HttpOnly and never readable here. */
export const authClient = createAuthClient();
