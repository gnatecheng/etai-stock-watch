/**
 * 财务数据历史可见性（防前视）：
 * - announced_at 非空：仅当 announced_at <= asOfDate 可用于历史筛选
 * - announced_at 为空：不得用于历史筛选（可展示为「公告日未知」）
 */
export function finVisibleForHistoricalScreen(
  announcedAt: string | null | undefined,
  asOfDate: string,
  collectedAt: string,
): { visible: boolean; reason: string } {
  if (announcedAt) {
    const ok = announcedAt.slice(0, 10) <= asOfDate;
    return {
      visible: ok,
      reason: ok
        ? `已公告 ${announcedAt.slice(0, 10)}，在 ${asOfDate} 可见`
        : `公告日 ${announcedAt.slice(0, 10)} 晚于 asOf ${asOfDate}`,
    };
  }
  return {
    visible: false,
    reason: "公告日未知 — 不参与历史筛选（不伪造公告时点）",
  };
}

export function finRowEligibleForScreen(
  row: { announced_at: string | null; metrics_json: string },
  asOfDate: string,
  metricKey: string,
  minValue: number,
): { pass: boolean; reason: string } {
  const vis = finVisibleForHistoricalScreen(row.announced_at, asOfDate, "");
  if (!vis.visible) return { pass: false, reason: vis.reason };
  let metrics: Record<string, number | null>;
  try {
    metrics = JSON.parse(row.metrics_json) as Record<string, number | null>;
  } catch {
    return { pass: false, reason: "metrics_json 无效" };
  }
  const v = metrics[metricKey];
  if (v == null || !Number.isFinite(v)) {
    return { pass: false, reason: `指标 ${metricKey} 缺失` };
  }
  if (v < minValue) return { pass: false, reason: `${metricKey}=${v} 低于下限` };
  return { pass: true, reason: `${metricKey}=${v} 满足` };
}
