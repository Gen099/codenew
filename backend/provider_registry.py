"""
Provider registry — manages all video providers.
"""
import logging
from provider_kie import KIEProvider
from provider_piapi import PiAPIProvider
import settings_store

logger = logging.getLogger(__name__)

# ─── Provider instances ───
_providers = {}


def _init_providers():
    """Initialize all providers. Called once at startup."""
    global _providers
    _providers = {}

    # Provider 1: KIE
    try:
        p1 = KIEProvider()
        _providers[p1.provider_id] = p1
        logger.info("Provider registered: %s (%s)", p1.display_name, p1.provider_id)
    except Exception as e:
        logger.error("Failed to init Provider 1 (KIE): %s", e)

    # Provider 2: PiAPI
    try:
        p2 = PiAPIProvider()
        _providers[p2.provider_id] = p2
        logger.info("Provider registered: %s (%s)", p2.display_name, p2.provider_id)
    except Exception as e:
        logger.error("Failed to init Provider 2 (PiAPI): %s", e)


def get_provider(provider_id: str):
    """Get a provider by ID. Falls back to provider1 if not found."""
    if not _providers:
        _init_providers()
    return _providers.get(provider_id, _providers.get("provider1"))


def list_providers() -> list[dict]:
    """List all registered providers for UI display."""
    if not _providers:
        _init_providers()
    result = []
    for pid, p in _providers.items():
        result.append({
            "id": p.provider_id,
            "name": p.display_name,
            "available": True,
        })
    return result


def get_default_provider_id() -> str:
    """Return the default provider ID."""
    if not _providers:
        _init_providers()
    provider_id = settings_store.get_default_video_provider()
    return provider_id if provider_id in _providers else "provider1"


# Auto-init on import
_init_providers()
