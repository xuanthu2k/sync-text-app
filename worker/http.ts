export type ApiErrorCode =
  | "BAD_REQUEST"
  | "INVALID_CREDENTIALS"
  | "UNAUTHORIZED"
  | "REVISION_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INVALID_IMAGE"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_STORAGE_LIMIT_REACHED"
  | "IMAGE_NOT_FOUND"
  | "IMAGE_UPLOAD_FAILED"
  | "IMAGE_CLEANUP_FAILED"
  | "FORBIDDEN_ORIGIN"
  | "INTERNAL_ERROR";

const apiHeaders = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export function requestId(): string {
  return crypto.randomUUID();
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...apiHeaders, ...headers } });
}

export function noContent(headers?: HeadersInit): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", ...headers } });
}

export function error(code: ApiErrorCode, message: string, status: number, id?: string, extra?: object): Response {
  return json({ error: { code, message, ...(id ? { requestId: id } : {}) }, ...extra }, status);
}

export function hasJsonContentType(request: Request): boolean {
  return request.headers.get("content-type")?.toLowerCase().startsWith("application/json") ?? false;
}

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function readJson(request: Request): Promise<unknown | undefined> {
  try { return await request.json(); } catch { return undefined; }
}
