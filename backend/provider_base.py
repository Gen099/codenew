"""
Abstract base class for video generation providers.
All providers must implement this interface.
"""
from abc import ABC, abstractmethod
from typing import Optional


class VideoProvider(ABC):
    """Abstract video generation provider."""

    @property
    @abstractmethod
    def provider_id(self) -> str:
        """Unique provider identifier, e.g. 'provider1'."""
        ...

    @property
    @abstractmethod
    def display_name(self) -> str:
        """User-facing name, e.g. 'Provider 1'."""
        ...

    @abstractmethod
    async def create_video(
        self,
        prompt: str,
        duration: int = 5,
        aspect_ratio: str = "16:9",
        image_url: Optional[str] = None,
        end_image_url: Optional[str] = None,
        negative_prompt: str = "",
        cfg_scale: float = 0.5,
        mode: str = "std",
    ) -> str:
        """Create a video generation task. Returns task_id."""
        ...

    @abstractmethod
    async def query_video(self, task_id: str) -> dict:
        """Poll task status. Returns normalized dict:
        {
            "status": "pending" | "processing" | "success" | "fail",
            "video_url": str | None,
            "cover_url": str | None,
            "error": str | None,
            "raw": dict,  # original API response
        }
        """
        ...

    @abstractmethod
    async def get_credits(self) -> dict:
        """Get credit info. Returns:
        {
            "total": float,
            "keys": [{"masked": str, "credits": float, "active": bool, ...}],
            "unit": str,  # "credits" or "USD"
        }
        """
        ...

    @abstractmethod
    async def upload_file(self, file_bytes: bytes, filename: str, content_type: str = "image/png") -> str:
        """Upload a file and return its CDN URL."""
        ...

    def get_credit_cost(self, duration: int = 5, mode: str = "std") -> float:
        """Estimated credit cost for a generation. Override in subclass."""
        return 0

    @abstractmethod
    def list_models(self) -> list[dict]:
        """Return available models:
        [{"id": str, "label": str, "cost_5s": float, "cost_10s": float, "unit": str}, ...]
        """
        ...
