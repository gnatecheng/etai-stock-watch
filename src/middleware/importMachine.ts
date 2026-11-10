import type { Context } from "hono";
import { timingSafeEqualString } from "../lib/crypto";
import type { Env } from "../env";

/** 专用采集机鉴权：仅 IMPORT_MACHINE_API_KEY，不涉及用户/管理员会话 */
export function requireImportMachine(c: Context<{ Bindings: Env }>): Response | null {
  const configured = c.env.IMPORT_MACHINE_API_KEY?.trim();
  if (!configured) {
    return c.json(
      {
        error: "导入机 API 未配置（IMPORT_MACHINE_API_KEY）。生产未配置时 fail-closed",
        code: "IMPORT_AUTH_NOT_CONFIGURED",
      },
      503,
    );
  }
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !timingSafeEqualString(token, configured)) {
    return c.json({ error: "导入机凭据无效", code: "IMPORT_UNAUTHORIZED" }, 401);
  }
  return null;
}
