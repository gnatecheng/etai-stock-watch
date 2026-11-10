from etai_collect.providers.synthetic import synthetic_capacity_bars, synthetic_financial


def test_synthetic_bar_shape():
    b = synthetic_capacity_bars(1, "2024-01-02")
    assert b.symbol.startswith("DEMO:CAP")
    assert b.close > 0


def test_synthetic_financial_metrics():
    f = synthetic_financial("DEMO:00700", "2023-12-31")
    assert f["metrics"]["operating_revenue"] is not None
    assert f["announced_at"] is not None
