import { error, json } from "./http";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_STORAGE_BYTES = 500 * 1024 * 1024;
export const IMAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_CLAIM_TIMEOUT_MS = 60 * 60 * 1000;

type ImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const imageTypes = new Set<ImageType>(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const imageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function uploadImage(request: Request, env: Env, id: string): Promise<Response> {
  const requestedType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() as ImageType | undefined;
  if (!requestedType || !imageTypes.has(requestedType)) return error("UNSUPPORTED_MEDIA_TYPE", "Chỉ hỗ trợ ảnh PNG, JPEG, WebP hoặc GIF.", 415, id);
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) return error("IMAGE_TOO_LARGE", "Mỗi ảnh tối đa 5 MiB.", 413, id);

  const bytes = await readBodyAtMost(request, MAX_IMAGE_BYTES);
  if (bytes === "too_large") return error("IMAGE_TOO_LARGE", "Mỗi ảnh tối đa 5 MiB.", 413, id);
  if (!bytes.byteLength) return error("INVALID_IMAGE", "File ảnh trống hoặc không hợp lệ.", 400, id);
  const detectedType = detectImageType(bytes);
  if (!detectedType || detectedType !== requestedType) return error("INVALID_IMAGE", "Định dạng file ảnh không hợp lệ.", 400, id);

  const reserved = await reserveImageStorage(env, bytes.byteLength);
  if (!reserved) return error("IMAGE_STORAGE_LIMIT_REACHED", "Đã đạt hạn mức lưu trữ ảnh 500 MiB.", 413, id);

  const imageId = crypto.randomUUID();
  const key = imageKey(imageId);
  const timestamp = new Date().toISOString();
  try {
    await env.IMAGES.put(key, bytes, {
      httpMetadata: { contentType: detectedType },
      customMetadata: { uploadedAt: timestamp },
    });
    await env.DB.prepare("INSERT INTO images (id, r2_key, size_bytes, content_type, created_at, unreferenced_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(imageId, key, bytes.byteLength, detectedType, timestamp, timestamp).run();
  } catch (cause) {
    await removeFailedUpload(env, key, bytes.byteLength, id);
    console.error(JSON.stringify({ level: "error", requestId: id, message: "Image upload failed", cause: cause instanceof Error ? cause.message : "unknown" }));
    return error("IMAGE_UPLOAD_FAILED", "Không thể tải ảnh lên. Vui lòng thử lại.", 502, id);
  }
  return json({ url: `/api/images/${imageId}` }, 201);
}

export async function syncImageReferences(content: unknown[], env: Env, id: string): Promise<void> {
  const referencedIds = collectImageIds(content);
  const { results } = await env.DB.prepare("SELECT id, unreferenced_at, cleanup_claimed_at FROM images").all<ImageReferenceRow>();
  const now = new Date().toISOString();
  const changes: D1PreparedStatement[] = [];
  for (const image of results) {
    if (referencedIds.has(image.id)) {
      if (image.unreferenced_at || image.cleanup_claimed_at) changes.push(env.DB.prepare("UPDATE images SET unreferenced_at = NULL, cleanup_claimed_at = NULL WHERE id = ?").bind(image.id));
    } else if (!image.unreferenced_at) {
      changes.push(env.DB.prepare("UPDATE images SET unreferenced_at = ?, cleanup_claimed_at = NULL WHERE id = ?").bind(now, image.id));
    }
  }
  if (changes.length) await env.DB.batch(changes);
}

export async function cleanupUnreferencedImages(env: Env, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - IMAGE_RETENTION_MS).toISOString();
  const staleClaimCutoff = new Date(now - CLEANUP_CLAIM_TIMEOUT_MS).toISOString();
  const { results } = await env.DB.prepare("SELECT id, r2_key, unreferenced_at FROM images WHERE unreferenced_at <= ? AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at <= ?) ORDER BY unreferenced_at LIMIT ?")
    .bind(cutoff, staleClaimCutoff, CLEANUP_BATCH_SIZE).all<CleanupCandidate>();
  if (!results.length) return 0;

  const claimTime = new Date(now).toISOString();
  let deleted = 0;
  for (const image of results) {
    const claim = await env.DB.prepare("UPDATE images SET cleanup_claimed_at = ? WHERE id = ? AND unreferenced_at = ? AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at <= ?)")
      .bind(claimTime, image.id, image.unreferenced_at, staleClaimCutoff).run();
    if (claim.meta.changes !== 1) continue;
    if ((await currentDocumentImageIds(env)).has(image.id)) {
      await env.DB.prepare("UPDATE images SET unreferenced_at = NULL, cleanup_claimed_at = NULL WHERE id = ? AND cleanup_claimed_at = ?").bind(image.id, claimTime).run();
      continue;
    }
    const stillClaimed = await env.DB.prepare("SELECT id FROM images WHERE id = ? AND cleanup_claimed_at = ? AND unreferenced_at IS NOT NULL").bind(image.id, claimTime).first<{ id: string }>();
    if (!stillClaimed) continue;
    try {
      await env.IMAGES.delete(image.r2_key);
      const removed = await env.DB.prepare("DELETE FROM images WHERE id = ? AND cleanup_claimed_at = ? AND unreferenced_at IS NOT NULL").bind(image.id, claimTime).run();
      if (removed.meta.changes === 1) deleted += 1;
    } catch (cause) {
      await env.DB.prepare("UPDATE images SET cleanup_claimed_at = NULL WHERE id = ? AND cleanup_claimed_at = ?").bind(image.id, claimTime).run();
      console.error(JSON.stringify({ level: "error", message: "Image cleanup failed", imageId: image.id, cause: cause instanceof Error ? cause.message : "unknown" }));
    }
  }
  return deleted;
}

export function collectImageIds(content: unknown): Set<string> {
  const imageIds = new Set<string>();
  collectImageIdsFromValue(content, imageIds);
  return imageIds;
}

async function reserveImageStorage(env: Env, size: number): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE image_quota SET used_bytes = used_bytes + ? WHERE id = 'main' AND used_bytes + ? <= ?")
    .bind(size, size, MAX_IMAGE_STORAGE_BYTES).run();
  return result.meta.changes === 1;
}

async function releaseImageStorage(env: Env, size: number, id: string): Promise<void> {
  try {
    await env.DB.prepare("UPDATE image_quota SET used_bytes = MAX(used_bytes - ?, 0) WHERE id = 'main'").bind(size).run();
  } catch (cause) {
    console.error(JSON.stringify({ level: "error", requestId: id, message: "Image quota release failed", cause: cause instanceof Error ? cause.message : "unknown" }));
  }
}

async function removeFailedUpload(env: Env, key: string, size: number, id: string): Promise<void> {
  try {
    await env.IMAGES.delete(key);
    await releaseImageStorage(env, size, id);
  } catch (cause) {
    console.error(JSON.stringify({ level: "error", requestId: id, message: "Failed image cleanup after upload error", cause: cause instanceof Error ? cause.message : "unknown" }));
  }
}

async function currentDocumentImageIds(env: Env): Promise<Set<string>> {
  const row = await env.DB.prepare("SELECT content_json FROM documents WHERE id = 'main'").first<{ content_json: string }>();
  if (!row) throw new Error("Main document missing during image cleanup");
  try { return collectImageIds(JSON.parse(row.content_json)); } catch { throw new Error("Document content cannot be parsed during image cleanup"); }
}

function collectImageIdsFromValue(value: unknown, imageIds: Set<string>): void {
  if (Array.isArray(value)) { for (const item of value) collectImageIdsFromValue(item, imageIds); return; }
  if (!isRecord(value)) return;
  if (value.type === "image" && isRecord(value.props) && typeof value.props.url === "string") {
    const imageId = value.props.url.match(/^\/api\/images\/([0-9a-f-]+)$/i)?.[1];
    if (imageId && imageIdPattern.test(imageId)) imageIds.add(imageId);
  }
  for (const nested of Object.values(value)) collectImageIdsFromValue(nested, imageIds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ImageReferenceRow = { id: string; unreferenced_at: string | null; cleanup_claimed_at: string | null };
type CleanupCandidate = { id: string; r2_key: string; unreferenced_at: string };

export async function getImage(imageId: string, env: Env, id: string): Promise<Response> {
  if (!imageIdPattern.test(imageId)) return error("IMAGE_NOT_FOUND", "Không tìm thấy ảnh.", 404, id);
  const object = await env.IMAGES.get(imageKey(imageId));
  if (!object) return error("IMAGE_NOT_FOUND", "Không tìm thấy ảnh.", 404, id);
  return new Response(object.body, {
    headers: {
      "Cache-Control": "private, max-age=86400, immutable",
      "Content-Length": String(object.size),
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "ETag": object.httpEtag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function imageKey(imageId: string): string {
  return `images/${imageId}`;
}

async function readBodyAtMost(request: Request, maxBytes: number): Promise<Uint8Array | "too_large"> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return "too_large";
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function detectImageType(bytes: Uint8Array): ImageType | undefined {
  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || hasBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";
  if (hasBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return undefined;
}

function hasBytes(bytes: Uint8Array, expected: number[], offset = 0): boolean {
  return bytes.length >= offset + expected.length && expected.every((value, index) => bytes[offset + index] === value);
}
