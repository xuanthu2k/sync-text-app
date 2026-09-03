const MAX_CREDENTIAL_LENGTH = 256;
export const MAX_DOCUMENT_BYTES = 512 * 1024;

export type LoginInput = { username: string; password: string };
export type DocumentInput = { content: unknown[]; baseRevision: number };

export function validateLogin(value: unknown): LoginInput | undefined {
  if (!isRecord(value) || typeof value.username !== "string" || typeof value.password !== "string") return;
  if (!value.username.length || !value.password.length || value.username.length > MAX_CREDENTIAL_LENGTH || value.password.length > MAX_CREDENTIAL_LENGTH) return;
  return { username: value.username, password: value.password };
}

export function validateDocument(value: unknown): DocumentInput | "too_large" | undefined {
  if (!isRecord(value) || !Array.isArray(value.content)) return;
  const baseRevision = value.baseRevision;
  if (!Number.isInteger(baseRevision) || typeof baseRevision !== "number" || baseRevision < 0) return;
  let serialized: string;
  try { serialized = JSON.stringify(value.content); } catch { return; }
  if (new TextEncoder().encode(serialized).byteLength > MAX_DOCUMENT_BYTES) return "too_large";
  return { content: value.content, baseRevision };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
