"""
Per-business WhatsApp Web sessions: isolated profiles under <session_base>/<uuid>.

Use Chromium + chromedriver from the environment (Dockerfile sets CHROME_BIN /
CHROMEDRIVER_PATH). Selenium Manager fallback applies locally if paths unset.
On Render: RENDER=true → headless. Ephemeral /tmp profiles on free tier (no disk).
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, quote, unquote, urlparse

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

WA_URL = "https://web.whatsapp.com/"

log = logging.getLogger("chatlog.whatsapp")

# WhatsApp paints the login QR asynchronously; instant canvas queries often miss it.
_QR_WAIT_SEC = float(os.environ.get("WHATSAPP_QR_WAIT_SEC", "40"))
_QR_MIN_SIDE = 80

_registry: Dict[str, "WhatsAppSessionManager"] = {}
_registry_lock = threading.Lock()


def _use_headless() -> bool:
    if os.environ.get("RENDER"):
        return True
    return os.environ.get("HEADLESS", "").strip().lower() in ("1", "true", "yes", "on")


def _should_open_link_tab() -> bool:
    """
    Open a fresh WhatsApp Web tab and close the old one (visible browser only).
    Helps QR / main UI paint reliably; disabled on headless hosting.
    """
    raw = os.environ.get("WHATSAPP_OPEN_LINK_TAB", "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    return not _use_headless() and not os.environ.get("RENDER")


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
        self._lock = threading.RLock()
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
            if not _use_headless():
                try:
                    self._driver.maximize_window()
                except Exception:
                    try:
                        self._driver.set_window_size(1400, 900)
                    except Exception:
                        pass

    def bring_up_linking_surface_for_scan(self) -> None:
        """
        Call after /whatsapp/session/start: maximize visible window and optionally
        move session to a fresh tab so linking matches what users see in a normal browser.
        """
        with self._lock:
            driver = self._driver
            if driver is None:
                return
            if not _use_headless():
                try:
                    driver.maximize_window()
                except Exception:
                    try:
                        driver.set_window_size(1400, 900)
                    except Exception:
                        pass
            if not _should_open_link_tab():
                return
            try:
                previous = driver.current_window_handle
                driver.execute_script("window.open(arguments[0], '_blank');", WA_URL)
                time.sleep(1.0)
                handles = driver.window_handles
                if len(handles) < 2:
                    log.info(
                        "link_tab skipped business_id=%s (single window)",
                        self._business_id,
                    )
                    return
                driver.switch_to.window(previous)
                try:
                    driver.close()
                except Exception:
                    pass
                remaining = driver.window_handles
                if not remaining:
                    log.warning(
                        "link_tab lost all windows business_id=%s", self._business_id
                    )
                    return
                driver.switch_to.window(remaining[0])
                time.sleep(0.35)
                log.info(
                    "link_tab fresh_whatsapp_tab business_id=%s", self._business_id
                )
            except Exception:
                log.warning(
                    "link_tab failed business_id=%s", self._business_id, exc_info=True
                )

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
    def _normalize_e164_candidate(raw: str) -> Optional[str]:
        raw = (raw or "").strip()
        if not raw:
            return None
        normalized = "".join(ch for ch in raw if ch.isdigit() or ch == "+")
        if normalized.startswith("00"):
            digits = "".join(ch for ch in normalized if ch.isdigit())
            if len(digits) < 10:
                return None
            return "+" + digits[2:]
        if not normalized.startswith("+"):
            digits = "".join(ch for ch in normalized if ch.isdigit())
            if len(digits) < 10:
                return None
            normalized = "+" + digits
        digits = "".join(ch for ch in normalized if ch.isdigit())
        if len(digits) < 10:
            return None
        return "+" + digits

    @classmethod
    def _extract_phones_from_html(cls, html: str) -> List[str]:
        found: List[str] = []
        for m in re.finditer(r'href="tel:([^"]+)"', html, flags=re.I):
            p = cls._normalize_e164_candidate(m.group(1))
            if p:
                found.append(p)
        for m in re.finditer(
            r"<span[^>]*>(\+\d[\d\s\-\u2011\u00A0]{6,})</span>", html
        ):
            p = cls._normalize_e164_candidate(m.group(1))
            if p:
                found.append(p)
        for m in re.finditer(r"\b(\+[1-9]\d{6,14})\b", html):
            p = cls._normalize_e164_candidate(m.group(1))
            if p:
                found.append(p)
        for m in re.finditer(r"\b(00[\d\s\-]{11,})\b", html):
            p = cls._normalize_e164_candidate(m.group(1))
            if p:
                found.append(p)
        return found

    @classmethod
    def _read_linked_phone(cls, driver: webdriver.Chrome) -> Optional[str]:
        """
        Prefer numbers near the signed-in header — full-page regex hits ads/support
        and shows the wrong 'linked' line.
        """
        fragments: List[str] = []
        try:
            for sel in ('[data-testid="default-user"]', "header"):
                for el in driver.find_elements(By.CSS_SELECTOR, sel)[:3]:
                    try:
                        fragments.append(el.get_attribute("outerHTML") or "")
                    except Exception:
                        pass
        except Exception:
            pass
        if not fragments:
            try:
                src = driver.page_source or ""
                fragments.append(src[-40000:])
            except Exception:
                return None
        combined = "\n".join(fragments)
        phones = cls._extract_phones_from_html(combined)
        if not phones:
            return None
        # Longest national number first — avoids short spurious matches.
        phones.sort(key=lambda p: len(re.sub(r"\D", "", p)), reverse=True)
        return phones[0]

    def _wait_ready_for_chat_list(self, driver: webdriver.Chrome, timeout: float = 55.0) -> None:
        """
        WhatsApp often paints the sidebar after first paint; avoid false not_logged_in.
        If a QR canvas is stable while the chat list never appears, treat as logged out.
        """
        started = time.time()
        deadline = started + timeout
        qr_streak = 0
        last_log = started
        refreshed = False
        while time.time() < deadline:
            try:
                url = str(driver.current_url or "")[:120]
            except Exception:
                url = "(url_unavailable)"
            if self._detect_logged_in(driver):
                log.info(
                    "wait_chat_list_ready ok business_id=%s url=%s",
                    self._business_id,
                    url,
                )
                return
            # Large QR only — tiny canvases during load caused false "logged out".
            has_login_qr = self._pick_qr_canvas(driver) is not None
            if has_login_qr:
                qr_streak += 1
            else:
                qr_streak = 0
            if qr_streak >= 4:
                log.warning(
                    "wait_chat_list_ready qr_only business_id=%s url=%s",
                    self._business_id,
                    url,
                )
                raise RuntimeError("not_logged_in")
            now = time.time()
            if now - last_log >= 10:
                log.info(
                    "wait_chat_list_ready pending business_id=%s url=%s login_qr=%s",
                    self._business_id,
                    url,
                    has_login_qr,
                )
                last_log = now
            if not refreshed and now - started > 12:
                try:
                    driver.refresh()
                    refreshed = True
                except Exception:
                    pass
            time.sleep(0.45)
        try:
            tail_url = str(driver.current_url or "")[:120]
        except Exception:
            tail_url = "(url_unavailable)"
        log.warning(
            "wait_chat_list_ready timeout business_id=%s url=%s",
            self._business_id,
            tail_url,
        )
        raise RuntimeError("chat_list_timeout")

    def list_chats(self, scroll_rounds: int = 32) -> List[Dict[str, Any]]:
        with self._lock:
            driver = self._driver
            if driver is None:
                raise RuntimeError("driver_not_initialized")
            driver.set_page_load_timeout(120)
            if not str(driver.current_url or "").startswith(WA_URL):
                driver.get(WA_URL)
            self._wait_ready_for_chat_list(driver)

            try:
                WebDriverWait(driver, 65).until(
                    EC.presence_of_element_located(
                        (By.CSS_SELECTOR, '[data-testid="chat-list"]')
                    )
                )
            except Exception as exc:
                log.warning(
                    "list_chats sidebar_wait_failed business_id=%s",
                    self._business_id,
                    exc_info=True,
                )
                raise RuntimeError("chat_list_timeout") from exc

            try:
                driver.set_window_size(1400, 900)
            except Exception:
                pass

            # Rows often appear a moment after the chat-list shell mounts.
            try:
                WebDriverWait(driver, 25).until(
                    lambda d: len(
                        d.find_elements(
                            By.CSS_SELECTOR,
                            '[data-testid="cell-frame-container"]',
                        )
                    )
                    >= 1
                )
            except Exception:
                log.info(
                    "list_chats no_chat_rows_yet business_id=%s (will still scrape)",
                    self._business_id,
                )

            aggregated: Dict[str, Dict[str, Any]] = {}
            for _round in range(max(1, scroll_rounds)):
                self._capture_chat_rows(driver, aggregated)
                self._capture_chat_rows_from_pane_links(driver, aggregated)
                self._scroll_chat_pane_to_end(driver)
                time.sleep(0.22)

            self._capture_chat_rows(driver, aggregated)
            self._capture_chat_rows_from_pane_links(driver, aggregated)

            chats: List[Dict[str, Any]] = list(aggregated.values())

            def _sort_key(entry: Dict[str, Any]):
                ms = entry.get("last_message_at_ms") or 0
                return int(ms)

            chats.sort(key=_sort_key, reverse=True)
            if not chats:
                self._log_list_chats_empty_diagnostics(driver)
            log.info(
                "list_chats ok business_id=%s count=%s",
                self._business_id,
                len(chats),
            )
            return chats

    @staticmethod
    def _jid_from_chat_href(url: str) -> Optional[str]:
        if "/chat/" not in url and "chat/" not in url:
            return None
        try:
            # Full URL or path-only (SPA sometimes uses relative paths).
            if "http" in url:
                path = urlparse(url).path
            else:
                path = url.split("?", 1)[0]
            if "/chat/" not in path and path.startswith("chat/"):
                path = "/" + path
            if "/chat/" not in path:
                return None
            raw = path.split("/chat/", 1)[1].split("/", 1)[0]
            jid = unquote(unquote(raw)).split("?", 1)[0].strip()
            if not jid:
                return None
            if jid.endswith("@g.us"):
                return None
            return jid
        except Exception:
            return None

    @staticmethod
    def _normalize_jid_candidate(raw: str) -> Optional[str]:
        raw = (raw or "").strip()
        if not raw or raw.endswith("@g.us"):
            return None
        if "@" in raw:
            return raw
        digits = "".join(ch for ch in raw if ch.isdigit())
        if len(digits) >= 8:
            return f"{digits}@c.us"
        return None

    @classmethod
    def _jid_from_row_html_fragment(cls, html: str) -> Optional[str]:
        """
        WhatsApp often omits <a href> on list rows; JID may still appear in markup
        (data attrs, inline paths, percent-encoded).
        """
        if not html:
            return None
        snippet = html[:450_000]
        patterns = (
            r'(?:https?://(?:web\.)?whatsapp\.com)?/chat/([^"\'\\&<>\s]+)',
            r'(?:\\?/|%2F)chat(?:\\?/|%2F)([^"\'\\&<>\s]+)',
        )
        for pat in patterns:
            for m in re.finditer(pat, snippet, flags=re.I):
                token = m.group(1).strip()
                token = unquote(unquote(token)).split("?")[0].split("#")[0]
                if not token or ".." in token:
                    continue
                jid = cls._normalize_jid_candidate(token)
                if jid:
                    return jid
        for m in re.finditer(
            r'(?:phone|PHONE)(?:=|%3D)(\d{10,15})(?:\D|$)', snippet
        ):
            jid = cls._normalize_jid_candidate(m.group(1))
            if jid:
                return jid
        for m in re.finditer(
            r'\b(\d{10,20}@[cs]\.(?:us|whatsapp\.net))\b', snippet, flags=re.I
        ):
            jid = cls._normalize_jid_candidate(m.group(1))
            if jid:
                return jid
        for m in re.finditer(
            r'["\']([A-Za-z0-9.\-+]+@(c\.us|s\.whatsapp\.net|lid))["\']',
            snippet,
            flags=re.I,
        ):
            cand = m.group(1)
            if cand.endswith("@g.us"):
                continue
            jid = cls._normalize_jid_candidate(cand)
            if jid:
                return jid
        return None

    @classmethod
    def _jid_from_cell_row_deep(cls, row: Any) -> Optional[str]:
        """Resolve chat JID when the row is not wrapped in a classic <a href=/chat/…>."""
        href_selectors = (
            'a[href*="/chat/"]',
            'a[href*="chat/"]',
            '[href*="/chat/"]',
            '[href*="chat/"]',
            'a[href*="send?phone="]',
            '[href*="send?phone="]',
            'a[href*="phone="]',
        )
        for sel in href_selectors:
            try:
                for el in row.find_elements(By.CSS_SELECTOR, sel):
                    href = (el.get_attribute("href") or "").strip()
                    if not href:
                        continue
                    jid = cls._jid_from_chat_href(href)
                    if jid:
                        return jid
                    if "phone=" in href.lower():
                        try:
                            q = parse_qs(urlparse(href).query)
                            for key in ("phone", "text"):
                                vals = q.get(key)
                                if vals and re.fullmatch(
                                    r"\d{10,15}", (vals[0] or "").strip()
                                ):
                                    return f"{vals[0].strip()}@c.us"
                        except Exception:
                            pass
            except Exception:
                pass
        try:
            html = row.get_attribute("outerHTML") or ""
        except Exception:
            html = ""
        return cls._jid_from_row_html_fragment(html)

    @staticmethod
    def _scroll_chat_pane_to_end(driver: webdriver.Chrome) -> None:
        """WhatsApp nests the scrollable list; scrolling #pane-side alone often does nothing."""
        try:
            driver.execute_script(
                """
                const pane = document.querySelector('#pane-side');
                if (!pane) { window.scrollBy(0, 800); return; }
                let best = pane;
                let bestScore = 0;
                const nodes = pane.querySelectorAll('div');
                for (let i = 0; i < nodes.length; i++) {
                    const n = nodes[i];
                    const sh = n.scrollHeight;
                    const ch = n.clientHeight;
                    if (sh > ch + 80 && sh > bestScore) {
                        bestScore = sh;
                        best = n;
                    }
                }
                best.scrollTop = best.scrollHeight;
                """
            )
        except Exception:
            try:
                driver.execute_script("window.scrollBy(0, 800)")
            except Exception:
                pass

    def _log_list_chats_empty_diagnostics(self, driver: webdriver.Chrome) -> None:
        """Paste-friendly line when logged in but no rows parsed."""
        try:
            cells = len(
                driver.find_elements(
                    By.CSS_SELECTOR, '[data-testid="cell-frame-container"]'
                )
            )
        except Exception:
            cells = -1
        try:
            pane_links = len(
                driver.find_elements(
                    By.CSS_SELECTOR, '#pane-side [href*="/chat/"]'
                )
            )
        except Exception:
            pane_links = -1
        try:
            any_chat_links = len(
                driver.find_elements(By.CSS_SELECTOR, '[href*="/chat/"]')
            )
        except Exception:
            any_chat_links = -1
        try:
            url = str(driver.current_url or "")[:160]
        except Exception:
            url = "(url_unavailable)"
        log.warning(
            "list_chats_empty business_id=%s url=%s cell_frame_containers=%s "
            "pane_side_chat_links=%s any_chat_links=%s",
            self._business_id,
            url,
            cells,
            pane_links,
            any_chat_links,
        )

    def _capture_chat_rows(
        self, driver: webdriver.Chrome, out: Dict[str, Dict[str, Any]]
    ) -> None:
        row_selectors = (
            '[data-testid="cell-frame-container"]',
            '[data-testid="cell-frame"]',
            '#pane-side [role="row"]',
        )
        rows: List[Any] = []
        seen_el: set[int] = set()
        for sel in row_selectors:
            for row in driver.find_elements(By.CSS_SELECTOR, sel):
                try:
                    rid = id(row)
                except Exception:
                    continue
                if rid in seen_el:
                    continue
                seen_el.add(rid)
                rows.append(row)
        for row in rows:
            try:
                link_el = None
                for sel in (
                    'a[href*="/chat/"]',
                    '[href*="/chat/"]',
                    '[role="row"] a[href*="/chat/"]',
                ):
                    found = row.find_elements(By.CSS_SELECTOR, sel)
                    if found:
                        link_el = found[0]
                        break
                jid: Optional[str] = None
                if link_el is not None:
                    href = (link_el.get_attribute("href") or "").strip()
                    jid = self._jid_from_chat_href(href)
                if not jid:
                    jid = self._jid_from_cell_row_deep(row)
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

    def _capture_chat_rows_from_pane_links(
        self, driver: webdriver.Chrome, out: Dict[str, Dict[str, Any]]
    ) -> None:
        """Fallback when cell-frame testids change but chat deep links still exist."""
        roots = driver.find_elements(By.CSS_SELECTOR, "#pane-side")
        if not roots:
            roots = driver.find_elements(By.CSS_SELECTOR, '[data-testid="chat-list"]')
        if not roots:
            return
        root = roots[0]
        try:
            links = root.find_elements(
                By.CSS_SELECTOR,
                'a[href*="/chat/"], [href*="/chat/"], a[href*="send?phone="]',
            )
        except Exception:
            return
        for link in links:
            try:
                href = (link.get_attribute("href") or "").strip()
                jid = self._jid_from_chat_href(href)
                if not jid and "phone=" in href.lower():
                    try:
                        q = parse_qs(urlparse(href).query)
                        ph = (q.get("phone") or [None])[0]
                        if ph and re.fullmatch(r"\d{10,15}", ph.strip()):
                            jid = f"{ph.strip()}@c.us"
                    except Exception:
                        pass
                if not jid or jid.endswith("@g.us"):
                    continue
                if jid in out:
                    continue
                container = link.find_elements(
                    By.XPATH,
                    './ancestor::div[@data-testid="cell-frame-container"][1]',
                )
                if container:
                    self._merge_row_from_container(container[0], jid, out)
                    if jid in out:
                        continue
                digits = "".join(ch for ch in jid.split("@")[0] if ch.isdigit())
                aria = (link.get_attribute("aria-label") or "").strip()
                title_attr = (link.get_attribute("title") or "").strip()
                text_bits = (link.text or "").strip()
                display_name = (
                    (aria or title_attr or text_bits).split("\n")[0].strip()
                    or ("+" + digits if digits else "Contact")
                )
                out[jid] = {
                    "chat_jid": jid,
                    "phone_digits": digits,
                    "display_name": display_name[:200],
                    "last_message_preview": "",
                    "last_message_at_ms": 0,
                }
            except Exception:
                continue

    def _merge_row_from_container(
        self,
        row: Any,
        jid: str,
        out: Dict[str, Dict[str, Any]],
    ) -> None:
        try:
            title_el = row.find_elements(
                By.CSS_SELECTOR, '[data-testid="cell-frame-title"]'
            )
            name = ""
            if title_el:
                name = (title_el[0].text or "").strip()

            prev_el = row.find_elements(
                By.CSS_SELECTOR, '[data-testid="last-msg-status"]'
            )
            preview = ""
            if prev_el:
                preview = (prev_el[0].text or "").strip()

            meta_el = row.find_elements(
                By.CSS_SELECTOR, '[data-testid="cell-frame-meta"]'
            )
            meta_text = ""
            meta_title_attr = ""
            if meta_el:
                meta_text = (meta_el[0].text or "").strip()
                meta_title_attr = (meta_el[0].get_attribute("title") or "").strip()

            last_ms = self._parse_sidebar_time(meta_text, meta_title_attr)
            digits = "".join(ch for ch in jid.split("@")[0] if ch.isdigit())
            display_name = name or ("+" + digits if digits else "Contact")

            out[jid] = {
                "chat_jid": jid,
                "phone_digits": digits,
                "display_name": display_name,
                "last_message_preview": preview,
                "last_message_at_ms": last_ms or 0,
            }
        except Exception:
            pass

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
                png = _capture()
                if not png:
                    log.warning(
                        "get_qr_png empty logged_in=%s canvas=%s",
                        WhatsAppSessionManager._detect_logged_in(driver),
                        WhatsAppSessionManager._pick_qr_canvas(driver) is not None,
                    )
                return png
            except Exception:
                try:
                    driver.refresh()
                    png = _capture()
                    if not png:
                        log.warning(
                            "get_qr_png empty after refresh logged_in=%s",
                            WhatsAppSessionManager._detect_logged_in(driver),
                        )
                    return png
                except Exception:
                    log.warning("get_qr_png failed after refresh", exc_info=True)
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
        """
        Must not treat an empty left rail (#pane-side) as logged-in — that breaks QR
        capture (thinks session is ready) and linked-phone scrape (picks random page numbers).
        """
        if driver.find_elements(By.CSS_SELECTOR, '[data-testid="default-user"]'):
            return True
        if driver.find_elements(
            By.CSS_SELECTOR, '[data-testid="conversation-panel-wrapper"]'
        ):
            return True
        if not driver.find_elements(By.CSS_SELECTOR, '[data-testid="chat-list"]'):
            return False
        if driver.find_elements(By.CSS_SELECTOR, '[data-testid="cell-frame-container"]'):
            return True
        if driver.find_elements(By.CSS_SELECTOR, '#pane-side a[href*="/chat/"]'):
            return True
        return False

    @staticmethod
    def _detect_qr_present(driver: webdriver.Chrome) -> bool:
        try:
            return len(driver.find_elements(By.TAG_NAME, "canvas")) > 0
        except Exception:
            return False
