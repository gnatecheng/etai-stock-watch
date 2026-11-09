import type { Env } from "../env";
import { isProduction } from "../env";
import type { MarketDataProvider } from "./types";
import { DemoMarketDataProvider } from "./demo";

export function getProvider(env: Env): MarketDataProvider | null {
  if (env.DATA_PROVIDER === "demo") {
    return new DemoMarketDataProvider();
  }
  if (env.DATA_PROVIDER === "none" || !env.DATA_PROVIDER) {
    return null;
  }
  if (isProduction(env) && !env.MARKET_DATA_API_KEY) {
    return null;
  }
  // 正式供应商接入点；未授权前不实现
  return null;
}
