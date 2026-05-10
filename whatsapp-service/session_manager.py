"""
WhatsApp Web browser session — persistent Chrome profile for one-time QR scan.

Requires Google Chrome (or Chromium) + matching ChromeDriver on PATH, or Selenium Manager.
On Render: set RENDER=true (headless). Locally: omit HEADLESS for a visible window.
"""

from __future__ import annotations

import os
import threading
from typing import Any

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.common.by import By

WA_URL = "https://web.whatsapp.com/"


def _use_headless() -> bool:
    if os.environ.get("RENDER"):
        return True
    return os.environ.get("HEADLESS", "").strip().lower() in ("1", "true", "yes", "on")


def _session_dir() -> str:
    base = os.environ.get("WHATSAPP_SESSION_DIR", "").strip()
    if base:
        return os.path.abspath(base)
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), "data", "whatsapp_session")
    )


class WhatsAppSessionManager:
    """Single browser instance; profile dir survives process restarts."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._driver: webdriver.Chrome | None = None

    def _new_driver(self) -> webdriver.Chrome:
        user_data_dir = _session_dir()
        os.makedirs(user_data_dir, exist_ok=True)

        opts = ChromeOptions()
        opts.add_argument(f"--user-data-dir={user_data_dir}")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_argument("--window-size=1280,840")
        if _use_headless():
            opts.add_argument("--headless=new")

        return webdriver.Chrome(options=opts)

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
        # Unauthenticated landing usually shows a QR canvas; heuristic only.
        try:
            return len(driver.find_elements(By.TAG_NAME, "canvas")) > 0
        except Exception:
            return False


_manager: WhatsAppSessionManager | None = None


def get_manager() -> WhatsAppSessionManager:
    global _manager
    if _manager is None:
        _manager = WhatsAppSessionManager()
    return _manager
