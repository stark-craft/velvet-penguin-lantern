"""Derived decision intelligence for Venture Lens.

The provider cache remains the source of truth. This module turns that cache
into radar scores, dossiers, comparisons, graphs, watchlists, notifications and
briefs without requiring another model or database.
"""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone
from typing import Iterable

from core.settings import VENTURE_LENS_RUNTIME_DIR
from core.storage import JsonStore
from venture_lens.catalog import GITHUB_CATEGORIES


PAPER_TO_TECH = {
    "agents": "ai-agents",
    "retrieval": "rag",
    "language-models": "deep-learning",
    "multimodal": "computer-vision",
    "efficiency": "llm-efficiency",
    "software-engineering": "ai-coding",
}


def _bounded(value: object, limit: int = 360) -> str:
    return " ".join(str(value or "").split())[:limit]


def _date(value: object) -> datetime | None:
    raw = str(value or "").strip().replace("Z", "+00:00")
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _recency(value: object, horizon_days: int = 365) -> float:
    parsed = _date(value)
    if not parsed:
        return 0.35
    age = max(0, (datetime.now(timezone.utc) - parsed).days)
    return max(0.05, 1 - (age / horizon_days))


def _stage(score: int) -> str:
    if score >= 82:
        return "Adopt"
    if score >= 68:
        return "Evaluate"
    if score >= 52:
        return "Explore"
    return "Watch"


def repository_score(repository: dict) -> int:
    stars = max(0, int(repository.get("stars") or 0))
    forks = max(0, int(repository.get("forks") or 0))
    issues = max(0, int(repository.get("open_issues") or 0))
    popularity = min(1, math.log10(stars + 1) / 5.3)
    community = min(1, math.log10(forks + 1) / 4.3)
    health = 1 - min(0.55, issues / max(80, stars * 0.06 + 80))
    score = 22 + popularity * 34 + community * 18 + _recency(repository.get("updated_at")) * 20 + health * 6
    if repository.get("starter_snapshot"):
        score = max(48, score - 8)
    return max(1, min(99, round(score)))


def paper_score(paper: dict) -> int:
    summary_depth = min(1, len(str(paper.get("summary") or "")) / 900)
    author_depth = min(1, len(paper.get("authors") or []) / 5)
    score = 36 + _recency(paper.get("published_at"), 540) * 42 + summary_depth * 15 + author_depth * 7
    if paper.get("starter_snapshot"):
        score = max(51, score - 6)
    return max(1, min(99, round(score)))


def _repository_view(repository: dict) -> dict:
    score = repository_score(repository)
    return {
        **repository,
        "momentum_score": score,
        "stage": _stage(score),
        "maturity": "Established" if score >= 78 else "Growing" if score >= 58 else "Emerging",
    }


def _paper_view(paper: dict) -> dict:
    score = paper_score(paper)
    return {
        **paper,
        "momentum_score": score,
        "stage": _stage(score),
        "practicality": "Near-term" if score >= 78 else "Developing" if score >= 58 else "Exploratory",
    }


class VentureIntelligenceService:
    def __init__(self, source_service) -> None:
        self.source = source_service
        self.watchlist_store = JsonStore(
            VENTURE_LENS_RUNTIME_DIR / "watchlists.json", dict
        )
        self.notification_store = JsonStore(
            VENTURE_LENS_RUNTIME_DIR / "notification_state.json", dict
        )

    def _source_data(self) -> tuple[list[dict], list[dict]]:
        return (
            list(self.source.github().get("items") or []),
            list(self.source.research().get("items") or []),
        )

    @staticmethod
    def _category_definitions() -> list[dict]:
        return [
            {
                "id": item["id"],
                "label": item["label"],
                "description": item["description"],
                "accent": item.get("accent", "emerald"),
            }
            for item in GITHUB_CATEGORIES
        ]

    def radar(self) -> list[dict]:
        repositories, papers = self._source_data()
        result = []
        for category in self._category_definitions():
            repos = [item for item in repositories if item.get("category") == category["id"]]
            related_papers = [
                item for item in papers
                if PAPER_TO_TECH.get(str(item.get("category"))) == category["id"]
            ]
            repo_scores = [repository_score(item) for item in repos]
            paper_scores = [paper_score(item) for item in related_papers]
            evidence = [*repo_scores, *paper_scores]
            score = round(sum(evidence) / len(evidence)) if evidence else 38
            score = min(97, score + min(9, len(evidence)))
            result.append({
                **category,
                "score": score,
                "stage": _stage(score),
                "trend": "Accelerating" if score >= 75 else "Building" if score >= 58 else "Emerging",
                "repository_count": len(repos),
                "paper_count": len(related_papers),
                "evidence_count": len(evidence),
            })
        return sorted(result, key=lambda item: item["score"], reverse=True)

    def technology_dossier(self, category_id: str) -> dict | None:
        category = next(
            (item for item in self.radar() if item["id"] == category_id), None
        )
        if not category:
            return None
        repositories, papers = self._source_data()
        related_repositories = sorted(
            (_repository_view(item) for item in repositories if item.get("category") == category_id),
            key=lambda item: item["momentum_score"], reverse=True,
        )
        related_papers = sorted(
            (_paper_view(item) for item in papers if PAPER_TO_TECH.get(str(item.get("category"))) == category_id),
            key=lambda item: item["momentum_score"], reverse=True,
        )
        risks = []
        if len(related_repositories) < 3:
            risks.append("The open-source evidence base is still concentrated in a small number of projects.")
        if len(related_papers) < 2:
            risks.append("Research coverage is limited, so maturity should be validated independently.")
        if not risks:
            risks = [
                "Fast-moving interfaces may create integration churn.",
                "Popularity does not guarantee enterprise support or security readiness.",
            ]
        leader = related_repositories[0]["full_name"] if related_repositories else "the leading implementations"
        return {
            **category,
            "kind": "technology",
            "summary": f"{category['label']} is currently classified as {category['stage'].lower()} with {category['evidence_count']} public signals across implementation and research.",
            "why_now": f"Momentum is being led by {leader}, supported by {len(related_papers)} relevant research signals.",
            "recommendation": f"{category['stage']} through a bounded internal proof of concept; validate maintainability, licensing and measurable workflow impact before wider adoption.",
            "risks": risks,
            "repositories": related_repositories[:6],
            "papers": related_papers[:6],
        }

    def repository_dossier(self, repository_id: str) -> dict | None:
        repositories, papers = self._source_data()
        repository = next((item for item in repositories if str(item.get("id")) == repository_id), None)
        if not repository:
            return None
        view = _repository_view(repository)
        related = [
            _paper_view(item) for item in papers
            if PAPER_TO_TECH.get(str(item.get("category"))) == repository.get("category")
        ]
        return {
            **view,
            "kind": "repository",
            "summary": _bounded(repository.get("description"), 420),
            "assessment": f"{view['full_name']} is a {view['maturity'].lower()} project with a momentum score of {view['momentum_score']}/100. Its current evidence supports a {_stage(view['momentum_score']).lower()} posture.",
            "strengths": [
                f"{int(repository.get('stars') or 0):,} public stars indicate developer awareness.",
                f"{int(repository.get('forks') or 0):,} forks show downstream experimentation.",
                f"Recent activity signal: {str(repository.get('updated_at') or 'not available')[:10]}.",
            ],
            "risks": [
                f"{int(repository.get('open_issues') or 0):,} open issues require review before production use.",
                "License, security posture and maintainer responsiveness require direct validation.",
            ],
            "metrics": {
                "momentum": view["momentum_score"],
                "community": min(99, round(math.log10(int(repository.get("forks") or 0) + 1) * 24)),
                "freshness": round(_recency(repository.get("updated_at")) * 100),
                "readiness": max(35, view["momentum_score"] - 8),
            },
            "related_papers": sorted(related, key=lambda item: item["momentum_score"], reverse=True)[:5],
        }

    def paper_dossier(self, paper_id: str) -> dict | None:
        repositories, papers = self._source_data()
        paper = next((item for item in papers if str(item.get("id")) == paper_id), None)
        if not paper:
            return None
        view = _paper_view(paper)
        technology_id = PAPER_TO_TECH.get(str(paper.get("category")), "machine-learning")
        related = [
            _repository_view(item) for item in repositories
            if item.get("category") == technology_id
        ]
        summary = _bounded(paper.get("summary"), 1100)
        first_sentence = summary.split(". ", 1)[0].rstrip(".") + "."
        return {
            **view,
            "kind": "paper",
            "executive_summary": first_sentence,
            "contribution": summary,
            "practical_relevance": f"This work maps to {technology_id.replace('-', ' ')} and is classified as {view['practicality'].lower()} based on recency and available implementation evidence.",
            "limitations": [
                "Claims should be checked against the paper's evaluation methodology and baselines.",
                "Operational cost, reproducibility and production constraints may not be fully represented in the abstract.",
            ],
            "metrics": {
                "momentum": view["momentum_score"],
                "recency": round(_recency(paper.get("published_at"), 540) * 100),
                "evidence_depth": min(99, round(len(summary) / 11)),
                "implementation_signal": min(99, 35 + len(related) * 9),
            },
            "related_repositories": sorted(related, key=lambda item: item["momentum_score"], reverse=True)[:5],
        }

    def graph(self) -> dict:
        repositories, papers = self._source_data()
        nodes: list[dict] = []
        edges: list[dict] = []
        for category in self.radar():
            technology_node = f"tech:{category['id']}"
            nodes.append({"id": technology_node, "kind": "technology", "label": category["label"], "score": category["score"], "category": category["id"]})
            top_repositories = sorted(
                (item for item in repositories if item.get("category") == category["id"]),
                key=repository_score, reverse=True,
            )[:3]
            top_papers = sorted(
                (item for item in papers if PAPER_TO_TECH.get(str(item.get("category"))) == category["id"]),
                key=paper_score, reverse=True,
            )[:3]
            for repository in top_repositories:
                node_id = f"repo:{repository['id']}"
                nodes.append({"id": node_id, "kind": "repository", "label": repository.get("name"), "score": repository_score(repository), "category": category["id"], "entity_id": repository["id"]})
                edges.append({"source": technology_node, "target": node_id, "relation": "implemented by"})
            for paper in top_papers:
                node_id = f"paper:{paper['id']}"
                nodes.append({"id": node_id, "kind": "paper", "label": _bounded(paper.get("title"), 90), "score": paper_score(paper), "category": category["id"], "entity_id": paper["id"]})
                edges.append({"source": technology_node, "target": node_id, "relation": "advanced by"})
        return {"nodes": nodes, "edges": edges}

    def briefs(self) -> list[dict]:
        radar = self.radar()
        repositories, papers = self._source_data()
        top_repo = max(repositories, key=repository_score, default={})
        top_paper = max(papers, key=paper_score, default={})
        leader = radar[0] if radar else {"label": "AI infrastructure", "score": 0, "stage": "Watch", "evidence_count": 0}
        convergence = max(radar, key=lambda item: min(item["repository_count"], item["paper_count"]), default=leader)
        generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
        return [
            {
                "id": "momentum-leader",
                "title": f"{leader['label']} leads the current opportunity radar",
                "summary": f"The category scores {leader['score']}/100 across {leader['evidence_count']} implementation and research signals and currently sits in the {leader['stage']} zone.",
                "type": "Market signal",
                "generated_at": generated,
                "actions": ["Open the technology dossier", "Review the top implementation", "Validate enterprise readiness"],
                "technology_id": leader.get("id"),
            },
            {
                "id": "repository-leader",
                "title": f"{top_repo.get('full_name', 'A leading repository')} is the strongest implementation signal",
                "summary": f"Its derived momentum score is {repository_score(top_repo) if top_repo else 0}/100, combining community scale, recent activity and repository health.",
                "type": "Open-source signal",
                "generated_at": generated,
                "repository_id": top_repo.get("id"),
                "actions": ["Inspect repository dossier", "Check licensing and security", "Consider a bounded proof of concept"],
            },
            {
                "id": "research-frontier",
                "title": _bounded(top_paper.get("title") or "Research momentum is building", 130),
                "summary": f"This paper has the strongest current research signal at {paper_score(top_paper) if top_paper else 0}/100 based on recency, evidence depth and nearby implementation activity.",
                "type": "Research signal",
                "generated_at": generated,
                "paper_id": top_paper.get("id"),
                "actions": ["Read the paper dossier", "Review related code", "Assess practical reproducibility"],
            },
            {
                "id": "research-code-convergence",
                "title": f"Research and code are converging around {convergence['label']}",
                "summary": f"The lens currently tracks {convergence['repository_count']} repositories and {convergence['paper_count']} papers in this category, making it a useful candidate for cross-functional evaluation.",
                "type": "Convergence signal",
                "generated_at": generated,
                "technology_id": convergence.get("id"),
                "actions": ["Compare leading projects", "Map research to implementations", "Add the category to a watchlist"],
            },
        ]

    def compare(self, references: Iterable[dict]) -> dict:
        requested = list(references)[:4]
        kinds = {str(reference.get("kind") or "") for reference in requested}
        if len(kinds) != 1 or not kinds.issubset({"technology", "repository", "paper"}):
            raise ValueError("Comparison requires signals of the same type.")
        unique_keys = {
            (str(reference.get("kind") or ""), str(reference.get("id") or ""))
            for reference in requested
        }
        if len(unique_keys) < 2:
            raise ValueError("Select at least two different signals to compare.")

        kind = next(iter(kinds))
        entities = []
        for reference in requested:
            entity_id = str(reference.get("id") or "")
            dossier = self.repository_dossier(entity_id) if kind == "repository" else self.paper_dossier(entity_id) if kind == "paper" else self.technology_dossier(entity_id)
            if dossier:
                entities.append(dossier)
        if len(entities) < 2:
            raise ValueError("At least two selected signals could not be resolved.")

        metric_definitions = {
            "repository": [
                {"id": "stars", "label": "GitHub stars", "format": "number", "higher_is_better": True},
                {"id": "forks", "label": "Forks", "format": "number", "higher_is_better": True},
                {"id": "open_issues", "label": "Open issues", "format": "number", "higher_is_better": False},
                {"id": "freshness", "label": "Activity freshness", "format": "score", "higher_is_better": True},
                {"id": "readiness", "label": "Production readiness", "format": "score", "higher_is_better": True},
            ],
            "paper": [
                {"id": "published_at", "label": "Published", "format": "date", "higher_is_better": True},
                {"id": "author_count", "label": "Authors", "format": "number", "higher_is_better": False},
                {"id": "recency", "label": "Research recency", "format": "score", "higher_is_better": True},
                {"id": "evidence_depth", "label": "Abstract evidence depth", "format": "score", "higher_is_better": True},
                {"id": "implementation_signal", "label": "Related implementation", "format": "score", "higher_is_better": True},
            ],
            "technology": [
                {"id": "score", "label": "Momentum", "format": "score", "higher_is_better": True},
                {"id": "repository_count", "label": "Repositories", "format": "number", "higher_is_better": True},
                {"id": "paper_count", "label": "Research papers", "format": "number", "higher_is_better": True},
                {"id": "evidence_count", "label": "Total evidence", "format": "number", "higher_is_better": True},
            ],
        }
        for item in entities:
            if kind == "paper":
                item.setdefault("metrics", {})["author_count"] = len(item.get("authors") or [])
            if kind == "repository":
                item.setdefault("metrics", {}).update({
                    "stars": item.get("stars"),
                    "forks": item.get("forks"),
                    "open_issues": item.get("open_issues"),
                })
        return {
            "kind": kind,
            "items": entities,
            "count": len(entities),
            "metrics": metric_definitions[kind],
        }

    def watchlist(self, viewer_key: str) -> list[dict]:
        payload = self.watchlist_store.read()
        return list(payload.get(viewer_key) or [])

    def toggle_watchlist(self, viewer_key: str, reference: dict) -> dict:
        kind = str(reference.get("kind") or "").strip()
        entity_id = str(reference.get("id") or "").strip()
        if kind not in {"technology", "repository", "paper"} or not entity_id:
            raise ValueError("A valid technology, repository, or paper reference is required.")
        key = f"{kind}:{entity_id}"
        changed = {"saved": False}

        def update(payload: dict) -> dict:
            items = list(payload.get(viewer_key) or [])
            existing = next((item for item in items if item.get("key") == key), None)
            if existing:
                items = [item for item in items if item.get("key") != key]
                changed["saved"] = False
            else:
                items.append({
                    "key": key,
                    "kind": kind,
                    "id": entity_id,
                    "label": _bounded(reference.get("label") or entity_id, 180),
                    "saved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                })
                changed["saved"] = True
            payload[viewer_key] = items[-100:]
            return payload

        payload = self.watchlist_store.update(update)
        return {"saved": changed["saved"], "items": payload.get(viewer_key, [])}

    def notifications(self, viewer_key: str) -> list[dict]:
        watched = self.watchlist(viewer_key)
        read_state = self.notification_store.read().get(viewer_key, {})
        result = []
        for item in reversed(watched[-12:]):
            notification_id = hashlib.sha1(f"{item['key']}:{item['saved_at']}".encode()).hexdigest()[:16]
            result.append({
                "id": notification_id,
                "title": f"{item['label']} is now on your watchlist",
                "message": "Venture Lens will surface this signal in your personal monitoring view.",
                "kind": item["kind"],
                "entity_id": item["id"],
                "created_at": item["saved_at"],
                "read": bool(read_state.get(notification_id)),
            })
        return result

    def mark_notifications_read(self, viewer_key: str) -> list[dict]:
        notifications = self.notifications(viewer_key)

        def update(payload: dict) -> dict:
            state = payload.setdefault(viewer_key, {})
            for item in notifications:
                state[item["id"]] = True
            return payload

        self.notification_store.update(update)
        return [{**item, "read": True} for item in notifications]

    def overview(self, viewer_key: str) -> dict:
        return {
            "radar": self.radar(),
            "graph": self.graph(),
            "briefs": self.briefs(),
            "watchlist": self.watchlist(viewer_key),
            "notifications": self.notifications(viewer_key),
        }
