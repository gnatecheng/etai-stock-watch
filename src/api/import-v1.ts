import { Hono } from "hono";
import type { Env } from "../env";
import { requireImportMachine } from "../middleware/importMachine";
import {
  abandonFailedBatch,
  createImportBatch,
  publishBatch,
  stageBatchRows,
  validateBatch,
} from "../import/batch-service";

export const importV1 = new Hono<{ Bindings: Env }>();

importV1.post("/batches", async (c) => {
  const auth = requireImportMachine(c);
  if (auth) return auth;
  const body = await c.req.json<{
    batchType: "bars_daily" | "financial" | "calendar";
    source: string;
    idempotencyKey: string;
    tradeDateScope?: string;
    rowCountExpected?: number;
    scopeComplete?: boolean;
  }>();
  if (!body?.idempotencyKey || !body?.batchType || !body?.source) {
    return c.json({ error: "缺少 idempotencyKey/batchType/source", code: "INVALID_BODY" }, 400);
  }
  const created = await createImportBatch(c.env.DB, {
    batchType: body.batchType,
    source: body.source,
    idempotencyKey: body.idempotencyKey,
    tradeDateScope: body.tradeDateScope,
    rowCountExpected: body.rowCountExpected,
    scopeComplete: body.scopeComplete,
  });
  return c.json(created);
});

importV1.post("/batches/:id/stage", async (c) => {
  const auth = requireImportMachine(c);
  if (auth) return auth;
  const body = await c.req.json<{
    rows: { seq: number; payloadType: "bar" | "financial"; payload: unknown }[];
  }>();
  if (!body?.rows?.length) return c.json({ error: "rows 为空", code: "EMPTY" }, 400);
  try {
    const r = await stageBatchRows(c.env.DB, c.req.param("id"), body.rows);
    return c.json(r);
  } catch {
    return c.json({ error: "批次不可接收行", code: "BATCH_NOT_STAGING" }, 409);
  }
});

importV1.post("/batches/:id/validate", async (c) => {
  const auth = requireImportMachine(c);
  if (auth) return auth;
  const r = await validateBatch(c.env.DB, c.req.param("id"));
  return c.json(r, r.ok ? 200 : 400);
});

importV1.post("/batches/:id/publish", async (c) => {
  const auth = requireImportMachine(c);
  if (auth) return auth;
  const body = (await c.req.json<{ provider?: string; provenance?: Record<string, unknown> }>().catch(
    () => ({ provider: undefined, provenance: undefined }),
  )) as { provider?: string; provenance?: Record<string, unknown> };
  const r = await publishBatch(c.env.DB, c.req.param("id"), {
    provider: body.provider ?? "akshare-machine",
    provenance: {
      ...(body.provenance ?? {}),
      collection_source: "machine_import_v1",
    },
  });
  if (!r.published) return c.json({ error: r.reason, code: "PUBLISH_FAILED" }, 400);
  return c.json({ ok: true });
});

importV1.post("/batches/:id/abandon", async (c) => {
  const auth = requireImportMachine(c);
  if (auth) return auth;
  await abandonFailedBatch(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});
