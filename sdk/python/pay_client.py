"""Minimal Ribaunt Pay client. No third-party dependencies."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class PayClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _request(self, path: str, *, method: str = "GET", body: dict | None = None,
                 headers: dict[str, str] | None = None) -> dict[str, Any]:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={
                "content-type": "application/json",
                "x-api-key": self.api_key,
                **(headers or {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            payload = json.loads(error.read())
            raise RuntimeError(payload.get("error", str(error))) from error

    def create_link(self, **kwargs: Any) -> dict[str, Any]:
        return self._request("/api/payment-links", method="POST", body=kwargs)

    def list_links(self, status: str | None = None) -> dict[str, Any]:
        query = f"?status={urllib.parse.quote(status)}" if status else ""
        return self._request(f"/api/payment-links{query}")

    def status(self, link_id: str, status_token: str) -> dict[str, Any]:
        return self._request(
            f"/api/payment-links/{urllib.parse.quote(link_id)}/status",
            headers={"x-api-key": "", "x-status-token": status_token},
        )

    def quote(self, fiat_amount: str, fiat_currency: str) -> dict[str, Any]:
        query = urllib.parse.urlencode(
            {"fiatAmount": fiat_amount, "fiatCurrency": fiat_currency}
        )
        return self._request(f"/api/prices/quote?{query}")

    def attestation(self, start: str, end: str, store_id: str | None = None) -> dict[str, Any]:
        params = {"from": start, "to": end}
        if store_id:
            params["storeId"] = store_id
        return self._request(f"/api/admin/attestations?{urllib.parse.urlencode(params)}")
