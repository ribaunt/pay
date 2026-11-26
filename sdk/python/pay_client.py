"""Minimal dependency-free Ribaunt Pay client."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterator


class PayError(Exception):
    """API failure with the HTTP status and optional Retry-After hint."""

    def __init__(self, status: int, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


def _cookie(response: urllib.error.HTTPError | Any, prefix: str) -> str | None:
    for value in response.headers.get_all("Set-Cookie") or []:
        if value.startswith(prefix):
            return value.split(";")[0]
    return None


class PayClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 30.0,
        retries: int = 2,
        session_cookie: str | None = None,
        csrf_token: str | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.retries = retries
        self.session_cookie = session_cookie
        self.csrf_token = csrf_token

    def _headers(self, method: str, auth: str, extra: dict[str, str] | None) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if auth == "key":
            headers["x-api-key"] = self.api_key
        elif auth == "session":
            if self.session_cookie:
                headers["cookie"] = self.session_cookie
            if method != "GET" and self.csrf_token:
                headers["x-csrf-token"] = self.csrf_token
        headers.update(extra or {})
        return headers

    def _request(
        self,
        path: str,
        *,
        method: str = "GET",
        body: dict | None = None,
        headers: dict[str, str] | None = None,
        auth: str = "key",
        raw: bool = False,
    ) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(self.retries + 1):
            request = urllib.request.Request(
                f"{self.base_url}{path}",
                data=data,
                method=method,
                headers=self._headers(method, auth, headers),
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    text = response.read().decode()
                    return text if raw else (json.loads(text) if text else {})
            except urllib.error.HTTPError as error:
                payload_text = error.read().decode()
                payload = json.loads(payload_text) if payload_text else {}
                retry_after = float(error.headers.get("Retry-After") or 0) or None
                if (error.code == 429 or error.code >= 500) and attempt < self.retries:
                    time.sleep(retry_after if retry_after else 2**attempt * 0.1)
                    continue
                message = payload.get("error", str(error)) if isinstance(payload, dict) else str(error)
                raise PayError(error.code, message, retry_after) from error
        raise AssertionError("unreachable")

    def login(self, email: str, password: str) -> None:
        csrf = urllib.request.urlopen(
            urllib.request.Request(f"{self.base_url}/api/auth/csrf"), timeout=self.timeout
        )
        csrf_cookie = _cookie(csrf, "pay_csrf=")
        token = json.loads(csrf.read().decode())["token"]

        body = json.dumps({"email": email, "password": password}).encode()
        response = urllib.request.urlopen(
            urllib.request.Request(
                f"{self.base_url}/api/auth/login",
                data=body,
                method="POST",
                headers={"content-type": "application/json"},
            ),
            timeout=self.timeout,
        )
        session_cookie = _cookie(response, "pay_session=")
        self.session_cookie = "; ".join(
            part for part in (session_cookie, csrf_cookie) if part
        ) or None
        self.csrf_token = token

    def me(self) -> dict[str, Any]:
        return self._request("/api/auth/me", auth="session")

    def logout(self) -> None:
        self._request("/api/auth/logout", method="POST", auth="session")
        self.session_cookie = None
        self.csrf_token = None

    def create_link(self, *, idempotency_key: str | None = None, **kwargs: Any) -> dict[str, Any]:
        headers = {"idempotency-key": idempotency_key} if idempotency_key else None
        return self._request(
            "/api/payment-links", method="POST", body=kwargs, headers=headers
        )

    def list_links(self, status: str | None = None) -> dict[str, Any]:
        query = f"?status={urllib.parse.quote(status)}" if status else ""
        return self._request(f"/api/payment-links{query}")

    def status(self, link_id: str, status_token: str) -> dict[str, Any]:
        return self._request(
            f"/api/payment-links/{urllib.parse.quote(link_id)}/status",
            headers={"x-status-token": status_token},
            auth="public",
        )

    def cancel_link(self, link_id: str) -> dict[str, Any]:
        return self._request(
            f"/api/payment-links/{urllib.parse.quote(link_id)}/cancel", method="POST"
        )

    def renew_link(self, link_id: str) -> dict[str, Any]:
        return self._request(
            f"/api/payment-links/{urllib.parse.quote(link_id)}/renew", method="POST"
        )

    def quote(self, fiat_amount: str, fiat_currency: str) -> dict[str, Any]:
        query = urllib.parse.urlencode(
            {"fiatAmount": fiat_amount, "fiatCurrency": fiat_currency}
        )
        return self._request(f"/api/prices/quote?{query}", auth="public")

    def currencies(self) -> dict[str, Any]:
        return self._request("/api/prices/currencies", auth="public")

    def verify_proof(self, tx_hash: str, address: str, message: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"txHash": tx_hash, "address": address}
        if message is not None:
            body["message"] = message
        return self._request(
            "/api/public/payment-proofs/verify", method="POST", body=body, auth="public"
        )

    def list_webhooks(self) -> dict[str, Any]:
        return self._request("/api/webhooks")

    def register_webhook(self, url: str, events: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"url": url}
        if events is not None:
            body["events"] = events
        return self._request("/api/webhooks", method="POST", body=body)

    def audit(self, format: str = "json") -> Any:
        return self._request(f"/api/wallet/audit?format={format}")

    def metrics(self) -> str:
        return self._request("/api/metrics", raw=True)

    def attestation(
        self, start: str, end: str, store_id: str | None = None
    ) -> dict[str, Any]:
        params: dict[str, str] = {"from": start, "to": end}
        if store_id:
            params["storeId"] = store_id
        return self._request(
            f"/api/admin/attestations?{urllib.parse.urlencode(params)}", auth="session"
        )

    def list_stores(self) -> dict[str, Any]:
        return self._request("/api/admin/stores", auth="session")

    def events(
        self, link_id: str | None = None, token: str | None = None
    ) -> Iterator[tuple[str, dict[str, Any]]]:
        """Yield (event, data) pairs from the SSE stream. Use close() on the response for cleanup."""
        params: dict[str, str] = {}
        headers: dict[str, str] = {}
        if link_id and token:
            params["linkId"] = link_id
            headers["x-status-token"] = token
        else:
            headers["x-api-key"] = self.api_key
        query = f"?{urllib.parse.urlencode(params)}" if params else ""
        request = urllib.request.Request(
            f"{self.base_url}/api/events{query}", headers=headers
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            event = "message"
            lines: list[str] = []
            for raw in response:
                line = raw.decode().rstrip("\r\n")
                if line == "":
                    if lines:
                        text = "\n".join(lines)
                        try:
                            data = json.loads(text)
                        except json.JSONDecodeError:
                            data = {"raw": text}
                        yield event, data
                    event = "message"
                    lines = []
                elif line.startswith("event: "):
                    event = line[7:]
                elif line.startswith("data: "):
                    lines.append(line[6:])


def verify_webhook_signature(
    secret: str, delivery_id: str, event: str, raw_body: str, signature: str
) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), f"{delivery_id}.{event}.{raw_body}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def verify_attestation(attestation: dict[str, Any], secret: str) -> bool:
    unsigned = {key: value for key, value in attestation.items() if key != "signature"}
    payload = json.dumps(unsigned, separators=(",", ":"), ensure_ascii=False)
    expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, attestation.get("signature", ""))
