"""合成 DEMO 上游 — 容量/验收，非真实行情。"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SyntheticBar:
    symbol: str
    trade_date: str
    open: float
    high: float
    low: float
    close: float
    volume: int


def synthetic_capacity_bars(symbol_index: int, trade_date: str, base: float = 10.0) -> SyntheticBar:
    sym = f"DEMO:CAP{symbol_index:05d}"
    close = base + (symbol_index % 50) * 0.1
    return SyntheticBar(sym, trade_date, close - 0.5, close + 0.3, close - 0.8, close, 100_000 + symbol_index)


def synthetic_financial(symbol: str, period_end: str) -> dict:
    return {
        "symbol": symbol,
        "report_family": "akshare_hk_analysis_indicator_em",
        "statement_type": None,
        "period_end": period_end,
        "period_type": "annual",
        "accounting_standard": "HKFRS",
        "currency": "HKD",
        "unit_label": "百万港元",
        "announced_at": f"{int(period_end[:4]) + 1}-04-01",
        "metrics": {
            "operating_revenue": 1000.0,
            "net_profit_attr_parent": 100.0,
            "basic_eps": 1.2,
            "roe": 12.5,
            "gross_margin": 45.0,
        },
    }
