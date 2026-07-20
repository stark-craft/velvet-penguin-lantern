from __future__ import annotations

import json
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional


class CrawlRunError(RuntimeError):
    """Raised when the isolated Scrapy process cannot complete a crawl."""


@dataclass(frozen=True)
class CrawlResult:
    run_id: str
    profile: str
    articles: List[Dict[str, Any]]
    output_file: Path
    command: List[str] = field(repr=False)
    stdout_tail: str = ""
    stderr_tail: str = ""
    stats: Dict[str, int] = field(default_factory=dict)
    source_health: Dict[str, Any] = field(default_factory=dict)


def _profile_value(profile: Any, key: str, default: Any = None) -> Any:
    if isinstance(profile, Mapping):
        return profile.get(key, default)
    return getattr(profile, key, default)


def _bounded_tail(value: str, length: int = 4000) -> str:
    value = str(value or "")
    return value[-length:]


class ScrapyRunner:
    """Runs Scrapy out-of-process so Twisted never owns the FastAPI event loop."""

    def __init__(self, settings: Any) -> None:
        self.settings = settings
        self.backend_root = Path(__file__).resolve().parents[2]
        self.sites_dir = Path(getattr(settings, "sites_dir", self.backend_root / "sites"))
        self.output_dir = Path(
            getattr(settings, "crawl_output_dir", self.backend_root / "runtime" / "crawls")
        )
        self.timeout_seconds = int(getattr(settings, "crawler_timeout_seconds", 1800))
        self.keep_artifacts = bool(getattr(settings, "keep_crawl_artifacts", False))
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def run(
        self,
        profile: Any,
        from_date: date,
        to_date: date,
        target_sites: Optional[Iterable[str]] = None,
        keywords: Optional[Iterable[str]] = None,
        run_id: Optional[str] = None,
        discovery_only: bool = False,
    ) -> CrawlResult:
        if from_date > to_date:
            raise ValueError("from_date cannot be after to_date")

        profile_value = _profile_value(profile, "id", "default")
        profile_id = str(getattr(profile_value, "value", profile_value))
        sources_file = str(_profile_value(profile, "sources_file", f"{profile_id}.json"))
        active_keywords = list(
            keywords if keywords is not None else (_profile_value(profile, "keywords", []) or [])
        )
        run_id = run_id or f"crawl_{uuid.uuid4().hex}"

        sites_file = (self.sites_dir / sources_file).resolve()
        sites_root = self.sites_dir.resolve()
        if sites_root not in sites_file.parents:
            raise ValueError("Profile sources_file must stay inside the configured sites directory")
        if not sites_file.is_file():
            raise FileNotFoundError(f"Sources file does not exist: {sites_file}")

        output_file = (self.output_dir / f"{run_id}.json").resolve()
        stats_file = (self.output_dir / f"{run_id}.stats.json").resolve()
        for artifact in (output_file, stats_file):
            try:
                artifact.unlink()
            except FileNotFoundError:
                pass
        command = [
            sys.executable,
            "-m",
            "scrapy",
            "crawl",
            "news_spider",
            "-a",
            f"profile={profile_id}",
            "-a",
            f"run_id={run_id}",
            "-a",
            f"keyword={','.join(str(item) for item in active_keywords)}",
            "-a",
            f"from_date={from_date.isoformat()}",
            "-a",
            f"to_date={to_date.isoformat()}",
            "-a",
            f"target_sites={','.join(target_sites or []) or 'All'}",
            "-a",
            f"sites_file={sites_file}",
            "-a",
            f"discovery_only={'true' if discovery_only else 'false'}",
            "-a",
            f"timezone_name={getattr(self.settings, 'timezone_name', 'Asia/Kolkata')}",
            "-a",
            f"stats_file={stats_file}",
            "-s",
            f"LOG_LEVEL={getattr(self.settings, 'scrapy_log_level', 'INFO')}",
            "-O",
            str(output_file),
        ]

        try:
            completed = subprocess.run(
                command,
                cwd=str(self.backend_root),
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise CrawlRunError(
                f"Crawl {run_id} exceeded the {self.timeout_seconds}-second timeout"
            ) from exc
        except OSError as exc:
            raise CrawlRunError(f"Could not start Scrapy for crawl {run_id}: {exc}") from exc

        stdout_tail = _bounded_tail(completed.stdout)
        stderr_tail = _bounded_tail(completed.stderr)
        if completed.returncode != 0:
            raise CrawlRunError(
                f"Scrapy crawl {run_id} failed with exit code {completed.returncode}. "
                f"Log tail: {stderr_tail or stdout_tail}"
            )
        if not output_file.is_file():
            raise CrawlRunError(f"Scrapy crawl {run_id} completed without an output artifact")
        if not stats_file.is_file():
            raise CrawlRunError(
                f"Scrapy crawl {run_id} completed without its source-health artifact"
            )

        try:
            payload = json.loads(output_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CrawlRunError(f"Crawl {run_id} produced invalid JSON: {exc}") from exc
        if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
            raise CrawlRunError(f"Crawl {run_id} output must be a list of article objects")

        try:
            crawl_report = json.loads(stats_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CrawlRunError(
                f"Crawl {run_id} produced invalid source-health JSON: {exc}"
            ) from exc
        if not isinstance(crawl_report, dict):
            raise CrawlRunError(f"Crawl {run_id} source-health output must be an object")
        stats = crawl_report.get("stats") or {}
        source_health = crawl_report.get("source_health") or {}
        if not isinstance(stats, dict) or not isinstance(source_health, dict):
            raise CrawlRunError(f"Crawl {run_id} source-health fields must be objects")
        if source_health.get("no_sources_attempted"):
            if not self.keep_artifacts:
                for artifact in (output_file, stats_file):
                    try:
                        artifact.unlink()
                    except OSError:
                        pass
            raise CrawlRunError(
                f"Crawl {run_id} had no enabled source entrypoints to attempt"
            )
        if source_health.get("all_sources_failed"):
            failed = int(source_health.get("failed") or 0)
            attempted = int(source_health.get("attempted") or 0)
            if not self.keep_artifacts:
                for artifact in (output_file, stats_file):
                    try:
                        artifact.unlink()
                    except OSError:
                        pass
            raise CrawlRunError(
                f"Crawl {run_id} could not reach any configured source "
                f"({failed}/{attempted} source attempts failed)"
            )

        result = CrawlResult(
            run_id=run_id,
            profile=profile_id,
            articles=payload,
            output_file=output_file,
            command=command,
            stdout_tail=stdout_tail,
            stderr_tail=stderr_tail,
            stats={str(key): int(value) for key, value in stats.items()},
            source_health=dict(source_health),
        )
        if not self.keep_artifacts:
            for artifact in (output_file, stats_file):
                try:
                    artifact.unlink()
                except OSError:
                    pass
        return result
