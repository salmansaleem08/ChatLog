"""
Per-business WhatsApp Web sessions: isolated profiles under <session_base>/<uuid>.

Use Chromium + chromedriver from the environment (Dockerfile sets CHROME_BIN /
CHROMEDRIVER_PATH). Selenium Manager fallback applies locally if paths unset.
On Render: RENDER=true → headless. Ephemeral /tmp profiles on free tier (no disk).
"""

from __future__ import annotations

import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, unquote, urlparse

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
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
        self._linked_phone_ttl_sec = float(
            os.environ.get("WHATSAPP_LINKED_PHONE_CACHE_SEC", "90")
        )
        self._linked_phone_cached: Optional[str] = None
        self._linked_phone_cached_at = 0.0

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
                driver = self._driver
                logged_in = self._detect_logged_in(driver)
                needs_qr = (not logged_in) and self._detect_qr_present(driver)
                linked = None
                if logged_in:
                    linked = self._read_linked_phone_cached(driver)
                return {
                    "running": True,
                    "logged_in": logged_in,
                    "needs_qr": needs_qr,
                    "linked_phone_e164": linked,
                }
            except Exception as exc:  # pragma: no cover
                return {
                    "running": True,
                    "logged_in": False,
                    "needs_qr": True,
                    "linked_phone_e164": None,
                    "error": str(exc),
                }

    def _read_linked_phone_cached(self, driver: webdriver.Chrome) -> Optional[str]:
        """Best-effort; cached to avoid opening menus on every status poll."""
        now = time.time()
        if (
            self._linked_phone_cached is not None
            and now - self._linked_phone_cached_at < self._linked_phone_ttl_sec
        ):
            return self._linked_phone_cached
        phone = self._read_linked_phone(driver)
        self._linked_phone_cached = phone
        self._linked_phone_cached_at = now
        return phone

    @staticmethod
    def _read_linked_phone(driver: webdriver.Chrome) -> Optional[str]:
        html = ""
        try:
            html = driver.page_source or ""
        except Exception:
            return None
        for pattern in (
            r'href="tel:([\d\s+\-()]{8,})"',
            r'<span[^>]*>(\+\d[\d\s\-\u2011\u00A0]{6,})</span>',
            r'(\+[1-9]\d{9,})',
            r'(00[\d\s\-]{11,})',
        ):
            m = re.search(pattern, html)
            if not m:
                continue
            raw = (m.group(1) if m.lastindex else m.group()).strip()
            normalized = "".join(ch for ch in raw if ch.isdigit() or ch == "+")
            if normalized.startswith("00"):
                normalized = "+" + normalized[2:]
                normalized = "+" + "".join(ch for ch in normalized if ch.isdigit())
            elif not normalized.startswith("+"):
                digits = "".join(ch for ch in normalized if ch.isdigit())
                if len(digits) < 10:
                    continue
                normalized = "+" + digits
            if len(normalized) < 10:
                continue
            return normalized
        return None

    def list_chats(self, scroll_rounds: int = 32) -> List[Dict[str, Any]]:
        with self._lock:
            driver = self._driver
            if driver is None:
                raise RuntimeError("driver_not_initialized")
            if not self._detect_logged_in(driver):
                raise RuntimeError("not_logged_in")
            driver.set_page_load_timeout(120)
            if not str(driver.current_url or "").startswith(WA_URL):
                driver.get(WA_URL)

            try:
                WebDriverWait(driver, 65).until(
                    EC.presence_of_element_located(
                        (By.CSS_SELECTOR, '[data-testid="chat-list"]')
                    )
                )
            except Exception as exc:
                raise RuntimeError("chat_list_timeout") from exc

            aggregated: Dict[str, Dict[str, Any]] = {}
            for _round in range(max(1, scroll_rounds)):
                self._capture_chat_rows(driver, aggregated)
                try:
                    side = driver.find_element(By.CSS_SELECTOR, "#pane-side")
                    driver.execute_script(
                        "arguments[0].scrollTop = arguments[0].scrollHeight;", side
                    )
                except Exception:
                    driver.execute_script("window.scrollBy(0, 600)")
                time.sleep(0.18)

            self._capture_chat_rows(driver, aggregated)

            chats: List[Dict[str, Any]] = list(aggregated.values())

            def _sort_key(entry: Dict[str, Any]):
                ms = entry.get("last_message_at_ms") or 0
                return int(ms)

            chats.sort(key=_sort_key, reverse=True)
            return chats

    @staticmethod
    def _jid_from_chat_href(url: str) -> Optional[str]:
        if "/chat/" not in url:
            return None
        try:
            path = urlparse(url).path
            raw = path.split("/chat/", 1)[1].split("/", 1)[0]
            jid = unquote(raw).split("?", 1)[0].strip()
            if not jid:
                return None
            if jid.endswith("@g.us"):
                return None
            return jid
        except Exception:
            return None

    def _capture_chat_rows(
        self, driver: webdriver.Chrome, out: Dict[str, Dict[str, Any]]
    ) -> None:
        rows = driver.find_elements(
            By.CSS_SELECTOR,
            '[data-testid="cell-frame-container"]',
        )
        for row in rows:
            try:
                link_el = None
                for sel in ('a[href*="/chat/"]', '[role="row"] a[href*="/chat/"]'):
                    found = row.find_elements(By.CSS_SELECTOR, sel)
                    if found:
                        link_el = found[0]
                        break
                if link_el is None:
                    continue
                href = (link_el.get_attribute("href") or "").strip()
                jid = self._jid_from_chat_href(href)
                if not jid or jid.endswith("@g.us"):
                    continue

                digits = "".join(ch for ch in jid.split("@")[0] if ch.isdigit())
                title_el = row.find_elements(By.CSS_SELECTOR, '[data-testid="cell-frame-title"]')
                name = ""
                if title_el:
                    name = (title_el[0].text or "").strip()

                prev_el = row.find_elements(By.CSS_SELECTOR, '[data-testid="last-msg-status"]')
                preview = ""
                if prev_el:
                    preview = (prev_el[0].text or "").strip()

                meta_el = row.find_elements(By.CSS_SELECTOR, '[data-testid="cell-frame-meta"]')
                meta_text = ""
                meta_title_attr = ""
                if meta_el:
                    meta_text = (meta_el[0].text or "").strip()
                    meta_title_attr = (meta_el[0].get_attribute("title") or "").strip()

                last_ms = self._parse_sidebar_time(meta_text, meta_title_attr)
                display_name = name or ("+" + digits if digits else "Contact")

                out[jid] = {
                    "chat_jid": jid,
                    "phone_digits": digits,
                    "display_name": display_name,
                    "last_message_preview": preview,
                    "last_message_at_ms": last_ms or 0,
                }
            except Exception:
                continue

    @staticmethod
    def _parse_sidebar_time(label: str, title_attr: str) -> Optional[int]:
        iso_candidates = []
        if title_attr:
            iso_candidates.extend(re.findall(r"20\d\d-\d{2}-\d{2}[ T]\d{2}:\d{2}", title_attr))

        dt = None
        for cand in iso_candidates[:3]:
            for fmt in (
                "%Y-%m-%d %H:%M",
                "%Y-%m-%dT%H:%M",
            ):
                try:
                    dt = datetime.strptime(cand, fmt).replace(tzinfo=timezone.utc)
                    break
                except ValueError:
                    continue
            if dt is not None:
                break

        txt = label.lower()
        now = datetime.now(timezone.utc)
        if dt is None and any(x in txt for x in ("now", "just now")):
            return int(now.timestamp() * 1000)
        if dt is None and "today" in txt:
            m = re.search(r"(\d{1,2}):(\d{2})", label)
            if m:
                h, mi = int(m.group(1)), int(m.group(2))
                d = datetime(
                    now.year, now.month, now.day, h, mi, tzinfo=timezone.utc
                ).timestamp()
                return int(d * 1000)
        if dt is not None:
            return int(dt.timestamp() * 1000)
        return None

    @staticmethod
    def _jid_suffix_for_chat_url(jid: str) -> str:
        jid = (jid or "").strip()
        if not jid:
            raise ValueError("jid_required")
        if jid.endswith("@g.us"):
            raise ValueError("group_chat_unsupported")
        if "@" not in jid:
            digits = "".join(ch for ch in jid if ch.isdigit())
            if len(digits) < 10:
                raise ValueError("invalid_chat_jid")
            return f"{digits}@c.us"
        return jid

    @staticmethod
    def _message_timestamp_ms(container: Any) -> int:
        data_id = str(container.get_attribute("data-id") or "")
        m = re.search(r"_(\d{10,})\b", data_id)
        if m:
            raw = int(m.group(1))
            if raw < 400_000_000_000:
                raw *= 1000
            try:
                return raw
            except Exception:
                pass
        return int(time.time() * 1000)

    def fetch_chat_messages(self, chat_jid: str, max_messages: int = 260) -> Dict[str, Any]:
        normalized = self._jid_suffix_for_chat_url(chat_jid)

        with self._lock:
            driver = self._driver
            if driver is None:
                raise RuntimeError("driver_not_initialized")
            if not self._detect_logged_in(driver):
                raise RuntimeError("not_logged_in")

            slug = quote(normalized, safe="")
            target = WA_URL.rstrip("/") + f"/chat/{slug}"
            driver.set_page_load_timeout(120)
            driver.get(target)

            try:
                WebDriverWait(driver, 85).until(
                    EC.presence_of_element_located(
                        (
                            By.CSS_SELECTOR,
                            '[data-testid="conversation-panel-wrapper"], '
                            '[data-testid="conversation-panel-messages"]',
                        )
                    )
                )
            except Exception as exc:
                raise RuntimeError("conversation_timeout") from exc

            deadline = time.time() + 12.0
            while time.time() < deadline:
                driver.execute_script(
                    "const main=document.querySelector('#main');"
                    "if(main){main.scrollTop=Math.max(0,main.scrollTop-1400)}"
                )
                time.sleep(0.28)

            containers = driver.find_elements(
                By.CSS_SELECTOR,
                '[data-testid="msg-container"]',
            )

            lines: List[str] = []
            latest_seen_ms = -1

            for c in containers[-max_messages:]:
                try:
                    out = bool(
                        c.find_elements(
                            By.XPATH,
                            ".//*[contains(@class,'message-out')]",
                        )
                    )
                    role = "You" if out else "Customer"

                    spans = c.find_elements(
                        By.CSS_SELECTOR, "span.selectable-text.copyable-text span"
                    )
                    if not spans:
                        spans = c.find_elements(
                            By.CSS_SELECTOR, ".selectable-text span"
                        )
                    text = " ".join(
                        (sp.text or "").strip() for sp in spans if (sp.text or "").strip()
                    )

                    prefix = ""
                    for meta in c.find_elements(By.CSS_SELECTOR, "[data-pre-plain-text]"):
                        pv = meta.get_attribute("data-pre-plain-text") or ""
                        pv = pv.replace("\xa0", " ").strip()
                        if pv:
                            prefix = pv.split("\n")[0][:120]

                    ms = self._message_timestamp_ms(c)
                    if ms > latest_seen_ms:
                        latest_seen_ms = ms

                    snippet = (
                        f"[{ms}] {role}: {prefix + ' • ' if prefix else ''}"
                        + (text or "").replace("\n", " ").strip()
                    ).strip()
                    lines.append(snippet)
                except Exception:
                    continue

            transcript = "\n".join(line for line in lines if line)
            fallback_ms = latest_seen_ms if latest_seen_ms > 0 else int(time.time() * 1000)
            latest_iso = datetime.fromtimestamp(
                fallback_ms / 1000, tz=timezone.utc
            ).isoformat()
            return {
                "chat_jid": normalized,
                "transcript": transcript,
                "latest_message_iso": latest_iso,
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
