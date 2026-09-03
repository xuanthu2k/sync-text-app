import { createSession, credentialsMatch, expiredSessionCookie, getCookie, sessionCookie, verifySession } from "./auth";
import { error, hasJsonContentType, isSameOriginMutation, json, noContent, readJson, requestId } from "./http";
import { validateDocument, validateLogin } from "./validation";
import { cleanupUnreferencedImages, getImage, syncImageReferences, uploadImage } from "./images";

type DocumentRow = { content_json: string; revision: number; updated_at: string };
const invalidCredentials = "Tên đăng nhập hoặc mật khẩu không đúng.";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = requestId();
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
      if (request.method !== "GET" && !isSameOriginMutation(request)) return error("FORBIDDEN_ORIGIN", "Yêu cầu không hợp lệ.", 403, id);
      if (url.pathname === "/api/auth/login" && request.method === "POST") return login(request, env, id);
      if (url.pathname === "/api/auth/logout" && request.method === "POST") return noContent({ "Set-Cookie": expiredSessionCookie(url.protocol === "https:") });
      if (url.pathname === "/api/auth/session" && request.method === "GET") return session(request, env, id);
      if (url.pathname === "/api/document") return document(request, env, id);
      if (url.pathname === "/api/images" && request.method === "POST") return imageUpload(request, env, id);
      const imageId = url.pathname.match(/^\/api\/images\/([^/]+)$/)?.[1];
      if (imageId && request.method === "GET") return imageDownload(request, env, imageId, id);
      return error("BAD_REQUEST", "Endpoint không tồn tại.", 404, id);
    } catch (cause) {
      console.error(JSON.stringify({ level: "error", requestId: id, message: "Unhandled API error", cause: cause instanceof Error ? cause.message : "unknown" }));
      return error("INTERNAL_ERROR", "Máy chủ gặp lỗi. Vui lòng thử lại.", 500, id);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanupUnreferencedImages(env).then((deleted) => console.log(JSON.stringify({ level: "info", message: "Image cleanup completed", deleted }))));
  },
} satisfies ExportedHandler<Env>;

async function login(request: Request, env: Env, id: string): Promise<Response> {
  if (!hasJsonContentType(request)) return error("UNSUPPORTED_MEDIA_TYPE", "Content-Type phải là application/json.", 415, id);
  const input = validateLogin(await readJson(request));
  if (!input) return error("BAD_REQUEST", "Dữ liệu đăng nhập không hợp lệ.", 400, id);
  const usernameMatches = await credentialsMatch(input.username, env.AUTH_USERNAME, env.SESSION_SECRET);
  const passwordMatches = await credentialsMatch(input.password, env.AUTH_PASSWORD, env.SESSION_SECRET);
  if (!usernameMatches || !passwordMatches) return error("INVALID_CREDENTIALS", invalidCredentials, 401, id);
  return noContent({ "Set-Cookie": sessionCookie(await createSession(env.AUTH_USERNAME, env.SESSION_SECRET), new URL(request.url).protocol === "https:") });
}

async function imageUpload(request: Request, env: Env, id: string): Promise<Response> {
  if (!(await isAuthenticated(request, env))) return error("UNAUTHORIZED", "Phiên đăng nhập không hợp lệ.", 401, id);
  return uploadImage(request, env, id);
}

async function imageDownload(request: Request, env: Env, imageId: string, id: string): Promise<Response> {
  if (!(await isAuthenticated(request, env))) return error("UNAUTHORIZED", "Phiên đăng nhập không hợp lệ.", 401, id);
  return getImage(imageId, env, id);
}

function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  return verifySession(getCookie(request), env.SESSION_SECRET).then((value) => Boolean(value && value.sub === env.AUTH_USERNAME));
}

async function session(request: Request, env: Env, id: string): Promise<Response> {
  const value = await verifySession(getCookie(request), env.SESSION_SECRET);
  if (!value || value.sub !== env.AUTH_USERNAME) return error("UNAUTHORIZED", "Phiên đăng nhập không hợp lệ.", 401, id);
  return json({ authenticated: true, username: env.AUTH_USERNAME });
}

async function document(request: Request, env: Env, id: string): Promise<Response> {
  const value = await verifySession(getCookie(request), env.SESSION_SECRET);
  if (!value || value.sub !== env.AUTH_USERNAME) return error("UNAUTHORIZED", "Phiên đăng nhập không hợp lệ.", 401, id);
  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT content_json, revision, updated_at FROM documents WHERE id = 'main'").first<DocumentRow>();
    if (!row) throw new Error("Main document missing; apply migration first");
    return json({ content: JSON.parse(row.content_json), revision: row.revision, updatedAt: row.updated_at });
  }
  if (request.method !== "PUT") return error("BAD_REQUEST", "Method không được hỗ trợ.", 405, id);
  if (!hasJsonContentType(request)) return error("UNSUPPORTED_MEDIA_TYPE", "Content-Type phải là application/json.", 415, id);
  const input = validateDocument(await readJson(request));
  if (input === "too_large") return error("PAYLOAD_TOO_LARGE", "Nội dung vượt quá 512 KiB.", 413, id);
  if (!input) return error("BAD_REQUEST", "Nội dung không hợp lệ.", 400, id);
  const update = await env.DB.prepare("UPDATE documents SET content_json = ?, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'main' AND revision = ?")
    .bind(JSON.stringify(input.content), input.baseRevision).run();
  if (!update.meta.changes) {
    const current = await env.DB.prepare("SELECT revision, updated_at FROM documents WHERE id = 'main'").first<Pick<DocumentRow, "revision" | "updated_at">>();
    if (!current) throw new Error("Main document missing; apply migration first");
    return error("REVISION_CONFLICT", "Nội dung đã được cập nhật ở một thiết bị khác.", 409, id, { current: { revision: current.revision, updatedAt: current.updated_at } });
  }
  const updated = await env.DB.prepare("SELECT revision, updated_at FROM documents WHERE id = 'main'").first<Pick<DocumentRow, "revision" | "updated_at">>();
  if (!updated) throw new Error("Main document disappeared");
  try { await syncImageReferences(input.content, env, id); }
  catch (cause) { console.error(JSON.stringify({ level: "error", requestId: id, message: "Image reference sync failed", cause: cause instanceof Error ? cause.message : "unknown" })); }
  return json({ revision: updated.revision, updatedAt: updated.updated_at });
}
