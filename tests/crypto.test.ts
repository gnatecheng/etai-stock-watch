import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/crypto";

describe("password hashing", () => {
  it("verifies correct password", async () => {
    const stored = await hashPassword("test-secret");
    expect(await verifyPassword("test-secret", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });
});
