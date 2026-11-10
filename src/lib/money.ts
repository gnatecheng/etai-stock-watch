/** 金额以分为单位，整数运算 */

export function mulPriceQty(priceCents: number, qty: number): number {
  return priceCents * qty;
}

export function applyBps(amountCents: number, bps: number): number {
  return Math.round((amountCents * bps) / 10_000);
}

export function roundLots(shares: number, boardLot: number): number {
  if (boardLot <= 0) throw new Error("invalid board lot");
  return Math.floor(shares / boardLot) * boardLot;
}

export function formatHkd(cents: number): string {
  return (cents / 100).toLocaleString("zh-HK", {
    style: "currency",
    currency: "HKD",
  });
}
