/** 用户条件筛选（AND）— 与 20MA 策略信号无关 */

export type MaRelation = "above" | "below";

export type ScreenerCondition =
  | { type: "price_close"; minHkd?: number; maxHkd?: number }
  | { type: "change_pct"; minPct?: number; maxPct?: number }
  | { type: "ma_relation"; period: number; relation: MaRelation }
  | { type: "turnover"; minHkd?: number; maxHkd?: number };

export interface ScreenerRunRequest {
  /** 可选；默认取库内最新有行情的交易日 */
  asOfDate?: string;
  conditions: ScreenerCondition[];
}

export type ConditionEvalStatus = "pass" | "fail" | "excluded";

export interface ConditionEvaluation {
  type: ScreenerCondition["type"];
  status: ConditionEvalStatus;
  reason: string;
  values?: Record<string, string | number | boolean | null>;
}

export interface ScreenerHit {
  instrumentId: string;
  symbol: string;
  nameZh: string;
  currency: string;
  boardLot: number;
  tradeDate: string;
  conditionResults: ConditionEvaluation[];
  summaryReasons: string[];
}

export interface ScreenerRunResult {
  asOfDate: string;
  dataLabel: string;
  demo: boolean;
  turnoverFilterSupported: boolean;
  conditionsRequested: ScreenerCondition[];
  hits: ScreenerHit[];
  evaluatedCount: number;
  message?: string;
}

export interface ScreenerCapabilities {
  demo: boolean;
  demoWatermark: string;
  /** 日线收盘价、涨跌幅单位为港币/百分比；成交额为港币（仅可信字段） */
  units: {
    price: string;
    changePct: string;
    turnover: string;
    ma: string;
  };
  turnoverSupported: boolean;
  turnoverUnsupportedReason?: string;
  disclaimer: string;
  signalDisclaimer: string;
  maxMaPeriod: number;
  minMaPeriod: number;
}
