import { applyBps, mulPriceQty } from "../lib/money";

export interface FeeScheduleRow {
  id: string;
  name: string;
  rate_bps: number;
  flat_cents: number;
  effective_from: string;
  effective_to: string | null;
}

export function computeTradeFees(
  notionalCents: number,
  schedules: FeeScheduleRow[],
  tradeDate: string,
): { total: number; breakdown: { name: string; cents: number }[] } {
  const active = schedules.filter(
    (s) =>
      s.effective_from <= tradeDate &&
      (s.effective_to === null || s.effective_to >= tradeDate),
  );
  const breakdown = active.map((s) => ({
    name: s.name,
    cents: applyBps(notionalCents, s.rate_bps) + s.flat_cents,
  }));
  const total = breakdown.reduce((a, b) => a + b.cents, 0);
  return { total, breakdown };
}

export function notional(priceCents: number, qty: number): number {
  return mulPriceQty(priceCents, qty);
}

/** 演示用费率 — 非现行真实税率 */
export const DEMO_FEE_SCHEDULES: FeeScheduleRow[] = [
  {
    id: "fee_demo_commission",
    name: "演示佣金",
    rate_bps: 25,
    flat_cents: 0,
    effective_from: "2000-01-01",
    effective_to: null,
  },
  {
    id: "fee_demo_levy",
    name: "演示征费",
    rate_bps: 1,
    flat_cents: 0,
    effective_from: "2000-01-01",
    effective_to: null,
  },
];
