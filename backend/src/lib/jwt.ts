import type { JWTPayload } from "jose";

/*
 * Thin wrapper around the `jose` library that matches the call shape the
 * rest of the codebase used with `jsonwebtoken`:
 *
 *   const token = await sign({ sub, exp }, process.env.SECRET);
 *   const payload = await verify(token, process.env.SECRET); // { sub, exp, ... }
 *
 * `jose` is published as both ESM and CJS; in this CommonJS project we load
 * it with a dynamic `import()` and cache the promise so the call sites can
 * stay simple and synchronous-looking.
 */

let josePromise: Promise<typeof import("jose")> | null = null;

function loadJose() {
  if (!josePromise) {
    josePromise = import("jose");
  }
  return josePromise;
}

function getSecret(secret: string | undefined): Uint8Array {
  if (!secret) {
    throw new Error("JWT secret is not configured (set process.env.SECRET)");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Sign a payload with HS256. The `exp` field, if present, must be a
 * Unix-style absolute timestamp in seconds (matching `jsonwebtoken`).
 */
export async function sign(
  payload: Record<string, unknown>,
  secret: string | undefined,
): Promise<string> {
  const jose = await loadJose();
  const claims: JWTPayload & Record<string, unknown> = { ...payload };
  // `jose` accepts `exp` in seconds (Unix time). The callers pass
  // `Date.now() + N`, which is milliseconds; convert to seconds here so the
  // behaviour is identical to `jsonwebtoken`.
  const expSeconds =
    typeof claims.exp === "number" ? Math.floor(claims.exp / 1000) : undefined;
  const builder = new jose.SignJWT(claims as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt();
  if (expSeconds !== undefined) {
    builder.setExpirationTime(expSeconds);
  }
  return builder.sign(getSecret(secret));
}

/**
 * Verify a token and return its payload. Throws if the token is invalid
 * or expired.
 */
export async function verify<T extends JWTPayload = JWTPayload>(
  token: string,
  secret: string | undefined,
): Promise<T> {
  const jose = await loadJose();
  const { payload } = await jose.jwtVerify(token, getSecret(secret));
  // Convert `exp` back to milliseconds so the existing call sites that
  // compare `decoded.exp` against `Date.now()` keep working unchanged.
  if (typeof payload.exp === "number") {
    (payload as Record<string, unknown>).exp = payload.exp * 1000;
  }
  return payload as T;
}
