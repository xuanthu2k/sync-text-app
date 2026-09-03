import { describe, expect, it } from "vitest";
import worker from "../worker";

class MemoryD1 {
  content = "[]"; revision = 0; updatedAt = "2026-09-03T10:30:00.000Z";
  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => ({ run: async () => {
        if (!sql.startsWith("UPDATE") || values[1] !== this.revision) return { meta: { changes: 0 } };
        this.content = values[0] as string; this.revision += 1; this.updatedAt = "2026-09-03T10:31:00.000Z";
        return { meta: { changes: 1 } };
      } }),
      first: async () => sql.includes("content_json") ? { content_json: this.content, revision: this.revision, updated_at: this.updatedAt } : { revision: this.revision, updated_at: this.updatedAt },
    };
  }
}

const testPassword = () => crypto.randomUUID();
async function setup() {
  const password = testPassword();
  const env = { AUTH_USERNAME: "xuanthuphan2k", AUTH_PASSWORD: password, SESSION_SECRET: crypto.randomUUID(), DB: new MemoryD1() } as unknown as Env;
  const login = await worker.fetch(new Request("https://app.test/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "xuanthuphan2k", password }) }), env);
  return { env, cookie: login.headers.get("set-cookie")! };
}

describe("document API", () => {
  it("requires a session, saves, reloads, and detects a stale revision", async () => {
    const { env, cookie } = await setup();
    const noAuth = await worker.fetch(new Request("https://app.test/api/document"), env);
    expect(noAuth.status).toBe(401);
    const saved = await worker.fetch(new Request("https://app.test/api/document", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ content: [{ type: "paragraph" }], baseRevision: 0 }) }), env);
    expect(saved.status).toBe(200);
    const reloaded = await worker.fetch(new Request("https://app.test/api/document", { headers: { Cookie: cookie } }), env);
    expect(await reloaded.json()).toMatchObject({ content: [{ type: "paragraph" }], revision: 1 });
    const conflict = await worker.fetch(new Request("https://app.test/api/document", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ content: [], baseRevision: 0 }) }), env);
    expect(conflict.status).toBe(409);
  });
  it("rejects non-JSON and oversized requests", async () => {
    const { env, cookie } = await setup();
    const invalid = await worker.fetch(new Request("https://app.test/api/document", { method: "PUT", headers: { Cookie: cookie }, body: "{}" }), env);
    expect(invalid.status).toBe(415);
    const large = await worker.fetch(new Request("https://app.test/api/document", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ content: ["x".repeat(512 * 1024)], baseRevision: 0 }) }), env);
    expect(large.status).toBe(413);
  });
});
