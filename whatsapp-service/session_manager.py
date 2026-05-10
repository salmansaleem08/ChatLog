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
from typing import Any, Dict, List, Optional, Tuple

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

WA_URL = "https://web.whatsapp.com/"

# WhatsApp paints the login QR asynchronously; instant canvas queries often miss it.
_QR_WAIT_SEC = float(os.environ.get("WHATSAPP_QR_WAIT_SEC", "40"))
_QR_MIN_SIDE = 80

_registry: Dict[str, "WhatsAppSessionManager"] = {}
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
        self._driver: Optional[webdriver.Chrome] = None

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
        opts.add_argument("--window-size=1280,900")
        opts.add_argument("--lang=en-US")
        opts.add_argument(
            "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        )
        # Softer automation footprint — WhatsApp may hide QR when flags look bot-like.
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        opts.add_experimental_option("useAutomationExtension", False)
        if _use_headless():
            opts.add_argument("--headless=new")
            # Keep GPU path; some sites render blank canvases with disable-gpu in Docker.
            opts.add_argument("--disable-software-rasterizer")
            opts.add_argument("--run-all-compositor-stages-before-draw")

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
            self._driver.set_page_load_timeout(120)
            self._driver.get(WA_URL)

    def get_status(self) -> Dict[str, Any]:
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

    def get_qr_png(self) -> Optional[bytes]:
        """PNG of the login QR canvas after it has rendered (waits up to _QR_WAIT_SEC)."""
        with self._lock:
            if self._driver is None:
                return None
            driver = self._driver

            def _qr_canvas_ready(d: webdriver.Chrome):
                if self._detect_logged_in(d):
                    return True
                el = self._pick_qr_canvas(d)
                return el if el is not None else False

            def _capture() -> Optional[bytes]:
                wait = WebDriverWait(driver, _QR_WAIT_SEC, poll_frequency=0.45)
                wait.until(_qr_canvas_ready)
                if self._detect_logged_in(driver):
                    return None
                fresh = self._pick_qr_canvas(driver)
                if fresh is None:
                    return None
                return fresh.screenshot_as_png

            try:
                return _capture()
            except Exception:
                try:
                    driver.refresh()
                    return _capture()
                except Exception:
                    return None

    @staticmethod
    def _pick_qr_canvas(driver: webdriver.Chrome):
        """Choose the largest plausible QR canvas (WhatsApp often has several tiny canvases)."""
        scored: List[Tuple[bool, float, Any]] = []
        for el in driver.find_elements(By.CSS_SELECTOR, "canvas"):
            try:
                size = el.size
                w = float(size.get("width") or 0)
                h = float(size.get("height") or 0)
                if w < _QR_MIN_SIDE or h < _QR_MIN_SIDE:
                    continue
                area = w * h
                try:
                    vis = el.is_displayed()
                except Exception:
                    vis = True
                scored.append((vis, area, el))
            except Exception:
                continue
        if not scored:
            return None
        visible = [t for t in scored if t[0]]
        pool = visible if visible else scored
        pool.sort(key=lambda t: t[1], reverse=True)
        return pool[0][2]

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
