"""Sense.AI application composition root.

Run the complete platform with:

    uvicorn main:app --reload

NewsScrapper owns the established scheduler and intelligence APIs. Venture
Lens is mounted alongside it before the frontend catch-all route.
"""

from __future__ import annotations

import os

from fastapi import HTTPException
from fastapi.responses import FileResponse

from news_scrapper.application import app, abs_frontend_path
from news_scrapper.recommendation import router as recommendation_router
from news_scrapper.translation import router as translation_router
from venture_lens.router import router as venture_lens_router


app.include_router(venture_lens_router)
app.include_router(translation_router)
app.include_router(recommendation_router)


@app.middleware("http")
async def serve_for_you_spa_deep_link(request, call_next):
    """Disambiguate the browser route from the compatibility JSON endpoint.

    Browser navigation advertises ``text/html`` and must receive the React
    application. API clients (and the frontend's /viewer/for-you request) keep
    receiving JSON from the recommendation router.
    """
    if request.url.path.rstrip("/") == "/for-you" and "text/html" in request.headers.get("accept", ""):
        return serve_root()
    return await call_next(request)

API_ROUTES = {
    "archive",
    "crawl",
    "train",
    "status",
    "briefing",
    "export-excel",
    "export-ppt",
    "export-word",
    "sites",
    "latest-briefing",
    "workflow",
    "history",
    "not-interested",
    "region",
    "track",
    "analytics",
    "profile",
    "viewer",
    "voc",
    "insight",
    "gatekeeper",
    "trends",
    "venture-lens",
    "translation",
    "for-you",
    "assets",
}


def frontend_index_response():
    """Serve the current SPA shell without caching a stale deployment."""

    index_path = os.path.join(abs_frontend_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(
            index_path,
            headers={"Cache-Control": "no-cache, must-revalidate"},
        )
    raise HTTPException(
        status_code=503,
        detail=(
            f"UI build not found at {index_path}. Build news-ui or place the "
            "portable bundle under frontend/dist."
        ),
    )


@app.get("/")
def serve_root():
    return frontend_index_response()


@app.get("/{catchall:path}")
def serve_react_app(catchall: str):
    root = catchall.split("/")[0]
    if root in API_ROUTES:
        raise HTTPException(status_code=404, detail="Not Found")
    return frontend_index_response()
