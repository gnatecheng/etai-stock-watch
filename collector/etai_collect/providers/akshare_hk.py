"""AKShare 港股适配 — 可选 live；默认由 CLI 使用 synthetic。"""

from __future__ import annotations

import os
import time
from typing import Any

import pandas as pd

_DELAY = int(os.environ.get("ESW_AKSHARE_DELAY_MS", "800"))


def _throttle() -> None:
    time.sleep(_DELAY / 1000.0)


def fetch_hk_daily_hist(symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    import akshare as ak

    _throttle()
    return ak.stock_hk_hist(
        symbol=symbol,
        period="daily",
        start_date=start_date.replace("-", ""),
        end_date=end_date.replace("-", ""),
        adjust="",
    )


def frame_to_bars(df: pd.DataFrame, symbol: str) -> list[dict[str, Any]]:
    """映射 stock_hk_hist 列为导入 payload；成交额仅当源列存在。"""
    out: list[dict[str, Any]] = []
    col_date = "日期" if "日期" in df.columns else "date"
    for _, row in df.iterrows():
        trade_date = str(row[col_date])[:10]
        payload = {
            "symbol": f"DEMO:AK{symbol}" if symbol.isdigit() else symbol,
            "trade_date": trade_date,
            "open": float(row.get("开盘", row.get("open", 0))),
            "high": float(row.get("最高", row.get("high", 0))),
            "low": float(row.get("最低", row.get("low", 0))),
            "close": float(row.get("收盘", row.get("close", 0))),
            "volume": int(float(row.get("成交量", row.get("volume", 0)))),
            "turnover_hkd": None,
            "turnover_trustworthy": False,
        }
        if "成交额" in df.columns and pd.notna(row["成交额"]):
            payload["turnover_hkd"] = float(row["成交额"])
            # 仍须运维 publish provenance 标注 trustworthy 才参与筛选
        out.append(payload)
    return out


def fetch_financial_indicators(symbol: str, indicator: str = "年度") -> pd.DataFrame:
    import akshare as ak

    _throttle()
    return ak.stock_financial_hk_analysis_indicator_em(symbol=symbol, indicator=indicator)
