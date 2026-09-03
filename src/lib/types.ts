export type Session = { authenticated: true; username: string };
export type DocumentData = { content: unknown[]; revision: number; updatedAt: string };
export type SaveResult = { revision: number; updatedAt: string };
export type ImageUploadResult = { url: string };
export type Conflict = { revision: number; updatedAt: string };

export class ApiClientError extends Error {
  constructor(public readonly status: number, public readonly code?: string, public readonly current?: Conflict) { super(code); }
}
