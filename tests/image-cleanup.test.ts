import { describe, expect, it } from "vitest";
import { cleanupUnreferencedImages, IMAGE_RETENTION_MS } from "../worker/images";

type ImageRow = { id: string; r2_key: string; size_bytes: number; unreferenced_at: string | null; cleanup_claimed_at: string | null };

class CleanupD1 {
  readonly images = new Map<string, ImageRow>();
  quota = 1024;
  documentContent = "[]";

  prepare(sql: string) {
    return {
      first: async () => sql.startsWith("SELECT content_json") ? { content_json: this.documentContent } : null,
      bind: (...values: unknown[]) => ({
        all: async () => {
          if (!sql.startsWith("SELECT id, r2_key")) return { results: [] };
          const [cutoff, staleClaimCutoff, limit] = values as [string, string, number];
          return { results: [...this.images.values()].filter((image) => image.unreferenced_at && image.unreferenced_at <= cutoff && (!image.cleanup_claimed_at || image.cleanup_claimed_at <= staleClaimCutoff)).slice(0, limit) };
        },
        first: async () => {
          if (sql.startsWith("SELECT content_json")) return { content_json: this.documentContent };
          if (sql.startsWith("SELECT id FROM images")) {
            const [id, claimTime] = values as [string, string];
            const image = this.images.get(id);
            return image?.cleanup_claimed_at === claimTime && image.unreferenced_at ? { id } : null;
          }
          return null;
        },
        run: async () => {
          if (sql.startsWith("UPDATE images SET cleanup_claimed_at = ?")) {
            const [claimTime, id, unreferencedAt, staleClaimCutoff] = values as [string, string, string, string];
            const image = this.images.get(id);
            if (!image || image.unreferenced_at !== unreferencedAt || (image.cleanup_claimed_at && image.cleanup_claimed_at > staleClaimCutoff)) return { meta: { changes: 0 } };
            image.cleanup_claimed_at = claimTime;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE images SET unreferenced_at = NULL")) {
            const [id, claimTime] = values as [string, string];
            const image = this.images.get(id);
            if (!image || image.cleanup_claimed_at !== claimTime) return { meta: { changes: 0 } };
            image.unreferenced_at = null; image.cleanup_claimed_at = null;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM images")) {
            const [id, claimTime] = values as [string, string];
            const image = this.images.get(id);
            if (!image || image.cleanup_claimed_at !== claimTime || !image.unreferenced_at) return { meta: { changes: 0 } };
            this.images.delete(id); this.quota -= image.size_bytes;
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE images SET cleanup_claimed_at = NULL")) return { meta: { changes: 1 } };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      }),
    };
  }
}

class CleanupR2 {
  readonly deleted: string[] = [];
  async delete(key: string): Promise<void> { this.deleted.push(key); }
}

function setup(documentContent = "[]") {
  const db = new CleanupD1(); db.documentContent = documentContent;
  const r2 = new CleanupR2();
  return { db, r2, env: { DB: db, IMAGES: r2 } as unknown as Env };
}

const imageId = "123e4567-e89b-42d3-a456-426614174000";
const now = Date.UTC(2026, 8, 3, 3, 0, 0);
const stale = new Date(now - IMAGE_RETENTION_MS - 1).toISOString();

describe("seven-day image cleanup", () => {
  it("deletes an image still unreferenced after seven days and releases its quota", async () => {
    const { db, r2, env } = setup();
    db.images.set(imageId, { id: imageId, r2_key: `images/${imageId}`, size_bytes: 400, unreferenced_at: stale, cleanup_claimed_at: null });
    await expect(cleanupUnreferencedImages(env, now)).resolves.toBe(1);
    expect(r2.deleted).toEqual([`images/${imageId}`]);
    expect(db.images.has(imageId)).toBe(false);
    expect(db.quota).toBe(624);
  });

  it("keeps an image when the current document references it again", async () => {
    const content = JSON.stringify([{ type: "image", props: { url: `/api/images/${imageId}` } }]);
    const { db, r2, env } = setup(content);
    db.images.set(imageId, { id: imageId, r2_key: `images/${imageId}`, size_bytes: 400, unreferenced_at: stale, cleanup_claimed_at: null });
    await expect(cleanupUnreferencedImages(env, now)).resolves.toBe(0);
    expect(r2.deleted).toEqual([]);
    expect(db.images.get(imageId)).toMatchObject({ unreferenced_at: null, cleanup_claimed_at: null });
  });
});
