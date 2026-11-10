from __future__ import annotations

import os
import re
from typing import Any

import httpx

_BASE = os.environ.get("ESW_IMPORT_BASE_URL", "http://127.0.0.1:8787")
_KEY = os.environ.get("ESW_IMPORT_MACHINE_KEY", "")


def _headers() -> dict[str, str]:
    if not _KEY:
        raise RuntimeError("ESW_IMPORT_MACHINE_KEY 未设置")
    return {"Authorization": f"Bearer {_KEY}", "Content-Type": "application/json"}


def _redact_log(msg: str) -> str:
    return re.sub(r"Bearer\s+\S+", "Bearer ***", msg)


class ImportClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base = (base_url or _BASE).rstrip("/")

    def create_batch(self, body: dict[str, Any]) -> dict[str, Any]:
        r = httpx.post(f"{self.base}/api/import/v1/batches", headers=_headers(), json=body, timeout=60)
        r.raise_for_status()
        return r.json()

    def stage(self, batch_id: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        r = httpx.post(
            f"{self.base}/api/import/v1/batches/{batch_id}/stage",
            headers=_headers(),
            json={"rows": rows},
            timeout=120,
        )
        r.raise_for_status()
        return r.json()

    def validate(self, batch_id: str) -> dict[str, Any]:
        r = httpx.post(f"{self.base}/api/import/v1/batches/{batch_id}/validate", headers=_headers(), timeout=120)
        return r.json(), r.status_code

    def publish(self, batch_id: str, provenance: dict[str, Any] | None = None) -> dict[str, Any]:
        r = httpx.post(
            f"{self.base}/api/import/v1/batches/{batch_id}/publish",
            headers=_headers(),
            json={"provider": "akshare-collector", "provenance": provenance or {}},
            timeout=120,
        )
        if r.status_code >= 400:
            return r.json()
        return r.json()
