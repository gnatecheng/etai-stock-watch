import type { Env } from "../env";
import {
  financialScreeningAllowed,
  isDemoProvider,
  isProduction,
  isDistributionLicensed,
  isStagingDemo,
} from "../env";
import { ALLOWED_FIN_METRICS } from "../import/batch-service";

export interface FinancialScreenerCapabilities {
  supported: boolean;
  demo: boolean;
  reason?: string;
  publishedFinVersions: number;
  /** 可筛选指标（已映射字段）；不承诺 PE/TTM 混搭算法 */
  metrics: {
    key: string;
    label: string;
    unitNote: string;
    currencyNote: string;
    akShareNote?: string;
  }[];
  notMapped: { key: string; reason: string }[];
  historicalScreenRule: string;
  pointInTimeRule: string;
}

const NOT_MAPPED = [
  { key: "pe_ttm", reason: "不混算 TTM；AKShare 指标表无统一可映射列" },
  { key: "pb", reason: "未映射" },
  { key: "market_cap", reason: "本 MVP 无市值源" },
];

export async function financialScreenerCapabilities(
  env: Env,
  db: D1Database,
): Promise<FinancialScreenerCapabilities> {
  const demo = isDemoProvider(env);
  const countRow = await db
    .prepare("SELECT COUNT(*) as n FROM fin_report_versions")
    .bind()
    .first<{ n: number }>();
  const publishedFinVersions = countRow?.n ?? 0;

  const screenGate = financialScreeningAllowed(env);
  const baseMetrics = [
    {
      key: "operating_revenue",
      label: "营业收入",
      unitNote: "与入库 unit_label 一致",
      currencyNote: "报表 currency 字段；不混算币种",
      akShareNote: "stock_financial_hk_analysis_indicator_em 行项目（源列名随版本变化，入库白名单）",
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
      unitNote: "每股；非 TTM 推算",
      currencyNote: "同上",
    },
    {
      key: "roe",
      label: "ROE",
      unitNote: "源字段比率",
      currencyNote: "—",
    },
    {
      key: "gross_margin",
      label: "毛利率",
      unitNote: "源字段",
      currencyNote: "—",
    },
  ].filter((m) => ALLOWED_FIN_METRICS.has(m.key));

  const rules = {
    historicalScreenRule:
      "历史筛选：announced_at 非空且 <= asOfDate；announced_at 为空 → excluded（不伪造）",
    pointInTimeRule: "未知公告日不得用于历史筛选，防前视",
  };

  if (isProduction(env) && !isDistributionLicensed(env) && !isStagingDemo(env)) {
    return {
      supported: false,
      demo,
      publishedFinVersions,
      reason: screenGate.reason,
      metrics: baseMetrics,
      notMapped: NOT_MAPPED,
      ...rules,
    };
  }

  if (publishedFinVersions === 0) {
    return {
      supported: false,
      demo,
      publishedFinVersions: 0,
      reason: "尚无已发布 fin_report_versions；请先机器导入 financial 批次",
      metrics: baseMetrics,
      notMapped: NOT_MAPPED,
      ...rules,
    };
  }

  return {
    supported: true,
    demo,
    publishedFinVersions,
    metrics: baseMetrics,
    notMapped: NOT_MAPPED,
    ...rules,
  };
}
