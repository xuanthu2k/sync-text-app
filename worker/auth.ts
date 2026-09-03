const encoder = new TextEncoder();
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const COOKIE_NAME = "sync_text_session";

type Session = { sub: string; iat: number; exp: number };

function base64url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64url(value: string): Uint8Array | undefined {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch { return undefined; }
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function credentialsMatch(input: string, expected: string, secret: string): Promise<boolean> {
  return constantTimeEqual(await hmac(input, secret), await hmac(expected, secret));
}

export async function createSession(username: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(encoder.encode(JSON.stringify({ sub: username, iat: now, exp: now + SESSION_TTL_SECONDS } satisfies Session)));
  return `${payload}.${base64url(await hmac(payload, secret))}`;
}

export async function verifySession(value: string | undefined, secret: string): Promise<Session | undefined> {
  if (!value) return;
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)) return;
  const received = decodeBase64url(signature);
  if (!received || !constantTimeEqual(received, await hmac(payload, secret))) return;
  const decoded = decodeBase64url(payload);
  if (!decoded) return;
  try {
    const session = JSON.parse(new TextDecoder().decode(decoded)) as Session;
    if (typeof session.sub !== "string" || !Number.isInteger(session.iat) || !Number.isInteger(session.exp) || session.exp <= Math.floor(Date.now() / 1000)) return;
    return session;
  } catch { return; }
}

export function getCookie(request: Request, name = COOKIE_NAME): string | undefined {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function sessionCookie(value: string, secure: boolean): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export function expiredSessionCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}
