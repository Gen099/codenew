"""Provider-management routes."""
import hashlib
import json
import logging
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .auth_routes import user_has_permission

try:
    from .. import runtime_paths
    from .. import settings_store
except ImportError:
    import runtime_paths
    import settings_store

logger = logging.getLogger(__name__)


class ProviderKeyReq(BaseModel):
    key: str


class ProviderSettingsReq(BaseModel):
    default_provider: str = "provider1"
    default_models: dict = {}
    kie_credit_package: str = "usd50_10000"


def create_provider_router(require_user, providers):
    router = APIRouter()

    def _catalog_entry(provider_id: str, provider):
        if provider_id == "provider1":
            endpoints = {
                "create_task": "https://api.kie.ai/api/v1/jobs/createTask",
                "get_task": "https://api.kie.ai/api/v1/jobs/recordInfo",
                "upload": "https://api.kie.ai/api/v1/files/upload",
            }
            supports_cancel = False
        elif provider_id == "provider2":
            endpoints = {
                "create_task": "https://api.piapi.ai/api/v1/task",
                "get_task": "https://api.piapi.ai/api/v1/task/{task_id}",
                "upload": "https://api.piapi.ai/api/v1/file/upload",
            }
            supports_cancel = True
        else:
            endpoints = {}
            supports_cancel = False
        return {
            "id": provider.provider_id,
            "name": provider.display_name,
            "default": provider.provider_id == providers.get_default_provider_id(),
            "supports_cancel": supports_cancel,
            "endpoints": endpoints,
            "models": provider.list_models(),
        }

    def _kie_packages():
        return [
            {"id": "usd5_1000", "label": "$5 / 1,000 credits", "usd": 5, "credits": 1000, "bonus_pct": 0, "usd_per_credit": 0.005},
            {"id": "usd50_10000", "label": "$50 / 10,000 credits", "usd": 50, "credits": 10000, "bonus_pct": 0, "usd_per_credit": 0.005},
            {"id": "usd500_105000", "label": "$500 / 105,000 credits", "usd": 500, "credits": 105000, "bonus_pct": 5, "usd_per_credit": round(500 / 105000, 8)},
            {"id": "usd1250_275000", "label": "$1250 / 275,000 credits", "usd": 1250, "credits": 275000, "bonus_pct": 10, "usd_per_credit": round(1250 / 275000, 8)},
        ]

    def _is_local_request(request: Request) -> bool:
        host = getattr(getattr(request, "client", None), "host", "") or ""
        return host in {"127.0.0.1", "::1", "localhost"}

    @router.get("/api/providers")
    async def list_providers_endpoint(request: Request):
        require_user(request)
        return {
            "providers": providers.list_providers(),
            "default_provider": providers.get_default_provider_id(),
        }

    @router.get("/api/providers/settings")
    async def get_provider_settings(request: Request):
        require_user(request)
        settings = settings_store.load_settings()
        return {
            "default_provider": providers.get_default_provider_id(),
            "default_models": settings.get("default_video_models") or {},
            "kie_credit_package": settings.get("kie_credit_package") or "usd50_10000",
            "provider2_endpoint": "https://api.piapi.ai/api/v1/task",
        }

    @router.get("/api/providers/catalog")
    async def get_provider_catalog(request: Request):
        require_user(request)
        entries = []
        for item in providers.list_providers():
            provider = providers.get_provider(item["id"])
            if provider:
                entries.append(_catalog_entry(item["id"], provider))
        return {
            "default_provider": providers.get_default_provider_id(),
            "default_models": settings_store.load_settings().get("default_video_models") or {},
            "kie_credit_package": settings_store.load_settings().get("kie_credit_package") or "usd50_10000",
            "kie_credit_packages": _kie_packages(),
            "providers": entries,
        }

    @router.post("/api/providers/settings")
    async def save_provider_settings(req: ProviderSettingsReq, request: Request):
        user = require_user(request)
        role = str(user.get("role") or "").strip().lower()
        if role not in {"admin", "qc_manager"} and not user_has_permission(user, "manage_settings") and not user_has_permission(user, "manage_keys"):
            raise HTTPException(403, "Manage settings permission required")
        default_provider = str(req.default_provider or "provider1").strip().lower()
        if default_provider not in {"provider1", "provider2"}:
            raise HTTPException(400, "Invalid default provider")
        current = settings_store.load_settings()
        current["default_video_provider"] = default_provider
        current["kie_credit_package"] = str(req.kie_credit_package or current.get("kie_credit_package") or "usd50_10000").strip().lower()
        model_map = current.get("default_video_models") if isinstance(current.get("default_video_models"), dict) else {}
        req_models = req.default_models if isinstance(req.default_models, dict) else {}
        current["default_video_models"] = {
            "provider1": str(req_models.get("provider1") or model_map.get("provider1") or "kling25_turbo_pro").strip() or "kling25_turbo_pro",
            "provider2": str(req_models.get("provider2") or model_map.get("provider2") or "kling25_turbo").strip() or "kling25_turbo",
        }
        settings_store.save_settings(current)
        saved = settings_store.load_settings()
        return {
            "ok": True,
            "default_provider": providers.get_default_provider_id(),
            "default_models": saved.get("default_video_models") or {},
            "kie_credit_package": saved.get("kie_credit_package") or "usd50_10000",
            "provider2_endpoint": "https://api.piapi.ai/api/v1/task",
        }

    @router.get("/api/providers/{provider_id}/credits")
    async def provider_credits(provider_id: str, request: Request):
        require_user(request)
        provider = providers.get_provider(provider_id)
        if not provider:
            raise HTTPException(404, "Provider not found")
        return await provider.get_credits()

    @router.get("/api/providers/{provider_id}/models")
    async def provider_models(provider_id: str, request: Request):
        require_user(request)
        provider = providers.get_provider(provider_id)
        if not provider:
            raise HTTPException(404, "Provider not found")
        return {"models": provider.list_models()}

    @router.post("/api/providers/provider2/keys/set")
    async def set_provider2_key(req: ProviderKeyReq, request: Request):
        user = require_user(request)
        if not user_has_permission(user, "manage_keys"):
            raise HTTPException(403, "Manage keys permission required")

        provider = providers.get_provider("provider2")
        if not provider:
            raise HTTPException(500, "Provider 2 not available")

        key_value = req.key.strip()
        provider._api_key = key_value
        keys_path = runtime_paths.API_KEYS_FILE
        data = {"provider1": [], "provider2": []}
        if os.path.exists(keys_path):
            try:
                with open(keys_path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                data["provider1"] = raw.get("provider1") or raw.get("keys") or []
                data["provider2"] = raw.get("provider2") or []
            except Exception:
                pass
        data["provider2"] = [key_value]
        with open(keys_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        env_path = runtime_paths.ENV_FILE
        lines = []
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                lines = [line for line in f.readlines() if not line.startswith("PIAPI_KEY=")]
        lines.append(f"PIAPI_KEY={key_value}\n")
        with open(env_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        logger.info("Provider 2 key updated")
        return {"ok": True}

    @router.get("/api/providers/provider2/keys")
    async def get_provider2_key(request: Request):
        require_user(request)
        provider = providers.get_provider("provider2")
        if provider and hasattr(provider, "_reload_key_if_needed"):
            provider._reload_key_if_needed()
        if provider and provider._api_key:
            key = provider._api_key
            masked = f"...{key[-6:]}" if len(key) > 6 else "****"
            return {"keys": [{"masked": masked, "has_key": True}]}
        return {"keys": [{"masked": "Not set", "has_key": False}]}

    @router.get("/api/providers/runtime-keys/status")
    async def provider_runtime_key_status(request: Request):
        if not _is_local_request(request):
            raise HTTPException(403, "Local access only")

        provider1_hashes = []
        try:
            try:
                from .. import kie_client
            except ImportError:
                import kie_client
            if hasattr(kie_client, "force_reload_keys"):
                kie_client.force_reload_keys()
            elif hasattr(kie_client, "_check_reload"):
                kie_client._check_reload()
            provider1_hashes = [
                hashlib.sha256(str(key).encode("utf-8")).hexdigest()
                for key in getattr(kie_client, "_api_keys", []) or []
                if str(key).strip()
            ]
        except Exception as exc:
            logger.warning("Failed to read provider1 runtime keys: %s", exc)

        provider2_hashes = []
        try:
            provider2 = providers.get_provider("provider2")
            if provider2 and hasattr(provider2, "_reload_key_if_needed"):
                provider2._reload_key_if_needed()
            runtime_key = getattr(provider2, "_api_key", "") if provider2 else ""
            if str(runtime_key).strip():
                provider2_hashes = [hashlib.sha256(str(runtime_key).encode("utf-8")).hexdigest()]
        except Exception as exc:
            logger.warning("Failed to read provider2 runtime keys: %s", exc)

        return {
            "ok": True,
            "provider1": {"loaded_hashes": provider1_hashes},
            "provider2": {"loaded_hashes": provider2_hashes},
        }

    return router
