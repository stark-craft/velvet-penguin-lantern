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
from venture_lens.router import router as venture_lens_router


app.include_router(venture_lens_router)

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
}


@app.get("/")
def serve_root():
    index_path = os.path.join(abs_frontend_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {
        "status": "error",
        "message": "UI not built yet. Run npm run build inside news-ui.",
    }


@app.get("/{catchall:path}")
def serve_react_app(catchall: str):
    root = catchall.split("/")[0]
    if root in API_ROUTES:
        raise HTTPException(status_code=404, detail="Not Found")
    index_path = os.path.join(abs_frontend_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {
        "status": "error",
        "message": "UI not built yet. Run npm run build inside news-ui.",
    }
