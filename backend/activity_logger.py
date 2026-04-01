"""Backend shim for unified activity logger."""
import os
import sys


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from app_core.activity_logger import (  # noqa: E402
    event_group,
    event_label,
    log_activity,
    log_event,
    normalize_event,
)

