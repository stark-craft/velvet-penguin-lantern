"""FastAPI application composition for Signalroom."""

from __future__ import annotations

import math
import threading
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator, Dict, Optional, Tuple

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from signalroom.api import BackgroundJobManager, router
from signalroom.branding import PRODUCT_NAME
from signalroom.config import Settings
from signalroom.ml.training import TrainingDataError
from signalroom.profiles import ProfileRegistry
from signalroom.security import get_client_ip, hash_client_ip
from signalroom.services.pipeline import PipelineBusyError, PipelineService
from signalroom.json_storage import JSONRepository
from signalroom.storage import (
    DuplicateRecordError,
    InvalidJobTransitionError,
    RecordNotFoundError,
    SQLiteRepository,
    UnsafePayloadError,
)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message},
    )


_MUTATION_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class _FixedWindowMutationLimiter:
    """Small process-local limiter keyed by a non-reversible client pseudonym."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self._lock = threading.Lock()
        self._window = -1
        self._counts: Dict[str, int] = {}

    def consume(self, client_key: str) -> Tuple[bool, int, int]:
        now = time.monotonic()
        window = int(now // 60)
        retry_after = max(1, math.ceil(((window + 1) * 60) - now))
        with self._lock:
            if window != self._window:
                self._window = window
                self._counts.clear()
            count = self._counts.get(client_key, 0)
            if count >= self.limit:
                return False, 0, retry_after
            count += 1
            self._counts[client_key] = count
            return True, self.limit - count, retry_after


async def _enforce_body_limit(
    request: Request,
    maximum_bytes: int,
) -> Optional[JSONResponse]:
    """Read at most one bounded mutation body and cache it for FastAPI."""

    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            declared_bytes = int(declared)
        except ValueError:
            return _error(400, "invalid_content_length", "Content-Length must be an integer")
        if declared_bytes < 0:
            return _error(400, "invalid_content_length", "Content-Length cannot be negative")
        if declared_bytes > maximum_bytes:
            return _error(
                413,
                "request_too_large",
                f"mutation request body exceeds {maximum_bytes} bytes",
            )

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > maximum_bytes:
            return _error(
                413,
                "request_too_large",
                f"mutation request body exceeds {maximum_bytes} bytes",
            )
    # Starlette's cached-request receive path replays this body to FastAPI's
    # validators, including when no Content-Length header was provided.
    request._body = bytes(body)  # type: ignore[attr-defined]
    return None


def create_app(
    *,
    settings: Optional[Settings] = None,
    profiles: Optional[ProfileRegistry] = None,
    repository: Optional[SQLiteRepository | JSONRepository] = None,
    pipeline: Optional[PipelineService] = None,
    job_manager: Optional[BackgroundJobManager] = None,
) -> FastAPI:
    """Compose an application, allowing every stateful service to be injected."""

    active_settings = settings or Settings.from_env()
    active_settings.prepare_runtime_directories()
    active_profiles = profiles or ProfileRegistry.from_settings(active_settings)
    active_repository = repository or JSONRepository(active_settings.storage_path)
    active_pipeline = pipeline or PipelineService(
        active_settings,
        active_profiles,
        active_repository,
    )
    active_manager = job_manager or BackgroundJobManager(
        active_pipeline,
        active_repository,
    )
    owns_manager = job_manager is None

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        yield
        if owns_manager:
            application.state.job_manager.shutdown(wait=False)

    application = FastAPI(
        title=f"{PRODUCT_NAME} API",
        version="0.1.0",
        description="Profile-aware news intelligence and editorial workflow API.",
        lifespan=lifespan,
    )
    application.state.settings = active_settings
    application.state.profiles = active_profiles
    application.state.repository = active_repository
    application.state.pipeline = active_pipeline
    application.state.job_manager = active_manager
    mutation_limiter = _FixedWindowMutationLimiter(
        active_settings.mutation_rate_limit_per_minute
    )
    application.state.mutation_limiter = mutation_limiter

    @application.middleware("http")
    async def protect_mutations(request: Request, call_next):
        if request.method.upper() not in _MUTATION_METHODS:
            return await call_next(request)

        client_ip = get_client_ip(request, active_settings)
        client_key = hash_client_ip(client_ip, active_settings)
        allowed, remaining, retry_after = mutation_limiter.consume(client_key)
        if not allowed:
            response = _error(
                429,
                "mutation_rate_limited",
                "too many state-changing requests from this client",
            )
            response.headers["Retry-After"] = str(retry_after)
            response.headers["X-RateLimit-Limit"] = str(
                active_settings.mutation_rate_limit_per_minute
            )
            response.headers["X-RateLimit-Remaining"] = "0"
            return response

        rejected = await _enforce_body_limit(request, active_settings.max_request_bytes)
        if rejected is not None:
            rejected.headers["X-RateLimit-Limit"] = str(
                active_settings.mutation_rate_limit_per_minute
            )
            rejected.headers["X-RateLimit-Remaining"] = str(remaining)
            return rejected

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(
            active_settings.mutation_rate_limit_per_minute
        )
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response

    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(active_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=[
            "Content-Disposition",
            "Retry-After",
            "X-RateLimit-Limit",
            "X-RateLimit-Remaining",
            "X-Signalroom-Article-Count",
        ],
    )
    application.include_router(router)

    @application.exception_handler(RecordNotFoundError)
    async def not_found(_: Request, exc: RecordNotFoundError) -> JSONResponse:
        return _error(404, "not_found", str(exc))

    @application.exception_handler(DuplicateRecordError)
    async def duplicate(_: Request, exc: DuplicateRecordError) -> JSONResponse:
        return _error(409, "duplicate_record", str(exc))

    @application.exception_handler(InvalidJobTransitionError)
    async def invalid_transition(
        _: Request, exc: InvalidJobTransitionError
    ) -> JSONResponse:
        return _error(409, "invalid_job_transition", str(exc))

    @application.exception_handler(PipelineBusyError)
    async def pipeline_busy(_: Request, exc: PipelineBusyError) -> JSONResponse:
        return _error(409, "pipeline_busy", str(exc))

    @application.exception_handler(UnsafePayloadError)
    async def unsafe_payload(_: Request, exc: UnsafePayloadError) -> JSONResponse:
        return _error(422, "unsafe_payload", str(exc))

    @application.exception_handler(TrainingDataError)
    async def training_data(_: Request, exc: TrainingDataError) -> JSONResponse:
        return _error(422, "insufficient_training_data", str(exc))

    @application.exception_handler(ValueError)
    async def invalid_value(_: Request, exc: ValueError) -> JSONResponse:
        return _error(422, "invalid_value", str(exc))

    return application


def build_default_app() -> FastAPI:
    """Explicit factory retained for uvicorn's ``--factory`` mode."""

    return create_app()
