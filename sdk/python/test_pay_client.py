"""Unit tests for the dependency-free Python client."""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import unittest
import urllib.error
from email.message import Message
from unittest.mock import patch

from pay_client import PayClient, PayError, verify_attestation, verify_webhook_signature


class FakeResponse:
    def __init__(self, text: str, headers: dict[str, str] | None = None):
        self.text = text
        self.headers = Message()
        for key, value in (headers or {}).items():
            self.headers[key] = value

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self) -> bytes:
        return self.text.encode()

    def __iter__(self):
        return iter([(line + "\n").encode() for line in self.text.split("\n")])

    def get_all(self, name: str):
        return self.headers.get_all(name)


class PayClientTests(unittest.TestCase):
    def test_create_link_sends_key_and_idempotency_key(self):
        calls = []

        def fake(request, **_kwargs):
            calls.append((request.full_url, request.headers, request.get_method()))
            return FakeResponse(json.dumps({"link": {"id": "link-1"}}))

        with patch("urllib.request.urlopen", side_effect=fake):
            result = PayClient("http://pay.test", "key-1").create_link(
                amountXmr="0.01", idempotency_key="retry-1"
            )

        self.assertEqual(result["link"]["id"], "link-1")
        url, headers, method = calls[0]
        self.assertEqual(url, "http://pay.test/api/payment-links")
        self.assertEqual(method, "POST")
        self.assertEqual(headers["X-api-key"], "key-1")
        self.assertEqual(headers["Idempotency-key"], "retry-1")

    def test_status_uses_header_token_without_api_key(self):
        calls = []

        def fake(request, **_kwargs):
            calls.append((request.full_url, request.headers))
            return FakeResponse(json.dumps({"status": "pending"}))

        with patch("urllib.request.urlopen", side_effect=fake):
            PayClient("http://pay.test", "key-1").status("link-1", "secret-token")

        url, headers = calls[0]
        self.assertEqual(url, "http://pay.test/api/payment-links/link-1/status")
        self.assertEqual(headers["X-status-token"], "secret-token")
        self.assertNotIn("X-api-key", headers)
        self.assertNotIn("secret-token", url)

    def test_attestation_uses_session_cookie(self):
        calls = []

        def fake(request, **_kwargs):
            calls.append((request.full_url, request.headers))
            return FakeResponse(json.dumps({"kind": "ribaunt-pay-revenue-attestation"}))

        with patch("urllib.request.urlopen", side_effect=fake):
            client = PayClient("http://pay.test", "key-1", session_cookie="pay_session=s-1")
            client.attestation("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")

        self.assertEqual(calls[0][1]["Cookie"], "pay_session=s-1")
        self.assertNotIn("X-api-key", calls[0][1])

    def test_retries_429_with_retry_after(self):
        headers = Message()
        headers["Retry-After"] = "0"
        error = urllib.error.HTTPError(
            "http://pay.test/api/payment-links", 429, "Too many requests", headers, io.BytesIO()
        )
        responses = [error, FakeResponse(json.dumps({"links": []}))]

        with patch("urllib.request.urlopen", side_effect=responses) as urlopen, patch(
            "pay_client.time.sleep"
        ):
            result = PayClient("http://pay.test", "key-1", retries=1).list_links()

        self.assertEqual(result, {"links": []})
        self.assertEqual(urlopen.call_count, 2)

    def test_exposes_status_on_failure(self):
        error = urllib.error.HTTPError(
            "http://pay.test/api/payment-links", 404, "Not found", Message(), io.BytesIO(b'{"error":"Payment not found"}')
        )
        with patch("urllib.request.urlopen", side_effect=error), patch("pay_client.time.sleep"):
            with self.assertRaises(PayError) as context:
                PayClient("http://pay.test", "key-1", retries=0).list_links()
        self.assertEqual(context.exception.status, 404)

    def test_events_yield_parsed_updates(self):
        payload = 'event: payment.update\ndata: {"id":"link-1"}\n\n'
        with patch("urllib.request.urlopen", return_value=FakeResponse(payload)) as urlopen:
            events = list(PayClient("http://pay.test", "key-1").events("link-1", "secret-token"))

        self.assertEqual(events, [("payment.update", {"id": "link-1"})])
        self.assertEqual(urlopen.call_args[0][0].headers["X-status-token"], "secret-token")


class SignatureTests(unittest.TestCase):
    def test_webhook_signature(self):
        secret = "whsec_test"
        signature = "sha256=" + hmac.new(
            secret.encode(), b"delivery-1.payment.confirmed.{}", hashlib.sha256
        ).hexdigest()
        self.assertTrue(
            verify_webhook_signature(secret, "delivery-1", "payment.confirmed", "{}", signature)
        )
        self.assertFalse(
            verify_webhook_signature(secret, "delivery-1", "payment.late", "{}", signature)
        )

    def test_attestation_signature(self):
        secret = "session-secret"
        fields = {
            "kind": "ribaunt-pay-revenue-attestation",
            "version": 1,
            "from": "2026-01-01T00:00:00.000Z",
            "to": "2026-02-01T00:00:00.000Z",
            "network": "mainnet",
            "confirmedCount": 1,
            "totalXmr": "0.1",
            "totalAtomic": "100000000000",
            "fiatTotal": None,
            "fiatCurrency": None,
            "generatedAt": "2026-02-01T00:00:00.000Z",
        }
        signature = hmac.new(
            secret.encode(),
            json.dumps(fields, separators=(",", ":")).encode(),
            hashlib.sha256,
        ).hexdigest()
        attestation = {**fields, "signature": signature}
        self.assertTrue(verify_attestation(attestation, secret))
        self.assertFalse(verify_attestation(attestation, "wrong-secret"))


if __name__ == "__main__":
    unittest.main()
