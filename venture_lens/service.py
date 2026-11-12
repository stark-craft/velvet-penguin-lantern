"""Caching and orchestration for Venture Lens providers."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Callable

from core.settings import VENTURE_LENS_RUNTIME_DIR
from core.storage import JsonStore
from venture_lens.catalog import (
    GITHUB_CATEGORIES,
    RESEARCH_CATEGORIES,
    STARTER_PAPERS,
    STARTER_REPOSITORIES,
)
from venture_lens.providers.github import fetch_repositories
from venture_lens.providers.research import fetch_papers


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _now().isoformat(timespec="seconds")


class VentureLensService:
    def __init__(self) -> None:
        self.github_store = JsonStore(
            VENTURE_LENS_RUNTIME_DIR / "github_cache.json", dict
        )
        self.research_store = JsonStore(
            VENTURE_LENS_RUNTIME_DIR / "research_cache.json", dict
        )
        self._refresh_lock = threading.Lock()

    @staticmethod
    def _is_fresh(payload: dict, hours: int) -> bool:
        try:
            updated = datetime.fromisoformat(payload.get("refreshed_at", ""))
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            return _now() - updated < timedelta(hours=hours)
        except (TypeError, ValueError):
            return False

    @staticmethod
    def _seed_payload(items: list[dict], categories: list[dict]) -> dict:
        return {
            "status": "starter",
            "source": "curated starter snapshot",
            "refreshed_at": None,
            "items": items,
            "categories": categories,
            "errors": [],
        }

    @staticmethod
    def _bounded_github(payload: dict) -> dict:
        bounded = []
        for raw in payload.get("items") or []:
            item = dict(raw)
            item["name"] = str(item.get("name") or "Untitled repository")[:100]
            item["full_name"] = str(item.get("full_name") or item["name"])[:180]
            item["description"] = str(
                item.get("description") or "No description provided."
            )[:420]
            item["owner"] = str(item.get("owner") or "Unknown")[:100]
            item["topics"] = [
                str(topic)[:50] for topic in (item.get("topics") or [])[:6]
            ]
            if item.get("starter_snapshot"):
                for field in ("stars", "forks", "open_issues"):
                    if not item.get(field):
                        item[field] = None
            bounded.append(item)
        return {**payload, "items": bounded}

    @staticmethod
    def _bounded_research(payload: dict) -> dict:
        bounded = []
        for raw in payload.get("items") or []:
            item = dict(raw)
            item["title"] = str(item.get("title") or "Untitled research")[:300]
            item["summary"] = str(item.get("summary") or "")[:1800]
            item["authors"] = [
                str(author)[:100] for author in (item.get("authors") or [])[:6]
            ]
            bounded.append(item)
        return {**payload, "items": bounded}

    def github(self) -> dict:
        cached = self.github_store.read()
        payload = cached if cached.get("items") else self._seed_payload(
            STARTER_REPOSITORIES, GITHUB_CATEGORIES
        )
        payload = self._bounded_github(payload)
        populated = {
            str(item.get("category") or "") for item in payload.get("items") or []
        }
        missing = [
            item
            for item in STARTER_REPOSITORIES
            if item.get("category") not in populated
        ]
        return {
            **payload,
            "items": [*(payload.get("items") or []), *missing],
            "partial_fallback": bool(missing),
        }

    def research(self) -> dict:
        cached = self.research_store.read()
        payload = cached if cached.get("items") else self._seed_payload(
            STARTER_PAPERS, RESEARCH_CATEGORIES
        )
        return self._bounded_research(payload)

    @staticmethod
    def _fetch_catalog(
        categories: list[dict],
        fetcher: Callable[[str, str, int], list[dict]],
        max_workers: int = 3,
    ) -> tuple[list[dict], list[str]]:
        items: list[dict] = []
        errors: list[str] = []
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(fetcher, category["query"], category["id"], 10): category
                for category in categories
            }
            for future in as_completed(futures):
                category = futures[future]
                try:
                    items.extend(future.result())
                except Exception as error:
                    errors.append(f"{category['label']}: {error}")
        return items, errors

    def refresh_github(self, force: bool = False) -> dict:
        current = self.github()
        if not force and self._is_fresh(current, 6):
            return current
        with self._refresh_lock:
            items, errors = self._fetch_catalog(
                GITHUB_CATEGORIES, fetch_repositories
            )
            if not items:
                return {**current, "errors": errors, "refresh_failed": True}
            payload = {
                "status": "live",
                "source": "GitHub public repository search",
                "refreshed_at": _iso_now(),
                "items": items,
                "categories": GITHUB_CATEGORIES,
                "errors": errors,
            }
            return self.github_store.write(payload)

    def refresh_research(self, force: bool = False) -> dict:
        current = self.research()
        if not force and self._is_fresh(current, 12):
            return current
        with self._refresh_lock:
            items, errors = self._fetch_catalog(
                RESEARCH_CATEGORIES, fetch_papers, max_workers=1
            )
            if not items:
                return {**current, "errors": errors, "refresh_failed": True}
            payload = {
                "status": "live",
                "source": "arXiv API",
                "refreshed_at": _iso_now(),
                "items": items,
                "categories": RESEARCH_CATEGORIES,
                "errors": errors,
            }
            return self.research_store.write(payload)

    def refresh_all(self, force: bool = False) -> dict:
        with ThreadPoolExecutor(max_workers=2) as pool:
            github_future = pool.submit(self.refresh_github, force)
            research_future = pool.submit(self.refresh_research, force)
            return {
                "github": github_future.result(),
                "research": research_future.result(),
            }


venture_lens_service = VentureLensService()
