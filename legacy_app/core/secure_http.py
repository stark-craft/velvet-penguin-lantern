"""Shared secure HTTP configuration for internal and public services."""

from __future__ import annotations

import os
import platform
from pathlib import Path


FALSE_VALUES = {"0", "false", "no", "off"}


if (
    platform.system() == "Windows"
    and os.environ.get("NEWSSCRAPPER_USE_SYSTEM_CA", "true").strip().lower()
    not in FALSE_VALUES
):
    try:
        import truststore

        truststore.inject_into_ssl()
        print("[TLS] Windows system certificate store enabled.", flush=True)
    except ImportError:
        print(
            "[TLS] truststore is not installed; Requests will use its bundled "
            "CA store. Install requirements.txt or configure REQUESTS_CA_BUNDLE.",
            flush=True,
        )


def tls_verify(feature_prefix: str = "") -> bool | str:
    """Return True or an explicit CA bundle path; never disable verification.

    Requests already understands REQUESTS_CA_BUNDLE.  Feature-specific
    ``*_CA_BUNDLE`` settings are supported for installations where the Samsung
    internal CA differs from the public crawler trust store.
    """

    prefix = feature_prefix.strip().upper()
    verify_name = f"{prefix}_VERIFY_SSL" if prefix else "VERIFY_SSL"
    configured = os.environ.get(verify_name, "true").strip().lower()
    if configured in FALSE_VALUES:
        print(
            f"[TLS] {verify_name}=false was ignored. Certificate verification "
            "remains enabled; configure a CA bundle instead.",
            flush=True,
        )

    candidates = []
    if prefix:
        candidates.append(os.environ.get(f"{prefix}_CA_BUNDLE", ""))
    candidates.extend(
        [
            os.environ.get("REQUESTS_CA_BUNDLE", ""),
            os.environ.get("SSL_CERT_FILE", ""),
        ]
    )
    for candidate in candidates:
        candidate = candidate.strip()
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if not path.is_file():
            raise RuntimeError(f"Configured CA bundle does not exist: {path}")
        return str(path)
    return True
