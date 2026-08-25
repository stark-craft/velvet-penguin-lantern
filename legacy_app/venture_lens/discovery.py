"""Resilient, provider-isolated discovery service for Venture Lens.

This service is intentionally independent from NewsScrapper's scheduler.  It
serves the last successful provider cache immediately, refreshes stale sources
on their own TTLs, and never replaces a healthy cache with an empty failure.
"""

from __future__ import annotations

import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Callable

from core.settings import VENTURE_LENS_RUNTIME_DIR
from core.storage import JsonStore
from venture_lens.catalog import GITHUB_CATEGORIES
from venture_lens.providers.huggingface import fetch_datasets, fetch_models
from venture_lens.providers.openalex import fetch_openalex_works
from venture_lens.providers.patents import configured as epo_configured
from venture_lens.providers.patents import fetch_patents
from venture_lens.providers.social import configured as x_configured
from venture_lens.providers.social import fetch_social_signals
from venture_lens.service import venture_lens_service


PROVIDER_TTLS = {
    "github": timedelta(hours=6),
    "arxiv": timedelta(hours=12),
    "openalex": timedelta(hours=12),
    "huggingface": timedelta(hours=6),
    "epo": timedelta(hours=24),
    "x": timedelta(minutes=30),
}

PAPER_CATEGORY_TO_TECH = {
    "agents": "ai-agents",
    "retrieval": "rag",
    "language-models": "deep-learning",
    "multimodal": "computer-vision",
    "efficiency": "llm-efficiency",
    "software-engineering": "ai-coding",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _now().isoformat(timespec="seconds")


def _clean(value: object, limit: int = 1200) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _parse_date(value: object) -> datetime | None:
    raw = str(value or "").strip().replace("Z", "+00:00")
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _is_fresh(payload: dict, ttl: timedelta) -> bool:
    refreshed = _parse_date(payload.get("refreshed_at"))
    return bool(refreshed and _now() - refreshed < ttl)


def _normalized_title(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", _clean(value, 500).lower())


def _metric_total(kind: str, metrics: dict) -> int:
    fields = {
        "repository": ("stars", "forks"),
        "paper": ("citations",),
        "model": ("downloads", "likes"),
        "dataset": ("downloads", "likes"),
        "patent": ("family_count",),
        "technology": ("evidence_count",),
        "social": ("engagement",),
    }.get(kind, ())
    return sum(max(0, int(metrics.get(field) or 0)) for field in fields)


def _artifact(
    *,
    identifier: object,
    kind: str,
    title: object,
    summary: object,
    url: object,
    source: object,
    published_at: object = None,
    updated_at: object = None,
    category: object = "",
    metrics: dict | None = None,
    starter_snapshot: bool = False,
    extra: dict | None = None,
) -> dict:
    return {
        "id": _clean(identifier, 300),
        "kind": kind,
        "title": _clean(title, 420) or f"Untitled {kind}",
        "summary": _clean(summary, 1200),
        "url": _clean(url, 900),
        "source": _clean(source, 160),
        "published_at": _clean(published_at, 40) or None,
        "updated_at": _clean(updated_at, 40) or None,
        "category": _clean(category, 160) or "General",
        "metrics": metrics or {},
        "momentum": None,
        "starter_snapshot": bool(starter_snapshot),
        **(extra or {}),
    }


def normalize_repository(raw: dict) -> dict:
    return _artifact(
        identifier=raw.get("id") or raw.get("full_name"),
        kind="repository",
        title=raw.get("full_name") or raw.get("name"),
        summary=raw.get("description"),
        url=raw.get("url"),
        source="GitHub",
        updated_at=raw.get("updated_at"),
        category=raw.get("category"),
        metrics={
            "stars": raw.get("stars"),
            "forks": raw.get("forks"),
            "open_issues": raw.get("open_issues"),
        },
        starter_snapshot=raw.get("starter_snapshot", False),
        extra={"topics": list(raw.get("topics") or [])[:8], "language": raw.get("language") or ""},
    )


def normalize_arxiv_paper(raw: dict) -> dict:
    return _artifact(
        identifier=raw.get("id"),
        kind="paper",
        title=raw.get("title"),
        summary=raw.get("summary"),
        url=raw.get("url"),
        source="arXiv",
        published_at=raw.get("published_at"),
        updated_at=raw.get("updated_at"),
        category=raw.get("category"),
        metrics={"authors": len(raw.get("authors") or [])},
        starter_snapshot=raw.get("starter_snapshot", False),
        extra={
            "authors": list(raw.get("authors") or [])[:8],
            "arxiv_id": _clean(raw.get("id"), 160),
            "doi": _clean(raw.get("doi"), 240).lower(),
            "pdf_url": _clean(raw.get("pdf_url"), 900),
        },
    )


def normalize_openalex_paper(raw: dict) -> dict:
    return _artifact(
        identifier=raw.get("id"),
        kind="paper",
        title=raw.get("title"),
        summary=raw.get("summary"),
        url=raw.get("url"),
        source="OpenAlex",
        published_at=raw.get("published_at"),
        updated_at=raw.get("updated_at"),
        category=raw.get("category"),
        metrics={"citations": raw.get("citations"), "authors": len(raw.get("authors") or [])},
        starter_snapshot=False,
        extra={
            "authors": list(raw.get("authors") or [])[:8],
            "institutions": list(raw.get("institutions") or [])[:8],
            "arxiv_id": _clean(raw.get("arxiv_id"), 160),
            "doi": _clean(raw.get("doi"), 240).lower(),
            "venue": _clean(raw.get("venue"), 180),
            "open_access": bool(raw.get("open_access")),
        },
    )


def normalize_huggingface(raw: dict, kind: str) -> dict:
    return _artifact(
        identifier=raw.get("id"),
        kind=kind,
        title=raw.get("title") or raw.get("id"),
        summary=raw.get("summary"),
        url=raw.get("url"),
        source="Hugging Face Hub",
        published_at=raw.get("published_at"),
        updated_at=raw.get("updated_at"),
        category=raw.get("category"),
        metrics={"downloads": raw.get("downloads"), "likes": raw.get("likes")},
        starter_snapshot=raw.get("starter_snapshot", False),
        extra={"tags": list(raw.get("tags") or [])[:10], "author": raw.get("author") or ""},
    )


def normalize_patent(raw: dict) -> dict:
    return _artifact(
        identifier=raw.get("id"),
        kind="patent",
        title=raw.get("title"),
        summary=raw.get("summary"),
        url=raw.get("url"),
        source="EPO OPS",
        published_at=raw.get("published_at"),
        updated_at=raw.get("updated_at"),
        category=raw.get("category"),
        metrics={"family_count": raw.get("family_count")},
    )


def normalize_social(raw: dict) -> dict:
    return _artifact(
        identifier=raw.get("id"),
        kind="social",
        title=raw.get("title"),
        summary=raw.get("summary"),
        url=raw.get("url"),
        source="X",
        published_at=raw.get("published_at"),
        updated_at=raw.get("updated_at"),
        category=raw.get("category"),
        metrics={"engagement": raw.get("engagement")},
    )


def deduplicate_papers(items: list[dict]) -> list[dict]:
    """Merge arXiv/OpenAlex records without comparing unlike metrics."""

    merged: list[dict] = []
    keys: dict[str, int] = {}
    for item in items:
        identifiers = [
            f"doi:{item.get('doi')}" if item.get("doi") else "",
            f"arxiv:{item.get('arxiv_id')}" if item.get("arxiv_id") else "",
            f"title:{_normalized_title(item.get('title'))}",
        ]
        index = next((keys[key] for key in identifiers if key and key in keys), None)
        if index is None:
            index = len(merged)
            merged.append(dict(item))
        else:
            current = merged[index]
            current["metrics"] = {**(current.get("metrics") or {}), **(item.get("metrics") or {})}
            for field in ("summary", "doi", "arxiv_id", "venue", "institutions", "authors", "pdf_url"):
                if not current.get(field) and item.get(field):
                    current[field] = item[field]
            sources = [part.strip() for part in str(current.get("source") or "").split(" + ") if part.strip()]
            if item.get("source") not in sources:
                sources.append(str(item.get("source")))
            current["source"] = " + ".join(sources)
        for key in identifiers:
            if key:
                keys[key] = index
    return merged


def interleave_artifacts(groups: list[list[dict]], limit: int) -> list[dict]:
    output: list[dict] = []
    indexes = [0] * len(groups)
    while len(output) < limit:
        changed = False
        for group_index, group in enumerate(groups):
            item_index = indexes[group_index]
            if item_index < len(group):
                output.append(group[item_index])
                indexes[group_index] += 1
                changed = True
                if len(output) >= limit:
                    break
        if not changed:
            break
    return output


class VentureDiscoveryService:
    def __init__(self) -> None:
        self.openalex_store = JsonStore(VENTURE_LENS_RUNTIME_DIR / "openalex_cache.json", dict)
        self.models_store = JsonStore(VENTURE_LENS_RUNTIME_DIR / "models_cache.json", dict)
        self.datasets_store = JsonStore(VENTURE_LENS_RUNTIME_DIR / "datasets_cache.json", dict)
        self.patents_store = JsonStore(VENTURE_LENS_RUNTIME_DIR / "patents_cache.json", dict)
        self.social_store = JsonStore(VENTURE_LENS_RUNTIME_DIR / "social_cache.json", dict)
        self.snapshot_store = JsonStore(VENTURE_LENS_RUNTIME_DIR / "metric_snapshots.json", dict)
        self._locks = {name: threading.Lock() for name in PROVIDER_TTLS}

    @staticmethod
    def _store_payload(items: list[dict], source: str) -> dict:
        return {"status": "live", "source": source, "refreshed_at": _iso_now(), "items": items, "errors": []}

    def _record_snapshots(self, artifacts: list[dict]) -> None:
        captured_at = _iso_now()

        def update(payload: dict) -> dict:
            for artifact in artifacts:
                key = f"{artifact.get('kind')}:{artifact.get('id')}"
                total = _metric_total(str(artifact.get("kind")), artifact.get("metrics") or {})
                current = payload.get(key) if isinstance(payload.get(key), dict) else {}
                last = current.get("current") if isinstance(current.get("current"), dict) else None
                if last and int(last.get("value") or 0) == total:
                    current["current"] = {"value": total, "captured_at": captured_at}
                else:
                    current = {"previous": last, "current": {"value": total, "captured_at": captured_at}}
                payload[key] = current
            return payload

        self.snapshot_store.update(update)

    def _with_momentum(self, artifacts: list[dict]) -> list[dict]:
        snapshots = self.snapshot_store.read()
        enriched = []
        for artifact in artifacts:
            copy = dict(artifact)
            history = snapshots.get(f"{artifact.get('kind')}:{artifact.get('id')}") or {}
            previous = history.get("previous") if isinstance(history.get("previous"), dict) else None
            current = history.get("current") if isinstance(history.get("current"), dict) else None
            if previous and current:
                left = int(previous.get("value") or 0)
                right = int(current.get("value") or 0)
                copy["momentum"] = round(((right - left) / max(1, left)) * 100, 1)
            else:
                copy["momentum"] = None
            enriched.append(copy)
        return enriched

    def _refresh_store(self, name: str, store: JsonStore, fetcher: Callable[[], list[dict]], normalizer: Callable[[dict], dict], source: str, force: bool = False) -> dict:
        current = store.read()
        if not force and current.get("items") and _is_fresh(current, PROVIDER_TTLS[name]):
            return current
        with self._locks[name]:
            try:
                items = [normalizer(raw) for raw in fetcher()]
                items = [item for item in items if item.get("id") and item.get("title")]
                if not items:
                    raise RuntimeError(f"{source} returned no usable artifacts.")
                payload = self._store_payload(items, source)
                store.write(payload)
                self._record_snapshots(items)
                return payload
            except Exception as error:
                return {
                    **current,
                    "status": current.get("status") or "unavailable",
                    "refresh_failed": True,
                    "stale": True,
                    "errors": [_clean(error, 500)],
                }

    def refresh_provider(self, name: str, force: bool = False) -> dict:
        if name == "github":
            payload = venture_lens_service.refresh_github(force=force)
            self._record_snapshots([normalize_repository(item) for item in payload.get("items") or []])
            return payload
        if name == "arxiv":
            payload = venture_lens_service.refresh_research(force=force)
            self._record_snapshots([normalize_arxiv_paper(item) for item in payload.get("items") or []])
            return payload
        if name == "openalex":
            return self._refresh_store(name, self.openalex_store, fetch_openalex_works, normalize_openalex_paper, "OpenAlex", force)
        if name == "huggingface":
            models = self._refresh_store(name, self.models_store, fetch_models, lambda raw: normalize_huggingface(raw, "model"), "Hugging Face models", force)
            datasets = self._refresh_store(name, self.datasets_store, fetch_datasets, lambda raw: normalize_huggingface(raw, "dataset"), "Hugging Face datasets", force)
            return {"models": models, "datasets": datasets}
        if name == "epo":
            if not epo_configured():
                return {"status": "unavailable", "reason": "not_configured", "items": []}
            return self._refresh_store(name, self.patents_store, fetch_patents, normalize_patent, "EPO OPS", force)
        if name == "x":
            if not x_configured():
                return {"status": "unavailable", "reason": "not_configured", "items": []}
            return self._refresh_store(name, self.social_store, fetch_social_signals, normalize_social, "X", force)
        raise ValueError(f"Unknown Venture Lens provider: {name}")

    def stale_providers(self) -> list[str]:
        states = self.provider_states()
        return [name for name, state in states.items() if state.get("available") and state.get("stale")]

    def provider_states(self) -> dict[str, dict]:
        github = venture_lens_service.github()
        arxiv = venture_lens_service.research()
        openalex = self.openalex_store.read()
        models = self.models_store.read()
        datasets = self.datasets_store.read()
        patents = self.patents_store.read()
        social = self.social_store.read()
        return {
            "github": {"available": True, "stale": not _is_fresh(github, PROVIDER_TTLS["github"])},
            "arxiv": {"available": True, "stale": not _is_fresh(arxiv, PROVIDER_TTLS["arxiv"])},
            "openalex": {"available": True, "stale": not _is_fresh(openalex, PROVIDER_TTLS["openalex"])},
            "huggingface": {"available": True, "stale": not (_is_fresh(models, PROVIDER_TTLS["huggingface"]) and _is_fresh(datasets, PROVIDER_TTLS["huggingface"]))},
            "epo": ({"available": True, "stale": not _is_fresh(patents, PROVIDER_TTLS["epo"])} if epo_configured() else {"available": False, "reason": "not_configured"}),
            "x": ({"available": True, "stale": not _is_fresh(social, PROVIDER_TTLS["x"])} if x_configured() else {"available": False, "reason": "not_configured"}),
        }

    @staticmethod
    def _popular(items: list[dict]) -> list[dict]:
        return sorted(
            items,
            key=lambda item: (
                _metric_total(str(item.get("kind")), item.get("metrics") or {}),
                str(item.get("updated_at") or item.get("published_at") or ""),
            ),
            reverse=True,
        )

    def _technology_artifacts(self, repositories: list[dict], papers: list[dict]) -> list[dict]:
        output = []
        for category in GITHUB_CATEGORIES:
            category_id = category["id"]
            repos = [item for item in repositories if item.get("category") == category_id]
            related_papers = [item for item in papers if PAPER_CATEGORY_TO_TECH.get(str(item.get("category"))) == category_id]
            evidence_count = len(repos) + len(related_papers)
            output.append(_artifact(
                identifier=category_id,
                kind="technology",
                title=category["label"],
                summary=category["description"],
                url=f"/venturelens/radar?signal={category_id}",
                source="Venture Lens synthesis",
                category=category["label"],
                metrics={"repositories": len(repos), "papers": len(related_papers), "evidence_count": evidence_count},
                starter_snapshot=all(item.get("starter_snapshot") for item in [*repos, *related_papers]) if evidence_count else True,
            ))
        return output

    def discovery(self) -> dict:
        repositories = [normalize_repository(item) for item in venture_lens_service.github().get("items") or []]
        arxiv = [normalize_arxiv_paper(item) for item in venture_lens_service.research().get("items") or []]
        openalex = list(self.openalex_store.read().get("items") or [])
        papers = deduplicate_papers([*arxiv, *openalex])
        models = list(self.models_store.read().get("items") or [])
        datasets = list(self.datasets_store.read().get("items") or [])
        patents = list(self.patents_store.read().get("items") or []) if epo_configured() else []
        social = list(self.social_store.read().get("items") or []) if x_configured() else []
        technologies = self._technology_artifacts(repositories, papers)

        lanes = {
            "repositories": self._with_momentum(self._popular(repositories)),
            "papers": self._with_momentum(self._popular(papers)),
            "models": self._with_momentum(self._popular(models)),
            "datasets": self._with_momentum(self._popular(datasets)),
            "patents": self._with_momentum(self._popular(patents)),
        }
        technology_items = self._with_momentum(self._popular(technologies))
        social_items = self._with_momentum(self._popular(social))
        preferred = [
            lanes["papers"], lanes["repositories"], lanes["models"],
            lanes["datasets"], lanes["patents"], technology_items,
        ]
        featured = [items[0] for items in preferred if items][:6]
        # Social conversation may annotate the stream, but never earns a
        # featured slot without another evidence provider.
        stream = interleave_artifacts([
            lanes["repositories"], lanes["papers"], lanes["models"],
            lanes["datasets"], lanes["patents"], technology_items, social_items,
        ], 12)
        return {
            "status": "success",
            "generated_at": _iso_now(),
            "featured": featured,
            "stream": stream,
            "lanes": lanes,
            "providers": self.provider_states(),
        }

    def artifact(self, kind: str, identifier: str) -> dict | None:
        lane = {
            "model": "models",
            "dataset": "datasets",
            "patent": "patents",
        }.get(kind)
        if not lane:
            return None
        item = next((artifact for artifact in self.discovery()["lanes"][lane] if str(artifact.get("id")) == identifier), None)
        if not item:
            return None
        metric_names = ", ".join(str(name).replace("_", " ") for name, value in item.get("metrics", {}).items() if value is not None)
        return {
            **item,
            "assessment": item.get("summary") or f"A current {kind} signal from {item.get('source')}.",
            "practical_relevance": f"Use the source record to validate licensing, provenance, maintenance and fit before adoption. Available evidence includes {metric_names or 'provider metadata'}.",
            "limitations": [
                "Provider popularity is not a substitute for technical or legal due diligence.",
                "Metrics are compared only with other artifacts of the same type.",
            ],
        }

    def refresh_all(self, force: bool = False) -> dict:
        names = ["github", "arxiv", "openalex", "huggingface"]
        if epo_configured():
            names.append("epo")
        if x_configured():
            names.append("x")
        with ThreadPoolExecutor(max_workers=min(4, len(names))) as pool:
            futures = {name: pool.submit(self.refresh_provider, name, force) for name in names}
            return {name: future.result() for name, future in futures.items()}


venture_discovery_service = VentureDiscoveryService()
