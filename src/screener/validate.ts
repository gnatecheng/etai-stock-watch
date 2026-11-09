import type { ScreenerCapabilities, ScreenerCondition, ScreenerRunRequest } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function checkRange(min?: number, max?: number): string | null {
  if (min !== undefined && !isFiniteNum(min)) return "数值无效";
  if (max !== undefined && !isFiniteNum(max)) return "数值无效";
  if (min !== undefined && max !== undefined && min > max) return "下限不能大于上限";
  return null;
}

export function validateScreenerRequest(
  body: ScreenerRunRequest,
  caps: ScreenerCapabilities,
):
  | { ok: true; request: ScreenerRunRequest }
  | { ok: false; code: string; message: string } {
  if (!body || !Array.isArray(body.conditions)) {
    return { ok: false, code: "INVALID_BODY", message: "请求体无效" };
  }
  if (body.conditions.length === 0) {
    return { ok: false, code: "NO_CONDITIONS", message: "请至少设置一项筛选条件后再执行" };
  }
  if (body.asOfDate !== undefined && body.asOfDate !== "") {
    if (!DATE_RE.test(body.asOfDate)) {
      return { ok: false, code: "INVALID_DATE", message: "asOfDate 格式须为 YYYY-MM-DD" };
    }
  }

  const normalized: ScreenerCondition[] = [];
  for (const c of body.conditions) {
    if (!c || typeof c !== "object" || !("type" in c)) {
      return { ok: false, code: "INVALID_CONDITION", message: "条件格式无效" };
    }
    switch (c.type) {
      case "price_close": {
        const err = checkRange(c.minHkd, c.maxHkd);
        if (err) return { ok: false, code: "INVALID_PRICE", message: `收盘价区间：${err}` };
        if (c.minHkd === undefined && c.maxHkd === undefined) {
          return { ok: false, code: "EMPTY_PRICE", message: "收盘价条件须填写下限或上限（港币）" };
        }
        if (c.minHkd !== undefined && c.minHkd < 0) {
          return { ok: false, code: "INVALID_PRICE", message: "收盘价不能为负" };
        }
        normalized.push(c);
        break;
      }
      case "change_pct": {
        const err = checkRange(c.minPct, c.maxPct);
        if (err) return { ok: false, code: "INVALID_CHANGE", message: `涨跌幅区间：${err}` };
        if (c.minPct === undefined && c.maxPct === undefined) {
          return { ok: false, code: "EMPTY_CHANGE", message: "涨跌幅条件须填写下限或上限（%）" };
        }
        normalized.push(c);
        break;
      }
      case "ma_relation": {
        const p = c.period;
        if (!Number.isInteger(p) || p < caps.minMaPeriod || p > caps.maxMaPeriod) {
          return {
            ok: false,
            code: "INVALID_MA",
            message: `均线周期须为 ${caps.minMaPeriod}–${caps.maxMaPeriod} 的整数`,
          };
        }
        if (c.relation !== "above" && c.relation !== "below") {
          return { ok: false, code: "INVALID_MA", message: "均线关系须为 above 或 below" };
        }
        normalized.push(c);
        break;
      }
      case "turnover": {
        if (!caps.turnoverSupported) {
          return {
            ok: false,
            code: "TURNOVER_NOT_SUPPORTED",
            message: caps.turnoverUnsupportedReason ?? "成交额条件当前不可用",
          };
        }
        const err = checkRange(c.minHkd, c.maxHkd);
        if (err) return { ok: false, code: "INVALID_TURNOVER", message: `成交额区间：${err}` };
        if (c.minHkd === undefined && c.maxHkd === undefined) {
          return { ok: false, code: "EMPTY_TURNOVER", message: "成交额条件须填写下限或上限（港币）" };
        }
        normalized.push(c);
        break;
      }
      default:
        return { ok: false, code: "UNKNOWN_CONDITION", message: "未知条件类型" };
    }
  }

  return { ok: true, request: { asOfDate: body.asOfDate, conditions: normalized } };
}
