"""Network capability checks for private contribution authoring.

The contribution workspace is deliberately IP-gated in addition to its signed
viewer ownership checks. Forwarded headers are trusted only when the immediate
peer is an explicitly configured reverse proxy.
"""

from __future__ import annotations

import os

from fastapi import HTTPException, Request

from core.profile import client_ip as resolve_client_ip
from core.profile import normalize_ip


def _ip_set(value: str | None, default: str = "") -> set[str]:
    raw = value if value is not None else default
    return {
        normalized
        for item in str(raw or "").split(",")
        if (normalized := normalize_ip(item.strip()))
    }


# An absent contribution allowlist remains convenient for local development,
# but never opens authoring to a non-loopback address.
CONTRIBUTIONS_ALLOWED_IPS = _ip_set(
    os.environ.get("CONTRIBUTIONS_ALLOWED_IPS"),
    "127.0.0.1,::1",
)
TRUSTED_PROXY_IPS = _ip_set(
    os.environ.get("TRUSTED_PROXY_IPS"),
    "127.0.0.1,::1",
)


def get_client_ip(request: Request) -> str:
    peer = request.client.host if request.client else ""
    return resolve_client_ip(peer, request.headers, TRUSTED_PROXY_IPS)


def is_contributor_ip(request: Request) -> bool:
    return get_client_ip(request) in CONTRIBUTIONS_ALLOWED_IPS


def require_contributor_ip(request: Request) -> str:
    ip = get_client_ip(request)
    if ip not in CONTRIBUTIONS_ALLOWED_IPS:
        raise HTTPException(
            status_code=403,
            detail="Contributions are not enabled for this network.",
        )
    return ip
