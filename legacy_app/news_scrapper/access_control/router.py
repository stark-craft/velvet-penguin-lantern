"""Same-origin API for capability discovery and access administration."""

from __future__ import annotations

import os
import secrets

from fastapi import APIRouter, Body, HTTPException, Query, Request, Response

from . import service
from core.request_limits import REQUEST_LIMITER

router = APIRouter(prefix="/access-control", tags=["Access Control"])


def _role_key(role: str) -> str:
    keys = {
        "director": os.environ.get("DIRECTOR_KEY", ""),
        "gatekeeper": os.environ.get("GATEKEEPER_KEY", ""),
        "analytics": os.environ.get("ANALYTICS_KEY", ""),
        "editor": os.environ.get("INTERNAL_EDITOR_KEY", ""),
    }
    return str(keys.get(role, "") or "")


ROLE_CAPABILITIES = {
    "director": service.ALL_CAPABILITIES - {"access.manage"},
    "gatekeeper": {"gatekeeper.review", "model.train", "region.correct"},
    "analytics": {"analytics.view"},
    "editor": {"review.contributions.view", "review.contributions.publish"},
}


@router.get("/capabilities")
def capabilities(request: Request, response: Response):
    principal, ip = service.resolve_principal(request, response)
    values = sorted(service.effective_capabilities(request, response))
    return {
        "status": "success",
        "principal": principal,
        "ip": ip,
        "capabilities": values,
    }


@router.post("/session/unlock")
def unlock_session(
    request: Request,
    response: Response,
    payload: dict = Body(...),
):
    REQUEST_LIMITER.check(
        "privileged.unlock", service.request_ip(request), limit=10, window_seconds=15 * 60
    )
    role = str(payload.get("role") or "").strip().lower()
    expected = _role_key(role)
    provided = str(payload.get("key") or "")
    if role not in ROLE_CAPABILITIES or not expected or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="Those credentials were not accepted.")
    service.create_privileged_session(
        request,
        response,
        ROLE_CAPABILITIES[role],
        role=role,
    )
    return {"status": "success", "role": role, "capabilities": sorted(ROLE_CAPABILITIES[role])}


@router.post("/session/logout")
def logout_session(request: Request, response: Response):
    service.revoke_privileged_session(request, response)
    return {"status": "success"}


@router.get("/principals")
def principals(request: Request):
    service.require_capability(request, "access.manage")
    return {"status": "success", "items": service.list_principals()}


@router.put("/principals/{principal}")
def save_principal(principal: str, request: Request, payload: dict = Body(...)):
    actor = service.require_capability(request, "access.manage")
    REQUEST_LIMITER.check(
        "access.manage", actor, limit=60, window_seconds=60
    )
    try:
        record = service.update_principal(
            principal,
            display_name=str(payload.get("display_name") or ""),
            known_ips=payload.get("known_ips") or [],
            capabilities=payload.get("capabilities") or [],
            actor=actor,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"status": "success", "item": record}


@router.get("/audit")
def audit(request: Request, limit: int = Query(200, ge=1, le=1000)):
    service.require_capability(request, "access.manage")
    return {"status": "success", "items": service.audit_entries(limit)}
