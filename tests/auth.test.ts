import { describe, expect, it } from "vitest";
import { createSession, credentialsMatch, verifySession } from "../worker/auth";

describe("signed sessions", () => {
  const secret = crypto.randomUUID();
  it("creates a session that verifies", async () => {
    const token = await createSession("xuanthuphan2k", secret);
    await expect(verifySession(token, secret)).resolves.toMatchObject({ sub: "xuanthuphan2k" });
  });
  it("rejects a changed signature or payload", async () => {
    const token = await createSession("xuanthuphan2k", secret);
    await expect(verifySession(`${token}x`, secret)).resolves.toBeUndefined();
    await expect(verifySession(`x${token}`, secret)).resolves.toBeUndefined();
  });
  it("uses a constant-time HMAC comparison for credentials", async () => {
    const password = crypto.randomUUID();
    await expect(credentialsMatch(password, password, secret)).resolves.toBe(true);
    await expect(credentialsMatch(`${password}x`, password, secret)).resolves.toBe(false);
  });
});
