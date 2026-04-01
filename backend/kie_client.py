"""
KIE.AI API Client â€” simplified for Video Creator Tool.
Supports multiple API keys with auto-rotation on 402.
"""
import os, json, logging, time, asyncio, threading
from typing import Optional
import aiohttp
from dotenv import load_dotenv
try:
    from . import runtime_paths
except ImportError:
    import runtime_paths

runtime_paths.ensure_runtime_dirs()
load_dotenv(runtime_paths.ENV_FILE)

logger = logging.getLogger(__name__)

KIE_BASE = "https://api.kie.ai"
UPLOAD_URLS = [
    "https://kieai.redpandaai.co/api/file-stream-upload",
    "https://api.kie.ai/api/v1/files/upload",
]

# â”€â”€â”€ API Key Pool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
_KEYS_FILE = runtime_paths.API_KEYS_FILE
_api_keys: list[str] = []
_current_key_idx = 0
_keys_file_mtime = 0.0
_key_lock = threading.Lock()
_exhausted_keys: dict[str, float] = {}
EXHAUSTED_TTL = 60
_key_credits: dict[str, float] = {}
_credits_last_refresh: float = 0.0
CREDIT_CACHE_TTL = 60          # seconds between KIE API calls
_refresh_lock: "asyncio.Lock | None" = None  # created lazily (needs running event loop)
_task_keys: dict[str, str] = {}  # task_id -> key
_session: Optional[aiohttp.ClientSession] = None


async def _get_session():
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=120),
            connector=aiohttp.TCPConnector(limit=20)
        )
    return _session


def _load_keys():
    global _api_keys, _keys_file_mtime
    _api_keys = []
    file_keys = []
    try:
        if os.path.exists(_KEYS_FILE):
            _keys_file_mtime = os.path.getmtime(_KEYS_FILE)
            with open(_KEYS_FILE, "r") as f:
                data = json.load(f)
            # New format: {"provider1": [...], "provider2": [...]}
            # Old format: {"keys": [...]}
            file_keys = [str(k).strip() for k in (data.get("provider1") or data.get("keys") or []) if str(k).strip()]
    except Exception as e:
        logger.error("Failed to load api_keys.json: %s", e)
    if file_keys:
        _api_keys.extend([k for k in file_keys if k not in _api_keys])
    else:
        env_key = os.getenv("API_KEY", "") or os.getenv("KIE_API_KEY", "")
        if env_key.strip():
            _api_keys.append(env_key.strip())
        multi = os.getenv("API_KEYS", "") or os.getenv("KIE_API_KEYS", "")
        for k in multi.split(","):
            k = k.strip()
            if k and k not in _api_keys:
                _api_keys.append(k)
    stale_keys = [key for key in list(_key_credits.keys()) if key not in _api_keys]
    for key in stale_keys:
        _key_credits.pop(key, None)
        _exhausted_keys.pop(key, None)
    if _api_keys:
        logger.info("API keys loaded: %d key(s)", len(_api_keys))
    else:
        logger.warning("No API keys configured!")


def _check_reload():
    if os.path.exists(_KEYS_FILE):
        mt = os.path.getmtime(_KEYS_FILE)
        if mt > _keys_file_mtime:
            _load_keys()


def force_reload_keys():
    _load_keys()


def _get_key() -> str:
    """Round-robin key selection, skipping exhausted keys."""
    global _current_key_idx
    _check_reload()
    if not _api_keys:
        raise RuntimeError("No API keys configured")
    now = time.time()
    n = len(_api_keys)
    for _ in range(n):
        key = _api_keys[_current_key_idx % n]
        _current_key_idx = (_current_key_idx + 1) % n
        if key in _exhausted_keys:
            if now - _exhausted_keys[key] > EXHAUSTED_TTL:
                del _exhausted_keys[key]
            else:
                continue
        return key
    # All exhausted â€” clear and return first key
    _exhausted_keys.clear()
    logger.warning("All keys were exhausted â€” cleared blacklist")
    return _api_keys[0]


def _get_key_for_cost(cost: int = 0) -> str:
    """Pick the key with MOST credits that can cover the cost."""
    _check_reload()
    if not _api_keys:
        raise RuntimeError("No API keys configured")
    if not _key_credits:
        return _get_key()  # No cache yet, use round-robin

    now = time.time()
    candidates = []
    for key in _api_keys:
        if key in _exhausted_keys and now - _exhausted_keys[key] < EXHAUSTED_TTL:
            continue
        cached = _key_credits.get(key, 0)
        if cached >= cost:
            candidates.append((key, cached))

    if candidates:
        # Sort by credits descending â€” pick richest key
        candidates.sort(key=lambda x: x[1], reverse=True)
        chosen = candidates[0]
        logger.info("KeyRouter: cost=%d â†’ key ...%s (%.1f cr, %d eligible)",
                    cost, chosen[0][-6:], chosen[1], len(candidates))
        return chosen[0]

    # No key has enough â€” pick richest anyway (best effort)
    all_keys = []
    for key in _api_keys:
        if key not in _exhausted_keys or now - _exhausted_keys.get(key, 0) > EXHAUSTED_TTL:
            all_keys.append((key, _key_credits.get(key, 0)))
    if all_keys:
        all_keys.sort(key=lambda x: x[1], reverse=True)
        logger.warning("KeyRouter: NO key has %d credits. Best: ...%s (%.1f cr)",
                       cost, all_keys[0][0][-6:], all_keys[0][1])
        return all_keys[0][0]

    return _get_key()


def _deduct_key_credit(key: str, amount: int):
    if key in _key_credits:
        _key_credits[key] = max(0, _key_credits[key] - amount)
        logger.info("Deducted %d from key ...%s â†’ %.1f remaining",
                    amount, key[-6:], _key_credits[key])


def _save_task_key(task_id: str, key: str):
    _task_keys[task_id] = key


def _get_task_key(task_id: str) -> Optional[str]:
    return _task_keys.get(task_id)


def mark_key_exhausted(key: str):
    _exhausted_keys[key] = time.time()
    if key in _key_credits:
        _key_credits[key] = 0
    remaining = len(_api_keys) - len(_exhausted_keys)
    logger.warning("Key ...%s exhausted. %d/%d keys remaining",
                   key[-6:], remaining, len(_api_keys))


def _auth_headers():
    key = _get_key()
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


async def _retry_with_rotation(call_fn, cost: int = 0, max_retries: int = None):
    """Retry API call, rotating through ALL keys on 402."""
    if max_retries is None:
        max_retries = max(len(_api_keys) * 2, 4)  # Try each key at least twice
    last_err = None
    tried_keys = set()
    for attempt in range(max_retries):
        # First try cost-based selection, then round-robin for untried keys
        if attempt == 0 and cost > 0:
            key = _get_key_for_cost(cost)
        else:
            key = _get_key()
        # If we've tried all keys, stop
        if key in tried_keys and len(tried_keys) >= len(_api_keys):
            break
        tried_keys.add(key)
        try:
            status, data = await call_fn(key)
            if status == 402 or data.get("code") == 402:
                mark_key_exhausted(key)
                logger.warning("402 on key ...%s (attempt %d/%d), rotating...",
                               key[-6:], attempt + 1, max_retries)
                last_err = f"402 credits (key ...{key[-6:]})"
                continue
            return status, data
        except Exception as e:
            last_err = str(e)
            logger.error("API call error (key ...%s): %s", key[-6:], e)
    raise RuntimeError(f"All {len(tried_keys)} keys exhausted or failed: {last_err}")



# â”€â”€â”€ Credit queries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _ensure_credit_cache():
    if time.time() - _credits_last_refresh > CREDIT_CACHE_TTL:
        await refresh_key_credits()


async def _get_refresh_lock() -> asyncio.Lock:
    """Return the module-level asyncio.Lock, creating it lazily."""
    global _refresh_lock
    if _refresh_lock is None:
        _refresh_lock = asyncio.Lock()
    return _refresh_lock


async def refresh_key_credits(force: bool = False):
    """
    Fetch credit balance per key using official KIE API.
    Uses a lock so concurrent callers only trigger ONE real request.
    Skips fetch if cache is fresh (< CREDIT_CACHE_TTL seconds) unless force=True.
    """
    global _credits_last_refresh
    _check_reload()
    lock = await _get_refresh_lock()

    async with lock:
        # Double-check after acquiring lock: maybe another coroutine already refreshed
        if not force and time.time() - _credits_last_refresh < CREDIT_CACHE_TTL:
            return  # Cache still fresh, skip

        def _fetch_one(key: str) -> float:
            import requests as _req
            try:
                r = _req.get(
                    f"{KIE_BASE}/api/v1/chat/credit",
                    headers={"Authorization": f"Bearer {key}"},
                    timeout=15
                )
                data = r.json()
                logger.info("Credit key ...%s [%d]: %s", key[-6:], r.status_code, data)
                raw = data.get("data", 0)
                if isinstance(raw, (int, float)):
                    return float(raw)
                if isinstance(raw, dict):
                    return float(raw.get("credits") or raw.get("balance") or raw.get("points") or 0)
                return 0.0
            except Exception as e:
                logger.error("Credit fetch key ...%s: %s", key[-6:], e)
                return 0.0

        for key in list(_api_keys):
            credits = await asyncio.to_thread(_fetch_one, key)
            _key_credits[key] = credits
            logger.info("Key ...%s => credits=%.2f", key[-6:], credits)

        _credits_last_refresh = time.time()



async def get_credits_total() -> float:
    await _ensure_credit_cache()
    return sum(_key_credits.values())


async def get_all_keys_info() -> list[dict]:
    _check_reload()
    await _ensure_credit_cache()
    result = []
    for i, key in enumerate(_api_keys):
        result.append({
            "index": i,
            "masked": f"...{key[-6:]}",
            "credits": _key_credits.get(key, 0),
            "exhausted": key in _exhausted_keys,
            "active": i == (_current_key_idx % len(_api_keys)) if _api_keys else False,
        })
    return result


def set_preferred_key(index: int) -> bool:
    """Set a specific key as the preferred (next) key for API calls."""
    global _current_key_idx
    if 0 <= index < len(_api_keys):
        _current_key_idx = index
        key = _api_keys[index]
        # Clear exhausted status for this key
        if key in _exhausted_keys:
            del _exhausted_keys[key]
        logger.info("Preferred key set to [%d] ...%s (%.1f cr)",
                    index, key[-6:], _key_credits.get(key, 0))
        return True
    return False


def add_key(key: str) -> bool:
    global _credits_last_refresh
    key = key.strip()
    if not key or key in _api_keys:
        return False
    _api_keys.append(key)
    _save_keys()
    _credits_last_refresh = 0.0
    return True


def remove_key(index: int) -> bool:
    global _credits_last_refresh, _current_key_idx
    extra_keys = []
    provider2_keys = []
    try:
        with open(_KEYS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            extra_keys = list(data.get("provider1") or data.get("keys") or [])
            provider2_keys = list(data.get("provider2") or [])
    except Exception:
        pass
    if 0 <= index < len(_api_keys):
        key = _api_keys[index]
        _api_keys.remove(key)
        _key_credits.pop(key, None)
        _exhausted_keys.pop(key, None)
        # Keep historical task->key mapping so old tasks can still be polled/recovered.
        # Removing the key from active pool should not invalidate existing media records.
        if key in extra_keys:
            extra_keys.remove(key)
        with open(_KEYS_FILE, "w", encoding="utf-8") as f:
            json.dump({"provider1": extra_keys, "provider2": provider2_keys}, f, indent=2)
        _credits_last_refresh = 0.0
        _current_key_idx = min(_current_key_idx, len(_api_keys) - 1) if _api_keys else 0
        return True
    return False


def _save_keys():
    extra = list(_api_keys)
    provider2_keys = []
    try:
        if os.path.exists(_KEYS_FILE):
            with open(_KEYS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            provider2_keys = data.get("provider2") or []
    except Exception:
        provider2_keys = []
    with open(_KEYS_FILE, "w", encoding="utf-8") as f:
        json.dump({"provider1": extra, "provider2": provider2_keys}, f, indent=2)


# â”€â”€â”€ File Upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def upload_file(file_bytes: bytes, filename: str, content_type: str = "image/png") -> str:
    _check_reload()
    s = await _get_session()
    last_error = None
    for url in UPLOAD_URLS:
        for key in _api_keys:
            try:
                form = aiohttp.FormData()
                form.add_field("file", file_bytes, filename=filename, content_type=content_type)
                form.add_field("uploadPath", "temp")
                headers = {"Authorization": f"Bearer {key}"}
                async with s.post(url, headers=headers, data=form) as resp:
                    data = await resp.json()
                    if resp.status == 200:
                        d = data.get("data", {})
                        file_url = d.get("downloadUrl") or d.get("url") or data.get("fileUrl") or data.get("url")
                        if file_url:
                            return file_url
                    if resp.status == 404:
                        break
                    if resp.status == 402:
                        continue
                    last_error = f"Upload failed: {data}"
            except Exception as e:
                last_error = str(e)
    raise RuntimeError(f"Upload failed: {last_error}")


# â”€â”€â”€ Task Create & Poll â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def create_task(model: str, input_payload: dict, cost: int = 0) -> str:
    s = await _get_session()
    payload = {"model": model, "input": input_payload}
    _used_key = None

    async def _call(key: str):
        nonlocal _used_key
        _used_key = key
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        async with s.post(f"{KIE_BASE}/api/v1/jobs/createTask",
                          headers=headers, json=payload) as resp:
            data = await resp.json()
            logger.info("CreateTask [%s] key=...%s: %s", model, key[-6:], data)
            return resp.status, data

    status, data = await _retry_with_rotation(_call, cost=cost)
    if status != 200 or data.get("code") != 200:
        raise RuntimeError(f"CreateTask error: {data}")
    task_id = data["data"]["taskId"]
    _save_task_key(task_id, _used_key)
    _deduct_key_credit(_used_key, cost)
    return task_id


async def query_task(task_id: str) -> dict:
    s = await _get_session()
    task_key = _get_task_key(task_id)
    if task_key:
        headers = {"Authorization": f"Bearer {task_key}", "Content-Type": "application/json"}
    else:
        headers = _auth_headers()
    async with s.get(f"{KIE_BASE}/api/v1/jobs/recordInfo",
                     headers=headers, params={"taskId": task_id}) as resp:
        data = await resp.json()
        if not task_key and data.get("code") == 422:
            for key in _api_keys:
                h2 = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
                async with s.get(f"{KIE_BASE}/api/v1/jobs/recordInfo",
                                 headers=h2, params={"taskId": task_id}) as r2:
                    d2 = await r2.json()
                    if d2.get("code") != 422:
                        _task_keys[task_id] = key
                        return d2
        return data


# â”€â”€â”€ LLM / Chat (AI Agent) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# KIE endpoint routing:
#   Gemini â†’ https://api.kie.ai/{model}/v1/chat/completions
#   GPT    â†’ https://api.kie.ai/codex/v1/responses (model in body)

_GPT_RESPONSES_MODELS = {"gpt-5-4"}

CHAT_MODELS = [
    {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash âš¡", "type": "chat+vision", "credit": 2},
    {"id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro ðŸ§ ", "type": "chat+vision", "credit": 3},
    {"id": "gpt-5-4", "name": "GPT-5.4 ðŸ¤–", "type": "chat", "credit": 4},
]


def _chat_url(model: str) -> str:
    if model in _GPT_RESPONSES_MODELS:
        return f"{KIE_BASE}/codex/v1/responses"
    return f"{KIE_BASE}/{model}/v1/chat/completions"


def _coerce_text_content(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if not isinstance(item, dict):
                continue
            item_type = str(item.get("type") or "").strip().lower()
            if item_type in {"text", "input_text"}:
                text = str(item.get("text") or "")
                if text:
                    parts.append(text)
        return "\n".join(parts).strip()
    return str(value or "")


def _build_gpt54_responses_payload(model: str, messages: list, stream: bool = False) -> dict:
    instructions = ""
    input_items = []
    for msg in messages or []:
        role = str((msg or {}).get("role") or "user").strip().lower()
        content = (msg or {}).get("content", "")
        if role == "system":
            text = _coerce_text_content(content)
            if text:
                instructions = f"{instructions}\n\n{text}".strip() if instructions else text
            continue

        content_items = []
        if isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    continue
                item_type = str(item.get("type") or "").strip().lower()
                if item_type in {"text", "input_text"}:
                    text = str(item.get("text") or "").strip()
                    if text:
                        content_items.append({"type": "input_text", "text": text})
                elif item_type in {"image_url", "input_image"}:
                    image_url = item.get("image_url")
                    if isinstance(image_url, dict):
                        image_url = image_url.get("url")
                    image_url = str(image_url or item.get("url") or "").strip()
                    if image_url:
                        content_items.append({"type": "input_image", "image_url": image_url})
        else:
            text = _coerce_text_content(content).strip()
            if text:
                content_items.append({"type": "input_text", "text": text})

        if content_items:
            input_items.append({"role": role or "user", "content": content_items})

    payload = {"model": model, "stream": bool(stream), "input": input_items}
    if instructions:
        payload["instructions"] = instructions
    return payload


def _extract_text_from_response_object(response_obj) -> str:
    parts = []
    if not isinstance(response_obj, dict):
        return ""
    for item in response_obj.get("output", []) or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []) or []:
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text)
    return "\n".join(parts).strip()


def _parse_sse_chat_response(raw_text: str) -> dict:
    event_name = ""
    deltas = []
    completed_response = None
    for raw_line in (raw_text or "").splitlines():
        line = raw_line.strip()
        if not line:
            event_name = ""
            continue
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
            continue
        if not line.startswith("data:"):
            continue
        payload = line.split(":", 1)[1].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            parsed = json.loads(payload)
        except Exception:
            continue
        if event_name == "response.output_text.delta" and isinstance(parsed, dict):
            delta = parsed.get("delta")
            if isinstance(delta, str) and delta:
                deltas.append(delta)
        elif event_name in {"response.completed", "response.done"} and isinstance(parsed, dict):
            response_obj = parsed.get("response")
            if isinstance(response_obj, dict):
                completed_response = response_obj
    text = "".join(deltas).strip()
    if not text and completed_response:
        text = _extract_text_from_response_object(completed_response)
    if not text:
        raise RuntimeError("KIE SSE response did not contain usable text output")
    return {"choices": [{"message": {"content": text}}]}


async def chat_completion(model: str, messages: list, stream: bool = False):
    """Call KIE chat API. Returns dict (non-stream) or aiohttp.ClientResponse (stream)."""
    s = await _get_session()
    url = _chat_url(model)
    is_gpt_responses = model in _GPT_RESPONSES_MODELS

    if is_gpt_responses:
        payload = _build_gpt54_responses_payload(model, messages, stream=stream)
    else:
        # Gemini: OpenAI-compatible chat format
        payload = {"messages": messages, "stream": stream}

    if stream:
        for attempt in range(len(_api_keys)):
            current_key = _get_key()
            headers = {"Authorization": f"Bearer {current_key}", "Content-Type": "application/json"}
            resp = await s.post(url, headers=headers, json=payload)
            if resp.status == 402:
                logger.warning("Chat 402 (key ...%s)", current_key[-6:])
                await resp.release()
                mark_key_exhausted(current_key)
                continue
            return resp
        raise RuntimeError("All keys exhausted for chat")

    # Non-streaming with retry
    async def _call(key):
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        async with s.post(url, headers=headers, json=payload) as resp:
            raw_text = await resp.text()
            logger.info("Chat response model=%s status=%d", model, resp.status)
            try:
                data = json.loads(raw_text) if raw_text else {}
            except Exception:
                if raw_text.lstrip().startswith("event:"):
                    return resp.status, _parse_sse_chat_response(raw_text)
                snippet = (raw_text or "").strip().replace("\r", " ").replace("\n", " ")
                snippet = snippet[:220]
                raise RuntimeError(
                    f"KIE returned non-JSON response | status={resp.status} | body={snippet or '<empty>'}"
                )
            if isinstance(data, dict) and data.get("code") and data.get("code") != 200:
                error_msg = data.get("msg", "Unknown error")
                if "Operation not found" in str(error_msg):
                    raise RuntimeError(f"Chat model error: {error_msg}")
            return resp.status, data

    status, data = await _retry_with_rotation(_call)

    # Normalize response to OpenAI format
    if isinstance(data, dict):
        if "choices" in data:
            return data
        if "data" in data and "code" in data:
            inner = data["data"]
            if isinstance(inner, dict) and "choices" in inner:
                return inner
            if isinstance(inner, str):
                return {"choices": [{"message": {"content": inner}}]}
        # GPT Responses API: {output: [{content: [{text: "..."}]}]}
        if "output" in data and isinstance(data.get("output"), list):
            text_parts = []
            for item in data["output"]:
                if isinstance(item, dict):
                    for c in item.get("content", []):
                        if isinstance(c, dict) and c.get("text"):
                            text_parts.append(c["text"])
            return {"choices": [{"message": {"content": "\n".join(text_parts)}}]}

    return data


# â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_load_keys()

