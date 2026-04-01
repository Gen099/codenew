import os
import shutil
import socket
import subprocess
import sys
import time
import traceback

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
LOG_DIR = os.path.join(BASE_DIR, "logs")
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
GUI_DIR = os.path.join(BASE_DIR, "gui")
GUI_APP = os.path.join(BASE_DIR, "gui", "app.py")
ENV_FILE = os.path.join(BASE_DIR, ".env")

DEFAULT_MODE = "standalone"
DEFAULT_BACKEND_HOST = "127.0.0.1"
DEFAULT_BACKEND_PORT = 8012
DEFAULT_BACKEND_RELOAD = "0"


def get_runtime_mode() -> str:
    return (os.getenv("VIDEOTOOL_MODE") or DEFAULT_MODE).strip().lower()


def get_backend_host() -> str:
    return (os.getenv("VIDEOTOOL_BACKEND_HOST") or DEFAULT_BACKEND_HOST).strip() or DEFAULT_BACKEND_HOST


def get_backend_port() -> int:
    raw = (os.getenv("VIDEOTOOL_BACKEND_PORT") or str(DEFAULT_BACKEND_PORT)).strip()
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_BACKEND_PORT


def get_api_base_url(host: str, port: int) -> str:
    value = (os.getenv("VIDEOTOOL_API_BASE_URL") or "").strip()
    if value:
        return value
    return f"http://{host}:{port}"


def log_error(error_msg: str) -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    log_path = os.path.join(LOG_DIR, "crash.log")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {error_msg}\n\n")

    try:
        from activity_logger import log_activity

        log_activity("SYSTEM_LAUNCHER", "CRASH_REPORT", error_msg)
    except Exception:
        pass


def _candidate_python_paths(windowless: bool = False) -> list[str]:
    names = ["pythonw.exe", "python.exe"] if windowless else ["python.exe", "pythonw.exe"]
    candidates: list[str] = []

    for name in names:
        candidates.append(os.path.join(BASE_DIR, ".venv", "Scripts", name))

    if sys.executable:
        exe_dir = os.path.dirname(sys.executable)
        exe_name = os.path.basename(sys.executable).lower()
        if exe_name in ("python.exe", "pythonw.exe"):
            preferred = "pythonw.exe" if windowless else "python.exe"
            candidates.append(os.path.join(exe_dir, preferred))
        candidates.append(sys.executable)

    for name in names:
        found = shutil.which(name)
        if found:
            candidates.append(found)

    unique: list[str] = []
    seen = set()
    for path in candidates:
        if not path:
            continue
        key = os.path.normcase(os.path.abspath(path))
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def resolve_python(windowless: bool = False) -> str:
    for path in _candidate_python_paths(windowless=windowless):
        if os.path.exists(path):
            return path
    raise RuntimeError("Python interpreter not found. Install Python or create .venv before starting VideoTool.")


def clear_runtime_caches() -> None:
    for root_dir in (BACKEND_DIR, GUI_DIR):
        if not os.path.isdir(root_dir):
            continue
        for current_root, dirnames, _filenames in os.walk(root_dir):
            for dirname in list(dirnames):
                if dirname != "__pycache__":
                    continue
                cache_dir = os.path.join(current_root, dirname)
                try:
                    shutil.rmtree(cache_dir, ignore_errors=True)
                except Exception:
                    pass


def wait_for_backend(proc: subprocess.Popen, host: str, port: int, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.5)
        try:
            if sock.connect_ex((host, port)) == 0:
                return True
        finally:
            sock.close()
        time.sleep(0.25)
    return False


def should_start_local_backend(mode: str) -> bool:
    return mode in ("standalone", "local")


def is_port_listening(host: str, port: int, timeout: float = 0.5) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        return sock.connect_ex((host, port)) == 0
    finally:
        sock.close()


def open_backend_log_handle() -> tuple[object, str]:
    """Open writable backend log with lock-safe fallback for Windows."""
    candidates = (
        os.path.join(LOG_DIR, "backend.log"),
        os.path.join(LOG_DIR, "backend_manual.log"),
    )
    last_exc = None
    for path in candidates:
        try:
            return open(path, "a", encoding="utf-8"), path
        except PermissionError as exc:
            last_exc = exc
            continue
    if last_exc:
        # Final fallback to null sink so launcher can still run GUI.
        return open(os.devnull, "w", encoding="utf-8"), os.devnull
    return open(os.path.join(LOG_DIR, "backend_manual.log"), "a", encoding="utf-8"), os.path.join(LOG_DIR, "backend_manual.log")


def main() -> int:
    backend_proc = None
    backend_log = None
    backend_log_path = None
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        if not os.path.exists(ENV_FILE):
            print("[WARN] Missing .env file. Copy .env.example to .env and fill in your settings.")

        mode = get_runtime_mode()
        backend_host = get_backend_host()
        backend_port = get_backend_port()
        api_base_url = get_api_base_url(backend_host, backend_port)

        python_exe = resolve_python(windowless=False)
        clear_runtime_caches()

        env = os.environ.copy()
        env["VIDEOTOOL_MODE"] = mode
        env["VIDEOTOOL_BACKEND_HOST"] = backend_host
        env["VIDEOTOOL_BACKEND_PORT"] = str(backend_port)
        env["VIDEOTOOL_BACKEND_RELOAD"] = (env.get("VIDEOTOOL_BACKEND_RELOAD") or DEFAULT_BACKEND_RELOAD).strip() or DEFAULT_BACKEND_RELOAD
        env["VIDEOTOOL_API_BASE_URL"] = api_base_url

        backend_log, backend_log_path = open_backend_log_handle()
        runtime_summary = (
            f"mode={mode} | backend_host={backend_host} | backend_port={backend_port} | "
            f"api_base={api_base_url} | reload={env['VIDEOTOOL_BACKEND_RELOAD']}"
        )
        backend_log.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Launcher runtime: {runtime_summary}\n")
        backend_log.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Cleared __pycache__ in backend/gui\n")
        backend_log.flush()
        print(f"[runtime] {runtime_summary}")
        if backend_log_path and os.path.basename(backend_log_path).lower() != "backend.log":
            print(f"[runtime] backend_log_fallback={backend_log_path}")

        if should_start_local_backend(mode):
            if is_port_listening(backend_host, backend_port):
                print(f"[runtime] backend already listening on {backend_host}:{backend_port}, skip local spawn")
            else:
                backend_proc = subprocess.Popen(
                    [python_exe, "main.py"],
                    cwd=BACKEND_DIR,
                    stdout=backend_log,
                    stderr=subprocess.STDOUT,
                    env=env,
                )

                if not wait_for_backend(backend_proc, backend_host, backend_port):
                    raise RuntimeError(
                        f"Backend did not start on {backend_host}:{backend_port} within 20 seconds. "
                        "Check logs/backend.log for details."
                    )

        gui_result = subprocess.run([python_exe, GUI_APP], cwd=BASE_DIR, check=False, env=env)
        if gui_result.returncode != 0:
            raise RuntimeError(f"GUI exited with code {gui_result.returncode}.")
        return 0

    except Exception:
        error_msg = traceback.format_exc().strip()
        print(error_msg)
        log_error(error_msg)
        return 1
    finally:
        if backend_proc is not None:
            try:
                backend_proc.terminate()
                backend_proc.wait(timeout=5)
            except Exception:
                try:
                    backend_proc.kill()
                except Exception:
                    pass
        if backend_log is not None:
            backend_log.close()


if __name__ == "__main__":
    raise SystemExit(main())
