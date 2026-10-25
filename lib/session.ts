// Signed session tokens: HMAC-SHA256 over a small JSON payload, using Web Crypto only so that
// this module also runs in the Edge runtime (middleware.ts). Token format: v1.<payload>.<signature>
// (both parts base64url). The payload is {"uid": "<user id>", "exp": <unix seconds>}.
import { requireEnv } from "./env";

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

const VERSION = "v1";
const MAX_TOKEN_LENGTH = 512;
const encoder = new TextEncoder();

function getSecret(): string {
  const secret = requireEnv("SESSION_SECRET");
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return secret;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(getSecret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken(userId: number | string, ttlSeconds = SESSION_MAX_AGE_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ uid: String(userId), exp })));
  const signed = `${VERSION}.${payload}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(signed));
  return `${signed}.${toBase64Url(new Uint8Array(signature))}`;
}

// Returns the user id (a positive integer as a string) for a valid, unexpired token, otherwise null.
// The signature is checked with crypto.subtle.verify, which compares in constant time.
export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;

  const payloadBytes = fromBase64Url(parts[1]);
  const signature = fromBase64Url(parts[2]);
  if (!payloadBytes || !signature) return null;

  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    signature,
    encoder.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) return null;

  try {
    const { uid, exp } = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (typeof uid !== "string" || !/^[1-9][0-9]{0,9}$/.test(uid)) return null;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
    return uid;
  } catch {
    return null;
  }
}

// Works with `await cookies()` in route handlers and with `request.cookies` (route handlers, middleware).
export async function getSessionUserId(cookieStore: {
  get(name: string): { value: string } | undefined;
}): Promise<string | null> {
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
