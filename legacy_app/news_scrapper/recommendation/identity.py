"""Signed, browser-scoped viewer identity without storing raw cookie values."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

from fastapi import Request, Response


COOKIE_NAME = "techscout_viewer"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365


def _secret() -> bytes:
    value = (
        os.environ.get("NEWSSCRAPPER_VIEWER_COOKIE_SECRET")
        or os.environ.get("NEWSSCRAPPER_IP_HASH_SECRET")
        or "development-only-change-this-secret"
    )
    return value.encode("utf-8")


def _sign(payload: str) -> str:
    return hmac.new(_secret(), payload.encode("ascii"), hashlib.sha256).hexdigest()


def issue_token() -> str:
    payload = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")
    return f"{payload}.{_sign(payload)}"


def valid_token(value: str | None) -> str | None:
    token = str(value or "").strip()
    try:
        payload, signature = token.rsplit(".", 1)
    except ValueError:
        return None
    if len(payload) < 32 or not hmac.compare_digest(signature, _sign(payload)):
        return None
    return token


def viewer_key(token: str) -> str:
    return hmac.new(_secret(), token.encode("utf-8"), hashlib.sha256).hexdigest()


def bind_viewer_request(request: Request) -> tuple[str, bool, str]:
    """Resolve one signed browser identity and bind it to request state."""

    existing_key = getattr(request.state, "private_viewer_key", None)
    if existing_key:
        return (
            existing_key,
            bool(getattr(request.state, "private_viewer_created", False)),
            str(getattr(request.state, "private_viewer_token", "")),
        )
    token = valid_token(request.cookies.get(COOKIE_NAME))
    created = token is None
    if token is None:
        token = issue_token()
    key = viewer_key(token)
    request.state.private_viewer_key = key
    request.state.private_viewer_created = created
    request.state.private_viewer_token = token
    return key, created, token


def set_viewer_cookie(request: Request, response: Response, token: str) -> None:
    """Attach the signed identity using LAN-safe automatic Secure behavior."""

    secure_setting = os.environ.get("NEWSSCRAPPER_VIEWER_COOKIE_SECURE", "auto").strip().lower()
    secure = (
        request.url.scheme == "https"
        if secure_setting == "auto"
        else secure_setting in {"1", "true", "yes", "on"}
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def resolve_viewer(request: Request, response: Response) -> tuple[str, bool]:
    key, created, token = bind_viewer_request(request)
    if created and not getattr(request.state, "private_viewer_cookie_middleware", False):
        set_viewer_cookie(request, response, token)
    return key, created


def clear_viewer_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")
