from __future__ import annotations

import json
import os
import sys
from typing import Optional

import typer

from etai_collect.client import ImportClient
from etai_collect.providers import synthetic

app = typer.Typer(help="观股记 AKShare 采集 CLI")


@app.command()
def sample_hk(symbol: str = "00700", days: int = 3) -> None:
    """可选 live 最小取样（须 ESW_AKSHARE_LIVE_SAMPLE=1）。"""
    if os.environ.get("ESW_AKSHARE_LIVE_SAMPLE") != "1":
        typer.echo("拒绝：未设置 ESW_AKSHARE_LIVE_SAMPLE=1")
        raise typer.Exit(1)
    from etai_collect.providers.akshare_hk import fetch_hk_daily_hist

    end = "20240110"
    start = "20240101"
    df = fetch_hk_daily_hist(symbol, start, end)
    typer.echo(df.head(days).to_string())
    typer.echo("（仅供本地核对字段，勿对外发布）")


@app.command()
def push_bars(
    fixture: str = typer.Option("acceptance", help="synthetic fixture 名称"),
    trade_date: str = "2024-08-29",
    symbol: str = "DEMO:00700",
) -> None:
    """推送合成 bar 批次到 Worker 导入 API。"""
    client = ImportClient()
    idem = f"synthetic-bars|{fixture}|{trade_date}|{symbol}"
    batch = client.create_batch(
        {
            "batchType": "bars_daily",
            "source": "synthetic-fixture",
            "idempotencyKey": idem,
            "tradeDateScope": trade_date,
            "scopeComplete": True,
            "rowCountExpected": 1,
        }
    )
    bid = batch["batchId"]
    payload = {
        "symbol": symbol,
        "trade_date": trade_date,
        "open": 279.0,
        "high": 281.0,
        "low": 278.0,
        "close": 280.5,
        "volume": 650000,
    }
    client.stage(bid, [{"seq": 1, "payloadType": "bar", "payload": payload}])
    val, code = client.validate(bid)
    typer.echo(json.dumps(val, ensure_ascii=False))
    if code != 200:
        raise typer.Exit(1)
    pub = client.publish(bid, {"synthetic": True, "fixture": fixture, "demo": True})
    typer.echo(json.dumps(pub, ensure_ascii=False))


@app.command()
def push_financial(symbol: str = "DEMO:00700", period_end: str = "2023-12-31") -> None:
    client = ImportClient()
    idem = f"synthetic-fin|{symbol}|{period_end}"
    batch = client.create_batch(
        {
            "batchType": "financial",
            "source": "synthetic-fixture",
            "idempotencyKey": idem,
        }
    )
    bid = batch["batchId"]
    payload = synthetic.synthetic_financial(symbol, period_end)
    client.stage(bid, [{"seq": 1, "payloadType": "financial", "payload": payload}])
    val, code = client.validate(bid)
    if code != 200:
        typer.echo(json.dumps(val))
        raise typer.Exit(1)
    client.publish(bid, {"synthetic": True, "demo": True})


def main() -> None:
    app()


if __name__ == "__main__":
    main()
