from __future__ import annotations

import ipaddress
from typing import Optional

from signalroom.config import Settings
from signalroom.models import Capability, ProfileId
from signalroom.security import Principal, RequestLike, get_client_ip


def _allowed_ip(ip: str, networks: tuple) -> bool:
    address = ipaddress.ip_address(ip)
    return any(address in ipaddress.ip_network(network, strict=False) for network in networks)


def resolve_profile(
    request: RequestLike,
    settings: Settings,
    principal: Principal,
    requested: Optional[str] = None,
) -> ProfileId:
    """Resolve the active desk without accepting an unauthorized profile override."""

    if requested:
        profile = ProfileId(str(requested).strip().casefold())
        if profile == ProfileId.BROADCAST and not (
            principal.can(Capability.BROADCAST)
            or principal.can(Capability.PROFILE_SWITCH)
        ):
            raise PermissionError("broadcast profile access is not enabled for this viewer")
        return profile

    client_ip = get_client_ip(request, settings)
    if _allowed_ip(client_ip, settings.broadcast_ips):
        return ProfileId.BROADCAST
    return ProfileId.DEFAULT


def actor_id(principal: Principal) -> str:
    if principal.identity:
        return principal.identity
    return "anonymous:" + principal.ip_hash.rsplit(":", 1)[-1][:20]
