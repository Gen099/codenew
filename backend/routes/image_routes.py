"""Heavier image routes: edit and analyze."""
import base64

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from activity_logger import log_activity

IMAGE_MODELS = {"nano-banana-pro"}
# KIE public pricing pages show Nano Banana Pro at ~$0.09 for 1K-2K and ~$0.12 for 4K.
# KIE also documents Nano Banana Pro around ~24 credits per image for the top tier.
# Internal credit mapping used here follows that published ratio:
#   1K/2K ~= 18 credits, 4K ~= 24 credits.
IMAGE_RESOLUTION_CREDITS = {
    "1K": 18,
    "2K": 18,
    "4K": 24,
}

ANALYZE_SYSTEM_PROMPT = """You are a professional image and video analyst for a creative studio.
When given an image or description, provide THREE sections in your response.
ALWAYS respond in BILINGUAL format: English first, then Vietnamese translation below.

## 1. Analysis / Phan tich
Analyze the image: colors, composition, style, mood, lighting, subject.
(English paragraph first, then Vietnamese paragraph)

## 2. Image Editing Prompts / Goi y chinh anh
Suggest 3 creative prompts for editing this image (for AI image effects like color grading, style transfer, etc).
Format each as a one-line prompt ready to use IN ENGLISH (for AI input).
Below each prompt, add a Vietnamese explanation of what it does.

## 3. Video Prompts / Goi y tao video
Suggest 3 prompts for creating a video from this image (for AI video generation like Kling or Veo).
Include camera movement suggestions. Format each as a one-line prompt IN ENGLISH.
Below each prompt, add a Vietnamese explanation."""


def _parse_analysis(text: str) -> dict:
    sections = {"analysis": "", "image_prompts": [], "video_prompts": []}
    current_section = ""
    for line in text.split("\n"):
        stripped = line.strip()
        lower = stripped.lower()
        if "## 1" in stripped or ("analysis" in lower and stripped.startswith("#")):
            current_section = "analysis"
            continue
        if "## 2" in stripped or ("image" in lower and "prompt" in lower and stripped.startswith("#")):
            current_section = "image_prompts"
            continue
        if "## 3" in stripped or ("video" in lower and "prompt" in lower and stripped.startswith("#")):
            current_section = "video_prompts"
            continue

        if current_section == "analysis":
            sections["analysis"] += line + "\n"
        elif current_section == "image_prompts" and stripped and not stripped.startswith("#"):
            clean = stripped.lstrip("-*0123456789. ").strip()
            if clean:
                sections["image_prompts"].append(clean)
        elif current_section == "video_prompts" and stripped and not stripped.startswith("#"):
            clean = stripped.lstrip("-*0123456789. ").strip()
            if clean:
                sections["video_prompts"].append(clean)

    sections["analysis"] = sections["analysis"].strip()
    return sections


def create_image_router(require_user, db, kie, logger, tg=None, asyncio_mod=None):
    router = APIRouter()

    @router.post("/api/image/edit")
    async def image_edit(
        request: Request,
        file: UploadFile = File(...),
        preset_name: str = Form(""),
        custom_prompt: str = Form(""),
        model: str = Form("nano-banana-pro"),
        aspect_ratio: str = Form("auto"),
        resolution: str = Form("2K"),
        output_format: str = Form("png"),
    ):
        user = require_user(request)

        if model not in IMAGE_MODELS:
            raise HTTPException(400, f"Model '{model}' not supported")
        if resolution not in IMAGE_RESOLUTION_CREDITS:
            raise HTTPException(400, f"Resolution '{resolution}' not supported")
        credit_cost = IMAGE_RESOLUTION_CREDITS[resolution]
        if output_format not in {"png", "jpg", "jpeg"}:
            raise HTTPException(400, f"Output format '{output_format}' not supported")

        file_bytes = await file.read()
        if len(file_bytes) > 10 * 1024 * 1024:
            raise HTTPException(400, "File too large (max 10MB)")

        try:
            source_url = await kie.upload_file(
                file_bytes,
                file.filename or "image.jpg",
                file.content_type or "image/jpeg",
            )
        except Exception as exc:
            logger.exception("Image edit upload failed")
            raise HTTPException(500, f"Image upload failed: {exc}")

        prompt = ""
        preset_prefix = ""
        preset_suffix = ""
        if preset_name:
            presets = db.get_presets()
            for preset in presets:
                if preset["name"] == preset_name:
                    preset_prefix = preset.get("prompt_prefix", "")
                    preset_suffix = preset.get("prompt_suffix", "")
                    break

        if preset_prefix:
            prompt = preset_prefix
            if custom_prompt:
                prompt += ". " + custom_prompt
            if preset_suffix:
                prompt += ". " + preset_suffix
        elif custom_prompt:
            prompt = custom_prompt
        else:
            raise HTTPException(400, "Can chon preset hoac nhap prompt")

        input_payload = {
            "prompt": prompt,
            "image_input": [source_url],
            "resolution": resolution,
            "output_format": "jpg" if output_format == "jpeg" else output_format,
        }
        if aspect_ratio and aspect_ratio != "auto":
            input_payload["aspect_ratio"] = aspect_ratio

        try:
            task_id = await kie.create_task(model, input_payload, cost=credit_cost)
        except Exception as exc:
            logger.exception("Image edit task creation failed")
            raise HTTPException(500, f"Image task creation failed: {exc}")

        try:
            db.save_task(
                task_id,
                {
                    "user_name": user["username"],
                    "user_display": user["display_name"],
                    "status": "pending",
                    "prompt": prompt[:500],
                    "gen_mode": "image_edit",
                    "duration": 0,
                    "aspect_ratio": aspect_ratio,
                    "camera_move": "",
                    "credit_used": credit_cost,
                    "provider": "provider1",
                },
            )
            active_wt = db.get_active_work_task(user["username"])
            linked_work_task_id = active_wt["id"] if active_wt else ""
            if linked_work_task_id:
                db.link_video_to_work_task(task_id, linked_work_task_id)
            db.update_task(task_id, source_url=source_url, task_type="image_edit")
        except Exception as exc:
            logger.exception("Image edit database save failed")
            raise HTTPException(500, f"Image task database save failed: {exc}")

        logger.info("Image edit started: task=%s model=%s preset=%s", task_id, model, preset_name or "(custom)")
        log_activity(
            user["display_name"],
            "Image Start",
            f"{task_id[:10]} | {prompt[:120]}",
            float(credit_cost or 0),
            "provider1",
        )
        if tg and asyncio_mod:
            asyncio_mod.ensure_future(
                tg.send_image_started(task_id, user["display_name"], model, prompt)
            )
        return {
            "task_id": task_id,
            "status": "pending",
            "source_url": source_url,
            "prompt": prompt,
            "model": model,
            "credit": credit_cost,
            "resolution": resolution,
            "preset": preset_name,
            "work_task_id": linked_work_task_id or None,
        }

    @router.post("/api/image/analyze")
    async def image_analyze(
        request: Request,
        file: UploadFile = File(...),
        model: str = Form("gemini-2.5-flash"),
        user_prompt: str = Form(""),
    ):
        user = require_user(request)

        file_bytes = await file.read()
        content_type = file.content_type or "image/jpeg"
        try:
            file_url = await kie.upload_file(file_bytes, file.filename or "analyze.jpg", content_type)
        except Exception as exc:
            logger.exception("Image analyze upload failed")
            raise HTTPException(500, f"Image analyze upload failed: {exc}")

        b64_data = base64.b64encode(file_bytes).decode("utf-8")
        data_uri = f"data:{content_type};base64,{b64_data}"

        user_content = []
        if content_type.startswith("image"):
            user_content.append({"type": "image_url", "image_url": {"url": data_uri}})
        if user_prompt:
            user_content.append({"type": "text", "text": user_prompt})
        else:
            user_content.append(
                {
                    "type": "text",
                    "text": "Analyze this image and suggest editing prompts and video creation prompts.",
                }
            )

        messages = [
            {"role": "system", "content": ANALYZE_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        try:
            result = await kie.chat_completion(model, messages, stream=False)
        except RuntimeError as exc:
            if "500" in str(exc):
                user_content_url = [{"type": "image_url", "image_url": {"url": file_url}}]
                user_content_url.extend([item for item in user_content if item.get("type") == "text"])
                messages[1] = {"role": "user", "content": user_content_url}
                try:
                    result = await kie.chat_completion(model, messages, stream=False)
                except Exception as retry_exc:
                    logger.exception("Image analyze chat retry failed")
                    raise HTTPException(500, f"Image analyze failed after retry: {retry_exc}")
            else:
                logger.exception("Image analyze chat failed")
                raise HTTPException(500, f"Image analyze failed: {exc}")
        except Exception as exc:
            logger.exception("Image analyze chat failed")
            raise HTTPException(500, f"Image analyze failed: {exc}")

        response_text = ""
        if isinstance(result, dict):
            choices = result.get("choices", [])
            if choices:
                response_text = choices[0].get("message", {}).get("content", "")

        sections = _parse_analysis(response_text)
        log_activity(
            user["display_name"],
            "Image Analyze",
            f"{str(user_prompt or 'media analysis')[:120]}",
            0,
            model,
        )
        return {
            "file_url": file_url,
            "model": model,
            "raw": response_text,
            **sections,
        }

    return router
