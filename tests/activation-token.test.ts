import { describe, it, expect } from "vitest";
import { sanitizeActivationToken } from "../src/auth/activation-token";
import { createHash } from "node:crypto";
import { sha256Hex } from "../src/lib/crypto";

describe("activation token sanitize", () => {
  it("extracts last line from token file shaped paste", () => {
    const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_";
    const pasted = `# 站主一次性激活令牌
# login: owner@staging.local
# expires: 2099-01-01
${token}`;
    expect(sanitizeActivationToken(pasted)).toBe(token);
  });

  it("returns empty for comments only", () => {
    expect(sanitizeActivationToken("# only comments\n# x")).toBe("");
  });

  it("matches node crypto sha256 with worker sha256Hex", async () => {
    const token = "test-token-line-xyz";
    const nodeHash = createHash("sha256").update(token, "utf8").digest("hex");
    const workerHash = await sha256Hex(token);
    expect(workerHash).toBe(nodeHash);
  });
});
