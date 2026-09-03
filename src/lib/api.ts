import { ApiClientError, type DocumentData, type ImageUploadResult, type SaveResult, type Session } from "./types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => undefined) as { error?: { code?: string }; current?: { revision: number; updatedAt: string } } | T | undefined;
  if (!response.ok) {
    const error = payload as { error?: { code?: string }; current?: { revision: number; updatedAt: string } } | undefined;
    throw new ApiClientError(response.status, error?.error?.code, error?.current);
  }
  return payload as T;
}

export const api = {
  session: () => call<Session>("/api/auth/session"),
  login: (username: string, password: string) => call<void>("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }),
  logout: () => call<void>("/api/auth/logout", { method: "POST" }),
  document: () => call<DocumentData>("/api/document"),
  save: (content: unknown[], baseRevision: number) => call<SaveResult>("/api/document", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, baseRevision }) }),
  uploadImage: (file: File) => call<ImageUploadResult>("/api/images", { method: "POST", headers: { "Content-Type": file.type }, body: file }),
};
