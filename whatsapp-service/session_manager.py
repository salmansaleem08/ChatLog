"""
Per-business WhatsApp Web sessions: isolated profiles under <session_base>/<uuid>.

Use Chromium + chromedriver from the environment (Dockerfile sets CHROME_BIN /
CHROMEDRIVER_PATH). Selenium Manager fallback applies locally if paths unset.
On Render: RENDER=true → headless. Ephemeral /tmp profiles on free tier (no disk).
"""

from __future__ import annotations

import os
import threading
import uuid
from typing import Any

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By

WA_URL = "https://web.whatsapp.com/"

_registry: dict[str, "WhatsAppSessionManager"] = {}
_registry_lock = threading.Lock()


def _use_headless() -> bool:
    if os.environ.get("RENDER"):
        return True
    return os.environ.get("HEADLESS", "").strip().lower() in ("1", "true", "yes", "on")


def _session_base_dir() -> str:
    """
    Prefer WHATSAPP_SESSION_DIR when set and writable (paid Render disk, local path).
    On Render without a disk, /var/data/... often fails — fall back to /tmp (ephemeral).
    """
    base = os.environ.get("WHATSAPP_SESSION_DIR", "").strip()
    if base:
        path = os.path.abspath(base)
        try:
            os.makedirs(path, exist_ok=True)
            return path
        except OSError:
            pass

    if os.environ.get("RENDER"):
        path = os.path.abspath("/tmp/chatlog_whatsapp_sessions")
        os.makedirs(path, exist_ok=True)
        return path

    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), "data", "whatsapp_sessions")
    )


def normalize_business_id(raw: str) -> str:
    return str(uuid.UUID((raw or "").strip()))


def get_manager(business_id: str) -> "WhatsAppSessionManager":
    bid = normalize_business_id(business_id)
    with _registry_lock:
        if bid not in _registry:
            _registry[bid] = WhatsAppSessionManager(bid)
        return _registry[bid]


class WhatsAppSessionManager:
    """One Chrome instance per business_id; profile dir survives process restarts."""

    def __init__(self, business_id: str) -> None:
        self._business_id = business_id
        self._lock = threading.Lock()
        self._driver: webdriver.Chrome | None = None

    def _user_data_dir(self) -> str:
        path = os.path.join(_session_base_dir(), self._business_id)
        os.makedirs(path, exist_ok=True)
        return path

    def _new_driver(self) -> webdriver.Chrome:
        opts = ChromeOptions()
        chrome_bin = os.environ.get("CHROME_BIN", "").strip()
        if chrome_bin:
            opts.binary_location = chrome_bin

        opts.add_argument(f"--user-data-dir={self._user_data_dir()}")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--disable-gpu")
        opts.add_argument("--disable-software-rasterizer")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_argument("--window-size=1280,840")
        if _use_headless():
            opts.add_argument("--headless=new")

        driver_path = os.environ.get("CHROMEDRIVER_PATH", "").strip()
        service = (
            Service(executable_path=driver_path) if driver_path else Service()
        )
        return webdriver.Chrome(service=service, options=opts)

    def ensure_started(self) -> None:
        with self._lock:
            if self._driver is not None:
                try:
                    _ = self._driver.current_url
                    return
                except Exception:
                    try:
                        self._driver.quit()
                    except Exception:
                        pass
                    self._driver = None

            self._driver = self._new_driver()
            self._driver.get(WA_URL)

    def get_status(self) -> dict[str, Any]:
        with self._lock:
            if self._driver is None:
                return {
                    "running": False,
                    "logged_in": False,
                    "needs_qr": False,
                }

            try:
                logged_in = self._detect_logged_in(self._driver)
                needs_qr = (not logged_in) and self._detect_qr_present(self._driver)
                return {
                    "running": True,
                    "logged_in": logged_in,
                    "needs_qr": needs_qr,
                }
            except Exception as exc:  # pragma: no cover
                return {
                    "running": True,
                    "logged_in": False,
                    "needs_qr": True,
                    "error": str(exc),
                }

    def get_qr_png(self) -> bytes | None:
        """PNG screenshot of first canvas (WhatsApp QR), if present."""
        with self._lock:
            if self._driver is None:
                return None
            try:
                canvases = self._driver.find_elements(By.CSS_SELECTOR, "canvas")
                if not canvases:
                    return None
                return canvases[0].screenshot_as_png
            except Exception:
                return None

    @staticmethod
    def _detect_logged_in(driver: webdriver.Chrome) -> bool:
        selectors = (
            '[data-testid="chat-list"]',
            '[data-testid="conversation-panel-wrapper"]',
            '[data-testid="default-user"]',
        )
        for sel in selectors:
            if driver.find_elements(By.CSS_SELECTOR, sel):
                return True
        return False

    @staticmethod
    def _detect_qr_present(driver: webdriver.Chrome) -> bool:
        try:
            return len(driver.find_elements(By.TAG_NAME, "canvas")) > 0
        except Exception:
            return False
