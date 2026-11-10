import type { Env } from "../env";
import { isProduction, normalizeProvider } from "../env";
import type { MarketDataProvider } from "./types";
import { DemoMarketDataProvider } from "./demo";

export function getProvider(env: Env): MarketDataProvider | null {
  const provider = normalizeProvider(env);
  if (provider === "demo") {
    return new DemoMarketDataProvider();
  }
  if (provider === "none" || provider === "") {
    return null;
  }
  if (isProduction(env) && !env.MARKET_DATA_API_KEY) {
    return null;
  }
  // 正式供应商接入点；未授权前不实现
  return null;
}
