export interface ScreenerFormState {
  priceEnabled: boolean;
  priceMin: string;
  priceMax: string;
  changeEnabled: boolean;
  changeMin: string;
  changeMax: string;
  maEnabled: boolean;
  maPeriod: string;
  maRelation: "above" | "below";
}

export const defaultScreenerForm = (): ScreenerFormState => ({
  priceEnabled: false,
  priceMin: "",
  priceMax: "",
  changeEnabled: false,
  changeMin: "",
  changeMax: "",
  maEnabled: false,
  maPeriod: "20",
  maRelation: "above",
});

export function buildConditionsFromForm(form: ScreenerFormState): Record<string, unknown>[] {
  const conditions: Record<string, unknown>[] = [];
  if (form.priceEnabled) {
    const minHkd = form.priceMin.trim() ? Number(form.priceMin) : undefined;
    const maxHkd = form.priceMax.trim() ? Number(form.priceMax) : undefined;
    conditions.push({ type: "price_close", minHkd, maxHkd });
  }
  if (form.changeEnabled) {
    const minPct = form.changeMin.trim() ? Number(form.changeMin) : undefined;
    const maxPct = form.changeMax.trim() ? Number(form.changeMax) : undefined;
    conditions.push({ type: "change_pct", minPct, maxPct });
  }
  if (form.maEnabled) {
    conditions.push({
      type: "ma_relation",
      period: Number(form.maPeriod),
      relation: form.maRelation,
    });
  }
  return conditions;
}
