"""Non-destructive migration markers for legacy IP-keyed recommendation state."""

from __future__ import annotations

import datetime as dt
from typing import Any


def legacy_migration_offer(viewer_state: dict[str, Any], legacy_profile: dict[str, Any]) -> dict[str, Any]:
    migration = viewer_state.get("migration") if isinstance(viewer_state.get("migration"), dict) else {}
    display_name = str(legacy_profile.get("display_name") or "").strip()
    return {
        "available": bool(display_name and not migration.get("confirmed_at")),
        "display_name": display_name,
        "message": f"Continue as {display_name}?" if display_name else "",
    }


def mark_migrated(state: dict[str, Any], legacy_key: str) -> dict[str, Any]:
    output = dict(state)
    output["migration"] = {
        "migrated_from_legacy_key": str(legacy_key),
        "confirmed_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "legacy_source_preserved": True,
    }
    return output
