import type { Env } from "../env";
import { isDemoProvider } from "../env";
import { ALLOWED_FIN_METRICS } from "../import/batch-service";

export interface FinancialScreenerCapabilities {
  supported: boolean;
  demo: boolean;
  reason?: string;
  /** 可筛选指标（已映射字段）；不承诺 PE/TTM 混搭算法 */
  metrics: {
    key: string;
    label: string;
    unitNote: string;
    currencyNote: string;
  }[];
  historicalScreenRule: string;
  pointInTimeRule: string;
}

export async function financialScreenerCapabilities(
  env: Env,
  _db: D1Database,
): Promise<FinancialScreenerCapabilities> {
  const demo = isDemoProvider(env);
  const baseMetrics = [
    {
      key: "operating_revenue",
      label: "营业收入",
      unitNote: "与入库 unit_label 一致（如人民币万元），筛选前须统一口径",
      currencyNote: "以报表币种为准，不混算 HKD/CNY",
    },
    {
      key: "net_profit_attr_parent",
      label: "归母净利润",
      unitNote: "同上",
      currencyNote: "同上",
    },
    {
      key: "basic_eps",
      label: "基本每股收益",
      unitNote: "每股，非 TTM 推算",
      currencyNote: "报表币种",
    },
    {
      key: "roe",
      label: "ROE",
      unitNote: "源字段百分比/比率，不与其他口径 ROE 混算",
      currencyNote: "—",
    },
    {
      key: "gross_margin",
      label: "毛利率",
      unitNote: "源字段",
      currencyNote: "—",
    },
  ].filter((m) => ALLOWED_FIN_METRICS.has(m.key));

  if (demo) {
    return {
      supported: false,
      demo: true,
      reason: "演示行情环境下财务筛选未启用（非 AKShare 正式入库链路）",
      metrics: baseMetrics,
      historicalScreenRule:
        "历史筛选仅使用 announced_at <= asOfDate 的版本；announced_at 为空不参与历史筛选",
      pointInTimeRule: "未知公告日不伪造；不得用于历史筛选防前视",
    };
  }

  return {
    supported: false,
    demo: false,
    reason: "正式分发许可未确认；财务筛选保持 fail-closed，待运维发布 fin_report_versions 后开启",
    metrics: baseMetrics,
    historicalScreenRule:
      "历史筛选仅使用 announced_at <= asOfDate 的版本；announced_at 为空不参与历史筛选",
    pointInTimeRule: "AKShare 免费获取不等于对外分发授权",
  };
}
