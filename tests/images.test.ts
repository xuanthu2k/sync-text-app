import { describe, expect, it } from "vitest";
import worker from "../worker";
import { MAX_IMAGE_STORAGE_BYTES } from "../worker/images";

class MemoryD1 {
  constructor(private usedBytes = 0) {}

  prepare(sql: string) {
    return {
      bind: (...values: number[]) => ({ run: async () => {
        if (sql.startsWith("UPDATE image_quota SET used_bytes = used_bytes +")) {
          const [increment, requiredIncrement, maximum] = values;
          if (this.usedBytes + requiredIncrement > maximum) return { meta: { changes: 0 } };
          this.usedBytes += increment;
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("UPDATE image_quota SET used_bytes = MAX")) {
          this.usedBytes = Math.max(0, this.usedBytes - values[0]);
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 1 } };
      } }),
      first: async () => ({ content_json: "[]", revision: 0, updated_at: "2026-09-03T10:30:00.000Z" }),
    };
  }
}

class MemoryR2 {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, value: Uint8Array, options: R2PutOptions): Promise<void> {
    const metadata = options.httpMetadata;
    const contentType = metadata instanceof Headers ? metadata.get("content-type") : metadata?.contentType;
    this.objects.set(key, { bytes: value, contentType: contentType ?? "application/octet-stream" });
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Response(object.bytes.buffer as ArrayBuffer).body!,
      size: object.bytes.byteLength,
      httpEtag: "\"test-etag\"",
      httpMetadata: { contentType: object.contentType },
    };
  }
}

async function setup(usedBytes = 0) {
  const password = crypto.randomUUID();
  const env = { AUTH_USERNAME: "xuanthuphan2k", AUTH_PASSWORD: password, SESSION_SECRET: crypto.randomUUID(), DB: new MemoryD1(usedBytes), IMAGES: new MemoryR2() } as unknown as Env;
  const login = await worker.fetch(new Request("https://app.test/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "xuanthuphan2k", password }) }), env);
  return { env, cookie: login.headers.get("set-cookie")! };
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe("image API", () => {
  it("keeps uploaded images private and returns their stored bytes", async () => {
    const { env, cookie } = await setup();
    const noAuth = await worker.fetch(new Request("https://app.test/api/images", { method: "POST", headers: { "Content-Type": "image/png" }, body: png }), env);
    expect(noAuth.status).toBe(401);

    const uploaded = await worker.fetch(new Request("https://app.test/api/images", { method: "POST", headers: { Cookie: cookie, "Content-Type": "image/png" }, body: png }), env);
    expect(uploaded.status).toBe(201);
    const { url } = await uploaded.json() as { url: string };
    expect(url).toMatch(/^\/api\/images\/[0-9a-f-]+$/);

    const noAuthRead = await worker.fetch(new Request(`https://app.test${url}`), env);
    expect(noAuthRead.status).toBe(401);
    const downloaded = await worker.fetch(new Request(`https://app.test${url}`, { headers: { Cookie: cookie } }), env);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("image/png");
    expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await downloaded.arrayBuffer())]).toEqual([...png]);
  });

  it("rejects cross-origin, spoofed, unsupported, and oversized image uploads", async () => {
    const { env, cookie } = await setup();
    const crossOrigin = await worker.fetch(new Request("https://app.test/api/images", { method: "POST", headers: { Cookie: cookie, Origin: "https://evil.test", "Content-Type": "image/png" }, body: png }), env);
    expect(crossOrigin.status).toBe(403);
    const spoofed = await worker.fetch(new Request("https://app.test/api/images", { method: "POST", headers: { Cookie: cookie, "Content-Type": "image/png" }, body: new Uint8Array([0xff, 0xd8, 0xff]) }), env);
    expect(spoofed.status).toBe(400);
    const svg = await worker.fetch(new Request("https://app.test/api/images", { method: "POST", headers: { Cookie: cookie, "Content-Type": "image/svg+xml" }, body: "<svg/>" }), env);
    expect(svg.status).toBe(415);
    const large = await worker.fetch(new Request("https://app.test/api/images", { method: "POST", headers: { Cookie: cookie, "Content-Type": "image/png" }, body: new Uint8Array(5 * 1024 * 1024 + 1) }), env);
    expect(large.status).toBe(413);
  });

  it("enforces the 500 MiB total storage cap before writing to R2", async () => {
    const { env, cookie } = await setup(MAX_IMAGE_STORAGE_BYTES - png.byteLength + 1);
    const uploaded = await worker.fetch(new Request("https://app.test/api/images", { method: "POST", headers: { Cookie: cookie, "Content-Type": "image/png" }, body: png }), env);
    expect(uploaded.status).toBe(413);
    expect(await uploaded.json()).toMatchObject({ error: { code: "IMAGE_STORAGE_LIMIT_REACHED" } });
  });
});
