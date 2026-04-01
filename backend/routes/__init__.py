"""Route modules for the FastAPI backend."""

from .auth_routes import create_auth_router
from .credits_routes import create_credits_router
from .history_routes import create_history_router
from .image_light_routes import create_image_light_router
from .image_routes import create_image_router
from .notifications_routes import create_notifications_router
from .provider_routes import create_provider_router
from .qc_routes import create_qc_router
from .reports_routes import create_reports_router
from .system_routes import create_system_router
from .video_utility_routes import create_video_utility_router
from .video_routes import create_video_router
from .work_tasks_routes import create_work_tasks_router

__all__ = [
    "create_auth_router",
    "create_credits_router",
    "create_history_router",
    "create_image_light_router",
    "create_image_router",
    "create_notifications_router",
    "create_provider_router",
    "create_qc_router",
    "create_reports_router",
    "create_system_router",
    "create_video_utility_router",
    "create_video_router",
    "create_work_tasks_router",
]
