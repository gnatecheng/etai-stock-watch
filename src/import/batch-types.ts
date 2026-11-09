export type ImportBatchType = "bars_daily" | "financial" | "calendar";
export type ImportBatchStatus =
  | "staging"
  | "validating"
  | "validated"
  | "publishing"
  | "published"
  | "failed"
  | "abandoned";

export interface StagedBarPayload {
  symbol: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover_hkd?: number | null;
  turnover_trustworthy?: boolean;
}

export interface StagedFinancialPayload {
  symbol: string;
  report_family: "akshare_hk_analysis_indicator_em";
  statement_type?: string | null;
  period_end: string;
  period_type: "annual" | "interim" | "quarter";
  accounting_standard?: string | null;
  currency: string;
  unit_label: string;
  announced_at?: string | null;
  metrics: Record<string, number | null>;
}

export interface FinMetricsMap {
  /** 东方财富 main indicators — 缺失保持 null，不推算 PE/ROE/TTM */
  operating_revenue?: number | null;
  net_profit_attr_parent?: number | null;
  basic_eps?: number | null;
  roe?: number | null;
  gross_margin?: number | null;
}
