/**
 * Auth.js route handler. Serves sign-in, callback, and sign-out under
 * /api/auth/*, including the built-in sign-in page — this build deliberately
 * ships no custom auth UI, so the front end stays untouched.
 */

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
