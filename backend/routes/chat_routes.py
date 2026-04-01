"""AI Agent routes: chat and media analyze."""
import base64
import json
import uuid

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from activity_logger import log_activity


ANALYZE_SYSTEM_PROMPT = """You are a professional image and video analyst for a creative studio.
When given an image or description, provide THREE sections in your response.

## 1. Analysis
Analyze the image: colors, composition, style, mood, lighting, subject.

## 2. Image Editing Prompts
Suggest 3 creative prompts for editing this image. Return one-line prompts in English.

## 3. Video Prompts
Suggest 3 prompts for creating a video from this image. Include camera movement. Return one-line prompts in English.
"""


class ChatRequest(BaseModel):
    messages: list[dict]
    model: str = "gemini-2.5-flash"
    stream: bool = False


class ChatHistoryRequest(BaseModel):
    session_key: str
    work_task_id: str = ""
    chat_model: str = "gpt-5-4"
    chat_skill: str = ""
    system_prompt: str = ""
    messages: list[dict] = []


class ChatMemoryRequest(BaseModel):
    session_key: str
    work_task_id: str = ""
    memory_text: str = ""


class ChatAnalysisRecordRequest(BaseModel):
    session_key: str
    work_task_id: str = ""
    analyze_model: str = "gpt-5-4"
    analyze_skill: str = ""
    analyze_system_prompt: str = ""
    analyze_prompt: str = ""
    analyze_file_name: str = ""
    analysis_result: dict = {}


def _parse_analysis(text: str) -> dict:
    sections = {"analysis": "", "image_prompts": [], "video_prompts": []}
    current = ""
    raw = str(text or "")
    parsed_json = None
    try:
        parsed_json = json.loads(raw)
    except Exception:
        parsed_json = None
    if isinstance(parsed_json, dict):
        analysis = str(parsed_json.get("analysis") or "").strip()
        image_prompts = parsed_json.get("image_prompts") or parsed_json.get("imagePrompts") or []
        video_prompts = parsed_json.get("video_prompts") or parsed_json.get("videoPrompts") or []
        if not isinstance(image_prompts, list):
            image_prompts = [str(image_prompts)]
        if not isinstance(video_prompts, list):
            video_prompts = [str(video_prompts)]
        return {
            "analysis": analysis,
            "image_prompts": [str(x).strip() for x in image_prompts if str(x).strip()],
            "video_prompts": [str(x).strip() for x in video_prompts if str(x).strip()],
        }
    for line in raw.splitlines():
        stripped = line.strip()
        lower = stripped.lower()
        if "## 1" in stripped or (stripped.startswith("#") and "analysis" in lower):
            current = "analysis"
            continue
        if "## 2" in stripped or (stripped.startswith("#") and "image" in lower and "prompt" in lower):
            current = "image_prompts"
            continue
        if "## 3" in stripped or (stripped.startswith("#") and "video" in lower and "prompt" in lower):
            current = "video_prompts"
            continue
        if current == "analysis":
            sections["analysis"] += line + "\n"
        elif current in ("image_prompts", "video_prompts") and stripped and not stripped.startswith("#"):
            clean = stripped.lstrip("-*0123456789. ").strip()
            if clean:
                sections[current].append(clean)
    sections["analysis"] = sections["analysis"].strip()
    if sections["analysis"] and sections["image_prompts"] and sections["video_prompts"]:
        return sections

    # Fallback parser for free-form responses without explicit markdown sections.
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    image_mode = False
    video_mode = False
    fallback_analysis = []
    for ln in lines:
        lower = ln.lower()
        clean = ln.lstrip("-*0123456789. ").strip()
        if ("image" in lower and "prompt" in lower) or lower.startswith("prompts for image"):
            image_mode = True
            video_mode = False
            continue
        if ("video" in lower and "prompt" in lower) or lower.startswith("prompts for video"):
            video_mode = True
            image_mode = False
            continue
        if image_mode:
            if clean:
                sections["image_prompts"].append(clean)
            continue
        if video_mode:
            if clean:
                sections["video_prompts"].append(clean)
            continue
        fallback_analysis.append(ln)

    if not sections["analysis"]:
        sections["analysis"] = "\n".join(fallback_analysis).strip() or raw.strip()
    return sections


def _extract_content(result: dict) -> str:
    if not isinstance(result, dict):
        return str(result or "")
    choices = result.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        content = message.get("content", "")
        if isinstance(content, list):
            return "\n".join(
                str(part.get("text", ""))
                for part in content
                if isinstance(part, dict) and part.get("text")
            )
        return str(content or "")
    return str(result.get("data") or "")


def _extract_stream_response_text(payload: dict) -> str:
    response_obj = payload.get("response") if isinstance(payload, dict) else None
    if not isinstance(response_obj, dict):
        response_obj = payload if isinstance(payload, dict) else {}
    text_parts = []
    for item in response_obj.get("output", []) or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []) or []:
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                text_parts.append(text)
    return "\n".join(text_parts).strip()


def create_chat_router(require_user, db, kie, logger, tg=None, asyncio_mod=None):
    router = APIRouter()
    credit_map = {m["id"]: m.get("credit", 0) for m in getattr(kie, "CHAT_MODELS", [])}
    models = [
        {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "type": "chat+vision", "credit": credit_map.get("gemini-2.5-flash", 2)},
        {"id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro", "type": "chat+vision", "credit": credit_map.get("gemini-2.5-pro", 3)},
        {"id": "gpt-5-4", "name": "GPT-5.4", "type": "chat", "credit": credit_map.get("gpt-5-4", 4)},
    ]

    @router.get("/api/chat/models")
    async def get_models(request: Request):
        require_user(request)
        return models

    @router.get("/api/chat/history")
    async def get_chat_history(request: Request, session_key: str):
        user = require_user(request)
        row = db.get_ai_chat_history(user["username"], session_key.strip())
        return row or {"session_key": session_key.strip(), "messages": []}

    @router.get("/api/chat/history-list")
    async def get_chat_history_list(request: Request):
        user = require_user(request)
        return db.list_ai_chat_histories(user["username"], 100)

    @router.post("/api/chat/history")
    async def save_chat_history(request: Request, req: ChatHistoryRequest):
        user = require_user(request)
        session_key = (req.session_key or "").strip()
        if not session_key:
            raise HTTPException(400, "session_key is required")
        db.save_ai_chat_history(
            user["username"],
            session_key,
            {
                "work_task_id": req.work_task_id,
                "chat_model": req.chat_model,
                "chat_skill": req.chat_skill,
                "system_prompt": req.system_prompt,
                "messages": req.messages,
            },
        )
        return {"ok": True, "session_key": session_key}

    @router.delete("/api/chat/history")
    async def delete_chat_history(request: Request, session_key: str):
        user = require_user(request)
        if str(user.get("role") or "") != "admin":
            raise HTTPException(403, "Admin only")
        key = (session_key or "").strip()
        if not key:
            raise HTTPException(400, "session_key is required")
        db.delete_ai_chat_history(user["username"], key)
        return {"ok": True, "session_key": key}

    @router.get("/api/chat/memory")
    async def get_chat_memory(request: Request, session_key: str):
        user = require_user(request)
        row = db.get_ai_chat_memory(user["username"], session_key.strip())
        return row or {"session_key": session_key.strip(), "memory_text": ""}

    @router.post("/api/chat/memory")
    async def save_chat_memory(request: Request, req: ChatMemoryRequest):
        user = require_user(request)
        session_key = (req.session_key or "").strip()
        if not session_key:
            raise HTTPException(400, "session_key is required")
        db.save_ai_chat_memory(
            user["username"],
            session_key,
            {
                "work_task_id": req.work_task_id,
                "memory_text": req.memory_text,
            },
        )
        return {"ok": True, "session_key": session_key}

    @router.post("/api/chat/memory/rebuild")
    async def rebuild_chat_memory(request: Request, req: ChatMemoryRequest):
        user = require_user(request)
        session_key = (req.session_key or "").strip()
        if not session_key:
            raise HTTPException(400, "session_key is required")
        row = db.rebuild_ai_chat_memory(user["username"], session_key)
        log_activity(
            user.get("display_name", user["username"]),
            "AI Memory Rebuild",
            f"{session_key} | rebuilt from chat",
            0,
            "provider1",
        )
        return row or {"session_key": session_key, "memory_text": ""}

    @router.post("/api/chat/analysis-record")
    async def add_chat_analysis_record(request: Request, req: ChatAnalysisRecordRequest):
        user = require_user(request)
        session_key = (req.session_key or "").strip()
        if not session_key:
            raise HTTPException(400, "session_key is required")
        db.add_ai_chat_analysis_record(
            user["username"],
            session_key,
            {
                "work_task_id": req.work_task_id,
                "analyze_model": req.analyze_model,
                "analyze_skill": req.analyze_skill,
                "analyze_system_prompt": req.analyze_system_prompt,
                "analyze_prompt": req.analyze_prompt,
                "analyze_file_name": req.analyze_file_name,
                "analysis_result": req.analysis_result or {},
            },
        )
        log_activity(
            user.get("display_name", user["username"]),
            "AI Analysis Record",
            f"{session_key} | {req.analyze_file_name or '-'}",
            0,
            "provider1",
        )
        return {"ok": True, "session_key": session_key}

    @router.post("/api/chat/agent")
    async def chat_agent(request: Request, req: ChatRequest):
        user = require_user(request)
        credit = credit_map.get(req.model, 2)
        user_text = ""
        for item in reversed(req.messages or []):
            if item.get("role") == "user":
                content = item.get("content", "")
                if isinstance(content, list):
                    content = " ".join(
                        str(part.get("text", ""))
                        for part in content
                        if isinstance(part, dict) and part.get("type") == "text"
                    )
                user_text = str(content or "")
                break

        if req.stream:
            try:
                resp = await kie.chat_completion(req.model, req.messages or [], stream=True)
            except Exception as exc:
                logger.exception("AI chat stream failed")
                raise HTTPException(500, f"AI chat failed: {exc}")

            task_id = f"chat_{uuid.uuid4().hex[:12]}"
            try:
                db.save_task(
                    task_id,
                    {
                        "user_name": user["username"],
                        "user_display": user.get("display_name", user["username"]),
                        "status": "success",
                        "prompt": user_text[:500],
                        "gen_mode": "chat",
                        "duration": 0,
                        "aspect_ratio": "",
                        "camera_move": "",
                        "credit_used": credit,
                        "provider": "provider1",
                        "task_type": "chat",
                    },
                )
            except Exception:
                logger.warning("AI chat history save failed", exc_info=True)

            async def _stream():
                buffer = ""
                current_event = ""
                try:
                    async for chunk in resp.content:
                        buffer += chunk.decode("utf-8", errors="ignore")
                        while "\n" in buffer:
                            line, buffer = buffer.split("\n", 1)
                            line = line.strip()
                            if not line:
                                current_event = ""
                                continue
                            if line.startswith("event:"):
                                current_event = line.split(":", 1)[1].strip()
                                continue
                            if line.startswith("data: "):
                                payload = line[6:]
                            elif line.startswith("data:"):
                                payload = line[5:]
                            else:
                                continue
                            if not payload or payload == "[DONE]":
                                continue
                            try:
                                parsed = json.loads(payload)
                                if current_event == "response.output_text.delta" and "delta" in parsed:
                                    out = {"choices": [{"delta": {"content": parsed["delta"]}}]}
                                    yield f"data: {json.dumps(out)}\n\n"
                                    continue
                                if current_event in {"response.completed", "response.done"}:
                                    final_text = _extract_stream_response_text(parsed)
                                    if final_text:
                                        out = {"choices": [{"message": {"content": final_text}}]}
                                        yield f"data: {json.dumps(out)}\n\n"
                                    continue
                                if current_event in {
                                    "response.output_text.done",
                                    "response.content_part.done",
                                    "response.output_item.done",
                                    "response.created",
                                    "response.in_progress",
                                    "response.output_item.added",
                                    "response.content_part.added",
                                }:
                                    continue
                                yield f"data: {json.dumps(parsed)}\n\n"
                            except json.JSONDecodeError:
                                yield f"data: {payload}\n\n"
                    yield "data: [DONE]\n\n"
                finally:
                    resp.release()

            return StreamingResponse(_stream(), media_type="text/event-stream")

        try:
            result = await kie.chat_completion(req.model, req.messages or [], stream=False)
        except Exception as exc:
            logger.exception("AI chat failed")
            raise HTTPException(500, f"AI chat failed: {exc}")

        task_id = f"chat_{uuid.uuid4().hex[:12]}"
        try:
            db.save_task(
                task_id,
                {
                    "user_name": user["username"],
                    "user_display": user.get("display_name", user["username"]),
                    "status": "success",
                    "prompt": user_text[:500],
                    "gen_mode": "chat",
                    "duration": 0,
                    "aspect_ratio": "",
                    "camera_move": "",
                    "credit_used": credit,
                    "provider": "provider1",
                    "task_type": "chat",
                },
            )
        except Exception:
            logger.warning("AI chat history save failed", exc_info=True)
        log_activity(
            user.get("display_name", user["username"]),
            "AI Chat",
            f"{req.model} | {user_text[:120]}",
            float(credit or 0),
            "provider1",
        )
        return result

    @router.post("/api/chat/analyze")
    async def analyze_media(
        request: Request,
        file: UploadFile = File(...),
        model: str = Form("gemini-2.5-flash"),
        user_prompt: str = Form(""),
        system_prompt: str = Form(""),
    ):
        user = require_user(request)
        content_type = file.content_type or "image/jpeg"
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(400, "Empty file")

        try:
            file_url = await kie.upload_file(file_bytes, file.filename or "media", content_type)
        except Exception as exc:
            logger.exception("AI analyze upload failed")
            raise HTTPException(500, f"AI analyze upload failed: {exc}")

        user_content = []
        if content_type.startswith("image"):
            data_uri = f"data:{content_type};base64,{base64.b64encode(file_bytes).decode('utf-8')}"
            user_content.append({"type": "image_url", "image_url": {"url": data_uri}})
        else:
            user_content.append({"type": "text", "text": f"Analyze this media file: {file_url}"})
        user_content.append({
            "type": "text",
            "text": user_prompt.strip() or "Analyze this media and produce analysis, image prompts, and video prompts.",
        })
        messages = [
            {"role": "system", "content": system_prompt.strip() or ANALYZE_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        try:
            result = await kie.chat_completion(model, messages, stream=False)
        except RuntimeError as exc:
            if "500" in str(exc) and content_type.startswith("image"):
                user_content = [{"type": "image_url", "image_url": {"url": file_url}}] + [item for item in user_content if item.get("type") == "text"]
                messages[1] = {"role": "user", "content": user_content}
                try:
                    result = await kie.chat_completion(model, messages, stream=False)
                except Exception as retry_exc:
                    logger.exception("AI analyze retry failed")
                    raise HTTPException(500, f"AI analyze failed after retry: {retry_exc}")
            else:
                logger.exception("AI analyze failed")
                raise HTTPException(500, f"AI analyze failed: {exc}")
        except Exception as exc:
            logger.exception("AI analyze failed")
            raise HTTPException(500, f"AI analyze failed: {exc}")

        raw = _extract_content(result)
        sections = _parse_analysis(raw)
        task_id = f"analyze_{uuid.uuid4().hex[:12]}"
        try:
            db.save_task(
                task_id,
                {
                    "user_name": user["username"],
                    "user_display": user.get("display_name", user["username"]),
                    "status": "success",
                    "prompt": (user_prompt or "media analysis")[:500],
                    "gen_mode": "analyze",
                    "duration": 0,
                    "aspect_ratio": "",
                    "camera_move": "",
                    "credit_used": credit_map.get(model, 2),
                    "provider": "provider1",
                    "source_url": file_url,
                    "task_type": "analysis",
                },
            )
        except Exception:
            logger.warning("AI analyze history save failed", exc_info=True)

        log_activity(
            user.get("display_name", user["username"]),
            "AI Analyze",
            f"{model} | {str(user_prompt or 'media analysis')[:120]}",
            float(credit_map.get(model, 2) or 0),
            "provider1",
        )
        return {
            "file_url": file_url,
            "model": model,
            "raw": raw,
            **sections,
        }

    return router
