import type { Env } from "../env";
import { isDemoProvider } from "../env";

export interface SnapshotProvenance {
  turnover_trustworthy?: boolean;
  turnover_source?: string;
  label?: string;
}

/** 演示/合成数据一律不可信；禁止用收盘价×成交量推算成交额参与筛选 */
export function isTurnoverTrustworthy(env: Env, provenanceJson: string | null, turnoverCents: number | null | undefined): boolean {
  if (isDemoProvider(env)) {
    return false;
  }
  if (turnoverCents == null || !Number.isFinite(turnoverCents) || turnoverCents <= 0) {
    return false;
  }
  if (!provenanceJson) return false;
  try {
    const p = JSON.parse(provenanceJson) as SnapshotProvenance;
    return p.turnover_trustworthy === true && p.turnover_source !== "synthetic";
  } catch {
    return false;
  }
}

export async function turnoverFilterSupported(env: Env, db: D1Database): Promise<{
  supported: boolean;
  reason?: string;
}> {
  if (isDemoProvider(env)) {
    return {
      supported: false,
      reason: "当前为合成演示行情（DEMO），无供应商披露的成交额字段，成交额条件不可用",
    };
  }
  const row = await db
    .prepare(
      `SELECT provenance_json FROM data_snapshots
       WHERE provenance_json LIKE '%turnover_trustworthy%' LIMIT 1`,
    )
    .bind()
    .first<{ provenance_json: string }>();
  if (!row) {
    return { supported: false, reason: "尚无标注为可信的成交额快照，成交额条件不可用" };
  }
  try {
    const p = JSON.parse(row.provenance_json) as SnapshotProvenance;
    if (p.turnover_trustworthy === true) {
      return { supported: true };
    }
  } catch {
    /* ignore */
  }
  return { supported: false, reason: "成交额数据来源未通过可信校验" };
}
