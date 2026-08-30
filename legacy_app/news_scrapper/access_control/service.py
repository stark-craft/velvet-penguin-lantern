"""Runtime capability store with safe env bootstrap and auditable changes.

The signed browser identity is the canonical principal. Client IP is retained
only as deployment bootstrap/network context, and forwarded addresses are
accepted only from configured trusted proxies.
"""

from __future__ import annotations

import datetime as dt
import os
import secrets
import threading
import time
from collections.abc import Iterable
from pathlib import Path

from fastapi import HTTPException, Request, Response

from core.profile import client_ip as resolve_client_ip
from core.profile import normalize_ip
from core.settings import NEWS_RUNTIME_DIR
from core.storage import JsonStore
from news_scrapper.recommendation.identity import resolve_viewer


ALL_CAPABILITIES = frozenset(
    {
        "review.news.view",
        "review.news.submit",
        "review.news.approve",
        "review.contributions.view",
        "review.contributions.publish",
        "contributions.create",
        "approved.view",
        "sources.view",
        "sources.manage",
        "scheduler.view",
        "scheduler.control",
        "gatekeeper.review",
        "analytics.view",
        "region.correct",
        "model.train",
        "crawl.run",
        "system.status.detail",
        "access.manage",
    }
)

ACCESS_FILE = Path(NEWS_RUNTIME_DIR) / "access_control.json"
AUDIT_FILE = Path(NEWS_RUNTIME_DIR) / "access_control_audit.json"
ACCESS_STORE = JsonStore(ACCESS_FILE, dict)
AUDIT_STORE = JsonStore(AUDIT_FILE, dict)
ACCESS_LOCK = threading.RLock()

PRIVILEGED_COOKIE = "techscout_privileged_session"
PRIVILEGED_SESSION_SECONDS = 6 * 60 * 60
_SESSION_LOCK = threading.RLock()
_SESSIONS: dict[str, dict] = {}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _env_ip_set(name: str, default: str = "") -> set[str]:
    raw = os.environ.get(name)
    if raw is None:
        raw = default
    return {
        normalized
        for value in str(raw or "").split(",")
        if (normalized := normalize_ip(value.strip())) != "unknown"
    }


def trusted_proxy_ips() -> set[str]:
    return _env_ip_set("TRUSTED_PROXY_IPS", "127.0.0.1,::1")


def request_ip(request: Request) -> str:
    peer = request.client.host if request.client else ""
    return resolve_client_ip(peer, request.headers, trusted_proxy_ips())


def _development_loopback_default() -> str:
    environment = os.environ.get("NEWSSCRAPPER_ENV", "development").strip().lower()
    return "127.0.0.1,::1" if environment not in {"production", "prod"} else ""


def bootstrap_capabilities_for_ip(ip: str) -> set[str]:
    """Translate existing and new allowlists into the capability model."""

    resolved = normalize_ip(ip)
    capabilities: set[str] = set()
    mappings = (
        ("CONTRIBUTIONS_ALLOWED_IPS", "127.0.0.1,::1", {"contributions.create"}),
        ("ANALYTICS_ALLOWED_IPS", "127.0.0.1,::1", {"analytics.view"}),
        (
            "GATEKEEPER_ALLOWED_IPS",
            "127.0.0.1,::1",
            {"gatekeeper.review", "model.train", "region.correct"},
        ),
        ("SYSTEM_STATUS_ALLOWED_IPS", "127.0.0.1,::1", {"system.status.detail"}),
        ("REVIEW_NEWS_ALLOWED_IPS", "", {"review.news.view", "review.news.submit"}),
        ("APPROVED_BRIEFING_ALLOWED_IPS", "", {"approved.view"}),
        ("SOURCE_CONTROL_ALLOWED_IPS", "", {"sources.view", "sources.manage"}),
        ("SCHEDULER_ALLOWED_IPS", "", {"scheduler.view", "scheduler.control"}),
        ("CRAWL_ALLOWED_IPS", "", {"crawl.run"}),
        ("ACCESS_MANAGEMENT_ALLOWED_IPS", _development_loopback_default(), {"access.manage"}),
    )
    for env_name, default, granted in mappings:
        if resolved in _env_ip_set(env_name, default):
            capabilities.update(granted)

    # One explicit compatibility allowlist preserves existing local/operator
    # access without making every ordinary user an operator in production.
    if resolved in _env_ip_set("OPERATIONS_ALLOWED_IPS", _development_loopback_default()):
        capabilities.update(
            {
                "review.news.view",
                "review.news.submit",
                "review.news.approve",
                "review.contributions.view",
                "review.contributions.publish",
                "approved.view",
                "sources.view",
                "sources.manage",
                "scheduler.view",
                "scheduler.control",
                "crawl.run",
                "system.status.detail",
            }
        )
    return capabilities


def _normalized_store() -> dict:
    data = ACCESS_STORE.read()
    if not isinstance(data, dict):
        data = {}
    principals = data.get("principals")
    if not isinstance(principals, dict):
        principals = {}
    return {"version": 1, "principals": principals}


def principal_record(principal: str) -> dict:
    return dict(_normalized_store()["principals"].get(str(principal), {}))


def dynamic_capabilities(principal: str) -> set[str]:
    values = principal_record(principal).get("capabilities", [])
    return {str(value) for value in values if str(value) in ALL_CAPABILITIES}


def _prune_sessions(now: float | None = None) -> None:
    current = time.time() if now is None else now
    expired = [token for token, value in _SESSIONS.items() if value.get("expires_at", 0) <= current]
    for token in expired:
        _SESSIONS.pop(token, None)


def session_capabilities(request: Request) -> set[str]:
    token = str(request.cookies.get(PRIVILEGED_COOKIE, "") or "")
    if not token:
        return set()
    with _SESSION_LOCK:
        _prune_sessions()
        session = _SESSIONS.get(token)
        return set(session.get("capabilities", [])) if session else set()


def create_privileged_session(
    request: Request,
    response: Response,
    capabilities: Iterable[str],
    *,
    role: str,
) -> str:
    granted = {value for value in capabilities if value in ALL_CAPABILITIES}
    token = secrets.token_urlsafe(32)
    with _SESSION_LOCK:
        _prune_sessions()
        _SESSIONS[token] = {
            "capabilities": sorted(granted),
            "role": str(role),
            "expires_at": time.time() + PRIVILEGED_SESSION_SECONDS,
        }
    secure_setting = os.environ.get("NEWSSCRAPPER_VIEWER_COOKIE_SECURE", "auto").strip().lower()
    secure = request.url.scheme == "https" if secure_setting == "auto" else secure_setting in {"1", "true", "yes", "on"}
    response.set_cookie(
        PRIVILEGED_COOKIE,
        token,
        max_age=PRIVILEGED_SESSION_SECONDS,
        httponly=True,
        samesite="strict",
        secure=secure,
        path="/",
    )
    return token


def revoke_privileged_session(request: Request, response: Response) -> None:
    token = str(request.cookies.get(PRIVILEGED_COOKIE, "") or "")
    with _SESSION_LOCK:
        _SESSIONS.pop(token, None)
    response.delete_cookie(PRIVILEGED_COOKIE, path="/")


def resolve_principal(request: Request, response: Response | None = None) -> tuple[str, str]:
    if response is None:
        # Middleware already binds viewer routes. Capability endpoints pass a
        # response so a first-time browser receives the identity immediately.
        principal = str(getattr(request.state, "private_viewer_key", ""))
        if not principal:
            from news_scrapper.recommendation.identity import bind_viewer_request

            principal = bind_viewer_request(request)[0]
    else:
        principal, _created = resolve_viewer(request, response)
    return principal, request_ip(request)


def effective_capabilities(request: Request, response: Response | None = None) -> set[str]:
    principal, ip = resolve_principal(request, response)
    return (
        dynamic_capabilities(principal)
        | bootstrap_capabilities_for_ip(ip)
        | session_capabilities(request)
    )


def has_capability(request: Request, capability: str) -> bool:
    return capability in effective_capabilities(request)


def require_capability(request: Request, capability: str) -> str:
    if capability not in ALL_CAPABILITIES:
        raise RuntimeError(f"Unknown capability: {capability}")
    principal, _ip = resolve_principal(request)
    if capability not in effective_capabilities(request):
        raise HTTPException(status_code=403, detail="You do not have access to this operation.")
    return principal


def require_any_capability(request: Request, capabilities: Iterable[str]) -> str:
    requested = {value for value in capabilities if value in ALL_CAPABILITIES}
    principal, _ip = resolve_principal(request)
    if not (requested & effective_capabilities(request)):
        raise HTTPException(status_code=403, detail="You do not have access to this workspace.")
    return principal


def list_principals() -> list[dict]:
    records = []
    for principal, raw in _normalized_store()["principals"].items():
        record = dict(raw) if isinstance(raw, dict) else {}
        record["principal"] = principal
        record["capabilities"] = sorted(dynamic_capabilities(principal))
        records.append(record)
    records.sort(key=lambda item: (str(item.get("display_name") or "").casefold(), item["principal"]))
    return records


def update_principal(
    principal: str,
    *,
    display_name: str,
    known_ips: Iterable[str],
    capabilities: Iterable[str],
    actor: str,
) -> dict:
    principal = str(principal or "").strip()
    if not principal or len(principal) > 256:
        raise ValueError("Choose a valid viewer principal.")
    next_capabilities = sorted({value for value in capabilities if value in ALL_CAPABILITIES})
    next_ips = sorted({normalize_ip(value) for value in known_ips if normalize_ip(value) != "unknown"})
    with ACCESS_LOCK:
        data = _normalized_store()
        previous = dict(data["principals"].get(principal, {}))
        record = {
            "display_name": str(display_name or previous.get("display_name") or "")[:200],
            "known_ips": next_ips,
            "capabilities": next_capabilities,
            "updated_at": utc_now(),
            "updated_by": str(actor)[:256],
        }
        data["principals"][principal] = record
        ACCESS_STORE.write(data)

        before = set(previous.get("capabilities", []))
        after = set(next_capabilities)
        changes = []
        for capability in sorted(before | after):
            if (capability in before) != (capability in after):
                changes.append(
                    {
                        "target": principal,
                        "capability": capability,
                        "previous": capability in before,
                        "new": capability in after,
                        "actor": str(actor),
                        "timestamp": record["updated_at"],
                    }
                )
        if changes:
            audit = AUDIT_STORE.read()
            entries = audit.get("entries", []) if isinstance(audit, dict) else []
            AUDIT_STORE.write({"version": 1, "entries": [*entries, *changes][-5000:]})
    return {"principal": principal, **record}


def audit_entries(limit: int = 200) -> list[dict]:
    data = AUDIT_STORE.read()
    entries = data.get("entries", []) if isinstance(data, dict) else []
    return list(reversed([entry for entry in entries if isinstance(entry, dict)][-max(1, min(limit, 1000)) :]))
