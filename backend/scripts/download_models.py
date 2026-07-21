"""Securely download or offline-verify newsScrapper's pinned model repositories.

Normal application startup never calls this script and never downloads weights.
TLS verification is always enabled. Corporate HTTPS inspection requires the
organization's approved root certificate, never a verification bypass.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import ssl
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple


MODEL_SPECS = {
    "embedding": {
        "repo_id": "sentence-transformers/all-MiniLM-L6-v2",
        "revision": "1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
        "directory": "all-MiniLM-L6-v2",
        "allow_patterns": (
            "1_Pooling/config.json",
            "config.json",
            "config_sentence_transformers.json",
            "model.safetensors",
            "modules.json",
            "sentence_bert_config.json",
            "special_tokens_map.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "vocab.txt",
        ),
        "weight_file": "model.safetensors",
        "weight_sha256": "53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db",
    },
    "summarization": {
        "repo_id": "sshleifer/distilbart-cnn-12-6",
        "revision": "eb8b5a5eb7de268c0d7db6fa247188c909acf265",
        "directory": "distilbart-cnn-12-6",
        "allow_patterns": (
            "config.json",
            "merges.txt",
            "model.safetensors",
            "tokenizer_config.json",
            "vocab.json",
        ),
        "weight_file": "model.safetensors",
        "weight_sha256": "bb2e2ae9c5e339a6e86adac3c946bb853db50d7c588477ddd1622dd2d1fc567c",
    },
}

CERTIFICATE_ENVIRONMENT_VARIABLES = (
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
)


class ModelChecksumError(RuntimeError):
    """A downloaded or copied weight file does not match the pinned artifact."""


def _selected_models(only: str) -> Iterable[Tuple[str, Dict[str, Any]]]:
    if only == "all":
        return MODEL_SPECS.items()
    return ((only, MODEL_SPECS[only]),)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_obj:
        for chunk in iter(lambda: file_obj.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _looks_like_html(path: Path) -> bool:
    try:
        prefix = path.read_bytes()[:1024].lstrip().lower()
    except OSError:
        return False
    return prefix.startswith(b"<!doctype html") or prefix.startswith(b"<html") or (
        b"<html" in prefix and b"</html" in prefix
    )


def _validate_ca_bundle(path: Path) -> Path:
    candidate = path.expanduser().resolve()
    if not candidate.is_file():
        raise ValueError(f"CA bundle does not exist or is not a file: {candidate}")
    try:
        content = candidate.read_bytes()
    except OSError as exc:
        raise ValueError(f"CA bundle is not readable: {candidate}: {exc}") from exc
    if b"-----BEGIN CERTIFICATE-----" not in content:
        raise ValueError(f"CA bundle does not contain a PEM certificate: {candidate}")
    try:
        ssl.create_default_context(cafile=str(candidate))
    except (OSError, ssl.SSLError) as exc:
        raise ValueError(f"CA bundle cannot be loaded as PEM certificates: {candidate}") from exc
    return candidate


def resolve_trust_source(
    explicit_bundle: Optional[Path], *, use_system_ca: bool
) -> Dict[str, Optional[str]]:
    if explicit_bundle is not None and use_system_ca:
        raise ValueError("--ca-bundle and --use-system-ca cannot be used together")
    if explicit_bundle is not None:
        path = _validate_ca_bundle(explicit_bundle)
        return {"kind": "explicit_pem_bundle", "path": str(path), "variable": None}
    for variable in CERTIFICATE_ENVIRONMENT_VARIABLES:
        value = os.environ.get(variable)
        if value:
            path = _validate_ca_bundle(Path(value))
            return {
                "kind": "environment_pem_bundle",
                "path": str(path),
                "variable": variable,
            }
    if use_system_ca:
        return {"kind": "operating_system_trust_store", "path": None, "variable": None}
    return {"kind": "library_default_trust_store", "path": None, "variable": None}


def configure_huggingface_tls(trust_source: Dict[str, Optional[str]]) -> str:
    """Configure either Hugging Face Hub's httpx or requests client factory."""

    kind = str(trust_source["kind"])
    path = trust_source.get("path")
    if kind == "library_default_trust_store":
        return "library_default"

    context = ssl.create_default_context(cafile=path if path else None)
    import huggingface_hub

    set_client_factory = getattr(huggingface_hub, "set_client_factory", None)
    if callable(set_client_factory):
        try:
            import httpx
        except ImportError as exc:
            raise RuntimeError("Hugging Face Hub requires httpx for its HTTP client") from exc

        set_client_factory(lambda: httpx.Client(verify=context))
        set_async_client_factory = getattr(
            huggingface_hub, "set_async_client_factory", None
        )
        if callable(set_async_client_factory):
            set_async_client_factory(lambda: httpx.AsyncClient(verify=context))
        return "httpx_client_factory"

    configure_http_backend = getattr(huggingface_hub, "configure_http_backend", None)
    if not callable(configure_http_backend):
        raise RuntimeError(
            "Installed huggingface-hub exposes no supported HTTP client-factory API"
        )

    import requests
    from requests.adapters import HTTPAdapter

    class SSLContextAdapter(HTTPAdapter):
        def init_poolmanager(self, *args: Any, **kwargs: Any) -> None:
            kwargs["ssl_context"] = context
            super().init_poolmanager(*args, **kwargs)

        def proxy_manager_for(self, *args: Any, **kwargs: Any):
            kwargs["ssl_context"] = context
            return super().proxy_manager_for(*args, **kwargs)

    def backend_factory():
        session = requests.Session()
        session.mount("https://", SSLContextAdapter())
        return session

    configure_http_backend(backend_factory=backend_factory)
    return "requests_backend_factory"


def verify_models(*, target_root: Path, only: str = "all") -> Dict[str, object]:
    """Validate local folders, required files, HTML mistakes, and weight hashes."""

    root = target_root.expanduser().resolve()
    model_results: Dict[str, object] = {}
    verified = True
    for purpose, spec in _selected_models(only):
        destination = root / spec["directory"]
        errors = []
        files: Dict[str, object] = {}
        if not destination.is_dir():
            errors.append(f"missing model directory: {destination}")
        for relative_name in spec["allow_patterns"]:
            path = destination / relative_name
            state: Dict[str, object] = {"present": path.is_file()}
            if not path.is_file():
                errors.append(f"missing required file: {path}")
            else:
                try:
                    state["size_bytes"] = path.stat().st_size
                except OSError as exc:
                    errors.append(f"cannot inspect required file {path}: {exc}")
                if _looks_like_html(path):
                    state["suspicious_html"] = True
                    errors.append(f"HTML error page detected instead of model data: {path}")
            files[relative_name] = state

        weight_path = destination / spec["weight_file"]
        actual_sha256 = None
        if weight_path.is_file() and not _looks_like_html(weight_path):
            try:
                actual_sha256 = _sha256(weight_path)
            except OSError as exc:
                errors.append(f"cannot hash weight file {weight_path}: {exc}")
            else:
                if actual_sha256 != spec["weight_sha256"]:
                    errors.append(
                        f"weight checksum mismatch: expected {spec['weight_sha256']}, "
                        f"got {actual_sha256}"
                    )
        model_ok = not errors
        verified = verified and model_ok
        model_results[purpose] = {
            "verified": model_ok,
            "repo_id": spec["repo_id"],
            "revision": spec["revision"],
            "path": str(destination),
            "expected_weight_sha256": spec["weight_sha256"],
            "actual_weight_sha256": actual_sha256,
            "files": files,
            "errors": errors,
        }
    return {
        "verify_only": True,
        "network_requests_made": False,
        "verified": verified,
        "selection": only,
        "models": model_results,
    }


def download_models(
    *, target_root: Path, only: str = "all", force_download: bool = False
) -> Dict[str, object]:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise RuntimeError(
            "huggingface-hub is unavailable; install the root requirements.txt first"
        ) from exc

    root = target_root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    downloaded: Dict[str, object] = {}
    for purpose, spec in _selected_models(only):
        destination = root / spec["directory"]
        destination.mkdir(parents=True, exist_ok=True)
        snapshot_download(
            repo_id=spec["repo_id"],
            repo_type="model",
            revision=spec["revision"],
            local_dir=destination,
            allow_patterns=list(spec["allow_patterns"]),
            force_download=force_download,
        )
        weight_path = destination / spec["weight_file"]
        if not weight_path.is_file():
            raise RuntimeError(f"download did not produce {weight_path}")
        if _looks_like_html(weight_path):
            raise ModelChecksumError(f"HTML content was saved as {weight_path}")
        actual_sha256 = _sha256(weight_path)
        if actual_sha256 != spec["weight_sha256"]:
            raise ModelChecksumError(
                f"checksum mismatch for {weight_path}: expected "
                f"{spec['weight_sha256']}, got {actual_sha256}"
            )
        downloaded[purpose] = {
            "repo_id": spec["repo_id"],
            "revision": spec["revision"],
            "path": str(destination),
            "weight_sha256": actual_sha256,
        }
    return {"download_complete": True, "selection": only, "models": downloaded}


def diagnose_download_error(exc: BaseException) -> str:
    chain = " ".join(
        str(item) for item in (exc, getattr(exc, "__cause__", None)) if item
    ).casefold()
    if isinstance(exc, ModelChecksumError) or "checksum mismatch" in chain:
        return "checksum_failure"
    if "407" in chain or "proxy authentication" in chain:
        return "proxy_authentication_failure"
    if "hostname" in chain and ("mismatch" in chain or "doesn't match" in chain):
        return "certificate_hostname_mismatch"
    if "expired" in chain or "not yet valid" in chain:
        return "certificate_expired_or_not_yet_valid"
    if isinstance(exc, ssl.SSLCertVerificationError) or "certificate verify failed" in chain:
        return "untrusted_certificate_authority"
    if isinstance(exc, (TimeoutError, socket.timeout)) or "timed out" in chain:
        return "network_timeout"
    if isinstance(exc, socket.gaierror) or any(
        marker in chain
        for marker in ("name resolution", "getaddrinfo failed", "nodename nor servname")
    ):
        return "dns_failure"
    if any(marker in chain for marker in ("status code: 500", "502", "503", "504")):
        return "hugging_face_availability_failure"
    return "download_failure"


def build_parser() -> argparse.ArgumentParser:
    backend_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Download or offline-verify pinned MiniLM and DistilBART files."
    )
    parser.add_argument(
        "--target-root",
        type=Path,
        default=backend_root / "model_weights",
        help="parent folder for the two model directories",
    )
    parser.add_argument(
        "--only", choices=("all", "embedding", "summarization"), default="all"
    )
    parser.add_argument("--force-download", action="store_true")
    parser.add_argument(
        "--ca-bundle",
        type=Path,
        help="organization-approved PEM certificate bundle used for TLS verification",
    )
    parser.add_argument(
        "--use-system-ca",
        action="store_true",
        help="verify TLS through the operating system trust store",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="make no network requests; validate local files and pinned hashes",
    )
    return parser


def _remediation_guidance() -> list:
    return [
        "Do not install a random certificate and do not disable TLS verification.",
        "When corporate HTTPS inspection is active, obtain the approved root CA from IT/security.",
        "Install it in Windows Trusted Root Certification Authorities only when authorized.",
        "If Python still does not use that store, export it as PEM and pass --ca-bundle.",
        "After a manual model copy, run this command again with --verify-only.",
    ]


def main(argv: Optional[Iterable[str]] = None) -> int:
    arguments = build_parser().parse_args(list(argv) if argv is not None else None)
    if arguments.verify_only:
        result = verify_models(target_root=arguments.target_root, only=arguments.only)
        print(json.dumps(result, indent=2))
        return 0 if result["verified"] else 3

    try:
        trust_source = resolve_trust_source(
            arguments.ca_bundle, use_system_ca=arguments.use_system_ca
        )
        client_configuration = configure_huggingface_tls(trust_source)
        result = download_models(
            target_root=arguments.target_root,
            only=arguments.only,
            force_download=arguments.force_download,
        )
    except Exception as exc:
        print(
            json.dumps(
                {
                    "download_complete": False,
                    "error_type": diagnose_download_error(exc),
                    "error": str(exc),
                    "guidance": _remediation_guidance(),
                },
                indent=2,
            )
        )
        return 2
    result["tls_trust_source"] = trust_source
    result["huggingface_client_configuration"] = client_configuration
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
