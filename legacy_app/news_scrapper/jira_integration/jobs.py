"""Per-article Jira draft/publish jobs and persistent duplicate protection.

Jobs are process-local; 429 delays are handled in the background while the UI
polls. Successful Jira issue mappings survive process restarts in SQLite.
Use one FastAPI worker for the shared CDP Chrome session.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from . import generation, service

_WORKER = ThreadPoolExecutor(max_workers=1, thread_name_prefix="techscout-jira")
_LOCK = threading.RLock()
_JOBS: dict[str, dict] = {}
_MAX_JOBS = 100


def _db_path() -> Path:
    return Path(os.getenv("JIRA_NEWS_DB_PATH") or "data/jira_news_issues.sqlite3").resolve()


def _connection():
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(path), timeout=15)
    db.execute(
        "CREATE TABLE IF NOT EXISTS jira_news_issues ("
        "identity TEXT PRIMARY KEY, issue_key TEXT NOT NULL, "
        "url TEXT NOT NULL, saved_at REAL NOT NULL)"
    )
    db.commit()
    return db


def identity(article):
    url = str(article.get("source_url") or "").strip()
    try:
        split = urlsplit(url)
        if split.scheme in ("http", "https") and split.hostname:
            url = urlunsplit((split.scheme.lower(), split.netloc.lower(), split.path.rstrip("/"), "", ""))
        else:
            url = ""
    except ValueError:
        url = ""
    key = url or json.dumps([
        str(article.get("title") or "").strip().casefold(),
        str(article.get("source") or "").strip().casefold(),
        str(article.get("date") or "").strip(),
    ], ensure_ascii=False)
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _previous(article):
    with _connection() as db:
        row = db.execute(
            "SELECT issue_key,url FROM jira_news_issues WHERE identity=?",
            (identity(article),),
        ).fetchone()
    return {"key": row[0], "url": row[1]} if row else None


def _remember(article, created):
    with _connection() as db:
        db.execute(
            "INSERT OR IGNORE INTO jira_news_issues(identity,issue_key,url,saved_at) "
            "VALUES (?,?,?,?)",
            (identity(article), created["key"], created["url"], time.time()),
        )
        db.commit()


def _update(job_id, **fields):
    with _LOCK:
        if job_id in _JOBS:
            _JOBS[job_id].update(fields)
            _JOBS[job_id]["updated_at"] = time.time()


def _mutate(job_id, operation):
    with _LOCK:
        operation(_JOBS[job_id])
        _JOBS[job_id]["updated_at"] = time.time()


def get_job(job_id, owner):
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is None or job["owner"] != owner:
            return None
        return {key: copy.deepcopy(value) for key, value in job.items() if key not in ("owner", "articles")}


def _new_job(owner, kind, articles, parent=None):
    if not 1 <= len(articles) <= 30:
        raise ValueError("Select 1 to 30 articles.")
    with _LOCK:
        active = sum(j["state"] in ("queued", "running", "paused") for j in _JOBS.values())
        if active >= 4:
            raise ValueError("Jira report queue is busy. Retry after the existing jobs complete.")
        # Only discard completed jobs. Never evict in-flight work.
        if len(_JOBS) > _MAX_JOBS:
            oldest = sorted((j for j in _JOBS.values() if j["state"] not in ("queued", "running", "paused")), key=lambda j: j["created_at"])
            for job in oldest[:len(_JOBS) - _MAX_JOBS]:
                _JOBS.pop(job["id"], None)
        identifier = str(uuid.uuid4())
        _JOBS[identifier] = {
            "id": identifier,
            "owner": owner,
            "kind": kind,
            "parent": parent,
            "state": "queued",
            "total": len(articles),
            "completed": 0,
            "entries": [],
            "current": "",
            "retry_at": None,
            "created_at": time.time(),
            "updated_at": time.time(),
            "articles": copy.deepcopy(articles),
        }
    return identifier


def begin_drafts(owner, articles):
    identifier = _new_job(owner, "draft", articles)
    _WORKER.submit(_run_drafts, identifier)
    return identifier


def _run_drafts(identifier):
    _update(identifier, state="running")
    with _LOCK:
        articles = copy.deepcopy(_JOBS[identifier]["articles"])
    for index, article in enumerate(articles):
        _update(identifier, current=f"Generating report {index + 1} of {len(articles)}", state="running", retry_at=None)
        def pause(operation, seconds, attempt):
            _update(
                identifier,
                state="paused",
                current=f"{operation} rate-limited; retry {attempt} scheduled automatically",
                retry_at=time.time() + seconds,
            )
        try:
            draft = generation.generate_draft(article, on_pause=pause)
            entry = {"index": index, "status": "ready", "draft": draft}
        except Exception as error:
            entry = {"index": index, "status": "failed", "error": str(error) if isinstance(error, generation.GenerationError) else "AI generation failed; retry this article."}
        _mutate(identifier, lambda job: (
            job["entries"].append(entry),
            job.update(completed=index + 1, retry_at=None, state="running")
        ))
    _update(identifier, state="done", current="", retry_at=None)


def begin_publish(owner, draft_job_id, selected):
    with _LOCK:
        parent = _JOBS.get(draft_job_id)
        if parent is None or parent["owner"] != owner or parent["kind"] != "draft" or parent["state"] != "done":
            raise ValueError("Complete your authorized report drafts before publishing.")
        ready = {entry["index"]: entry["draft"] for entry in parent["entries"] if entry["status"] == "ready"}
        articles = []
        for item in selected:
            if not isinstance(item, dict):
                raise ValueError("Invalid report edit.")
            index = item.get("index")
            if not isinstance(index, int) or index not in ready or not 0 <= index < len(parent["articles"]):
                raise ValueError("A selected report is missing or not ready.")
            base = dict(ready[index])
            for key in ("title", "category", "insight", "image_caption"):
                if key in item:
                    base[key] = str(item[key] or "").strip()
            if "key_facts" in item:
                base["key_facts"] = item["key_facts"]
            facts = base.get("key_facts")
            if (not isinstance(facts, list) or len(facts) != 3 or
                any(not isinstance(point, str) or not 12 <= len(point.strip()) <= 1200 for point in facts)):
                raise ValueError("Each report must contain exactly three factual Key Facts.")
            if not 1 <= len(base.get("title", "")) <= 500 or not 1 <= len(base.get("category", "")) <= 300 or not 35 <= len(base.get("insight", "")) <= 2400:
                raise ValueError("Report title, category or Our Insights is incomplete.")
            if len(base.get("image_caption", "")) > 350:
                raise ValueError("Image caption exceeds 350 characters.")
            articles.append(base)
        if not articles:
            raise ValueError("Select at least one finished draft to publish.")
        if len({identity(a) for a in articles}) != len(articles):
            raise ValueError("Duplicate articles in the requested publication batch.")
    identifier = _new_job(owner, "publish", articles, parent=draft_job_id)
    _WORKER.submit(_run_publish, identifier)
    return identifier


def _run_publish(identifier):
    _update(identifier, state="running")
    with _LOCK:
        articles = copy.deepcopy(_JOBS[identifier]["articles"])
    for index, article in enumerate(articles):
        _update(identifier, current=f"Publishing Jira issue {index + 1} of {len(articles)}")
        try:
            known = _previous(article)
            if known:
                entry = {"index": index, "status": "existing", **known}
            else:
                # Jira creates are deliberately NEVER auto-retried: the first
                # request might have succeeded despite a failed HTTP reply.
                result = service.create_news_ticket([article],
                    os.getenv("JIRA_NEWS_PROJECT", "").strip().upper(),
                    os.getenv("JIRA_NEWS_ISSUE_TYPE", "Task").strip() or "Task")
                _remember(article, result)
                entry = {"index": index, "status": "created", **result}
        except Exception:
            entry = {
                "index": index,
                "status": "failed",
                "error": "Jira did not confirm creation. Check Jira before attempting this article again.",
            }
        _mutate(identifier, lambda job: (
            job["entries"].append(entry),
            job.update(completed=index + 1)
        ))
    _update(identifier, state="done", current="")


def begin_insight_regeneration(owner, draft_job_id, index):
    """Regenerate an insight without modifying the already extracted Key Facts."""
    with _LOCK:
        parent = _JOBS.get(draft_job_id)
        if parent is None or parent["owner"] != owner or parent["kind"] != "draft" or parent["state"] != "done":
            raise ValueError("Complete your own draft job before regenerating its insight.")
        matched = [entry for entry in parent["entries"] if entry["index"] == index and entry["status"] == "ready"]
        if not matched:
            raise ValueError("Selected draft was not successfully prepared.")
        draft = copy.deepcopy(matched[0]["draft"])
    identifier = _new_job(owner, "insight", [draft], parent=draft_job_id)
    _WORKER.submit(_run_insight, identifier, index)
    return identifier


def _run_insight(identifier, original_index):
    _update(identifier, state="running", current="Regenerating Our Insights")
    with _LOCK:
        draft = copy.deepcopy(_JOBS[identifier]["articles"][0])
    def pause(operation, seconds, attempt):
        _update(
            identifier, state="paused",
            current=f"{operation} rate-limited; retry {attempt} scheduled automatically",
            retry_at=time.time() + seconds,
        )
    try:
        insight = generation.regenerate_insight(draft, on_pause=pause)
        entry = {"index": original_index, "status": "ready", "insight": insight}
    except Exception as error:
        entry = {
            "index": original_index, "status": "failed",
            "error": str(error) if isinstance(error, generation.GenerationError)
            else "Unable to regenerate insight.",
        }
    _mutate(identifier, lambda job: (
        job["entries"].append(entry),
        job.update(completed=1, state="done", current="", retry_at=None)
    ))
