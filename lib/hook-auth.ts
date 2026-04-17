/**
 * Bearer-token authentication for the Arcade Contextual Access webhook.
 *
 * Arcade calls our /api/arcade/hooks/* endpoints with:
 *   Authorization: Bearer <token>
 * where <token> matches whatever you set when registering the extension in the
 * Arcade dashboard. We read the shared secret from ARCADE_HOOKS_TOKEN.
 *
 * To support local dev without the token set, requests pass through when the
 * env var is absent — but a warning is logged so you know the endpoint is
 * unauthenticated.
 */
export function verifyHookAuth(request: Request): { ok: true } | { ok: false; status: 401 } {
  const expected = process.env.ARCADE_HOOKS_TOKEN?.trim();
  if (!expected) {
    console.warn(
      "[arcade-hooks] ARCADE_HOOKS_TOKEN not set — accepting all requests. " +
        "Set this in production so only Arcade can call the hooks."
    );
    return { ok: true };
  }
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1].trim() !== expected) {
    return { ok: false, status: 401 };
  }
  return { ok: true };
}
