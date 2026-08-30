"""Capability-based authorization for TechScout's privileged workspaces."""

from .service import (
    ALL_CAPABILITIES,
    effective_capabilities,
    has_capability,
    require_any_capability,
    require_capability,
)

__all__ = [
    "ALL_CAPABILITIES",
    "effective_capabilities",
    "has_capability",
    "require_any_capability",
    "require_capability",
]
