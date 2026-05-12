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
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, quote, unquote, urlparse

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.action_chains import ActionChains
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


def _click_fallback_enabled() -> bool:
    """Slow / unreliable; only when explicitly enabled."""
    v = os.environ.get("WHATSAPP_CHAT_LIST_CLICK_FALLBACK", "0").strip().lower()
    return v in ("1", "true", "yes", "on")


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
        # Last-resort row click → URL JID during list_chats (cap per call).
        self._list_chats_row_click_budget = 0

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

    def disconnect(self, wipe_profile: bool = True) -> None:
        """Quit the browser and optionally delete on-disk Chrome profile for this workspace."""
        with self._lock:
            if self._driver is not None:
                try:
                    self._driver.quit()
                except Exception:
                    pass
                self._driver = None
            self._linked_phone_cached = None
            self._linked_phone_cached_at = 0.0
            if wipe_profile:
                p = self._user_data_dir()
                try:
                    shutil.rmtree(p, ignore_errors=True)
                except OSError as exc:
                    log.warning(
                        "disconnect rmtree failed business_id=%s err=%s",
                        self._business_id,
                        exc,
                    )
                try:
                    os.makedirs(p, exist_ok=True)
                except OSError:
                    pass
            log.info(
                "session_disconnected business_id=%s wiped=%s",
                self._business_id,
                wipe_profile,
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

    @staticmethod
    def _chrome_url_has_thread(url: str) -> bool:
        u = (url or "").lower()
        return "/chat/" in u or "send?phone=" in u

    # Structural selectors only — WhatsApp changes class names frequently.
    _SIDEBAR_ROW_SELECTORS: Tuple[str, ...] = (
        '[data-testid="cell-frame-container"]',
        '[data-testid="cell-frame"]',
        '#pane-side [role="row"]',
        '#pane-side [role="listitem"]',
        '[data-testid="chat-list"] [role="row"]',
        '[data-testid="chat-list"] [role="listitem"]',
        '#pane-side a[href*="/chat/"]',
        '#pane-side a[href*="send?phone="]',
    )

    def _gather_sidebar_candidate_rows(
        self, driver: webdriver.Chrome
    ) -> Tuple[List[Any], Dict[str, int]]:
        """
        Prefer a single canonical row node per chat. Nested selectors (cell-frame +
        role=row + chat-list row) triple-count the same visible rows and waste work.
        """
        seen: set[int] = set()
        rows: List[Any] = []
        counts: Dict[str, int] = {}
        primary = driver.find_elements(
            By.CSS_SELECTOR,
            '#pane-side [data-testid="cell-frame-container"]',
        )
        counts['#pane-side [data-testid="cell-frame-container"]'] = len(primary)
        if primary:
            for row in primary:
                try:
                    rid = id(row)
                except Exception:
                    continue
                if rid in seen:
                    continue
                seen.add(rid)
                rows.append(row)
            return rows, counts

        for sel in self._SIDEBAR_ROW_SELECTORS:
            found = driver.find_elements(By.CSS_SELECTOR, sel)
            counts[sel] = len(found)
            for row in found:
                try:
                    rid = id(row)
                except Exception:
                    continue
                if rid in seen:
                    continue
                seen.add(rid)
                rows.append(row)
        return rows, counts

    def _extract_row_display_name(self, row: Any) -> str:
        try:
            title_els = row.find_elements(
                By.CSS_SELECTOR, '[data-testid="cell-frame-title"]'
            )
            for el in title_els[:2]:
                tit = (el.get_attribute("title") or "").strip()
                txt = (el.text or "").strip()
                pick = tit if len(tit) >= len(txt) else txt
                if pick:
                    return pick.split("\n")[0].strip()
        except Exception:
            pass
        try:
            for el in row.find_elements(By.CSS_SELECTOR, "[title]"):
                tit = (el.get_attribute("title") or "").strip()
                if tit and len(tit) >= 2 and not tit.lower().startswith("http"):
                    return tit.split("\n")[0].strip()
        except Exception:
            pass
        label = (row.get_attribute("aria-label") or "").strip()
        if label:
            return label.split("\n")[0].strip()
        try:
            bits = (row.text or "").strip().split("\n")
            if bits:
                return bits[0].strip()
        except Exception:
            pass
        return ""

    def _is_real_contact_sidebar_row(self, row: Any) -> bool:
        """
        Skip list shells and skeleton rows: require visible identity-like text
        (name, phone-shaped digits, etc.).
        """
        try:
            if not row.is_displayed():
                return False
        except Exception:
            return False
        try:
            if (row.get_attribute("aria-busy") or "").lower() == "true":
                return False
        except Exception:
            pass
        name_text = self._extract_row_display_name(row)
        if not name_text:
            return False
        t = name_text.strip()
        tl = t.lower()
        if tl in ("loading", "loading…", "loading...", "archived", "archived chats"):
            return False
        if re.fullmatch(r"[.\u2026…\s]+", t):
            return False
        letters = sum(1 for c in t if c.isalpha())
        digits_in = "".join(c for c in t if c.isdigit())
        if letters >= 1:
            return True
        if len(digits_in) >= 8:
            return True
        if len(t) >= 3 and re.search(
            r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0400-\u04FF]", t
        ):
            return True
        return False

    def _try_merge_sidebar_row(
        self,
        row: Any,
        out: Dict[str, Dict[str, Any]],
        *,
        pass_num: int = -1,
        row_index: int = 0,
        pass_jid_owner: Optional[Dict[str, int]] = None,
    ) -> bool:
        if not self._is_real_contact_sidebar_row(row):
            if pass_num == 0:
                log.info(
                    "list_chats row_jid business_id=%s row=%s outcome=skipped "
                    "reason=not_real_contact",
                    self._business_id,
                    row_index,
                )
            return False
        try:
            name = self._extract_row_display_name(row)
            jid, method, detail = self._resolve_jid_for_list_row(
                row,
                pass_num=pass_num,
                row_index=row_index,
                preview_name=name,
                pass_jid_owner=pass_jid_owner,
            )
            if not jid:
                log.info(
                    "list_chats row_jid business_id=%s row=%s name=%r "
                    "outcome=skipped reason=no_jid final_method=%s detail=%s",
                    self._business_id,
                    row_index,
                    (name or "")[:80],
                    method,
                    (detail or "")[:120],
                )
                return False

            validated_jid = WhatsAppSessionManager._validate_jid(jid)
            if not validated_jid:
                log.info(
                    "list_chats row_jid business_id=%s row=%s name=%r "
                    "outcome=skipped reason=invalid_jid_format raw_jid=%s method=%s",
                    self._business_id,
                    row_index,
                    (name or "")[:80],
                    jid.split("@")[0][:40],
                    method,
                )
                return False
            jid = validated_jid

            digits = "".join(ch for ch in jid.split("@")[0] if ch.isdigit())
            prev_el = row.find_elements(
                By.CSS_SELECTOR, '[data-testid="last-msg-status"]'
            )
            preview = (prev_el[0].text or "").strip() if prev_el else ""

            meta_el = row.find_elements(
                By.CSS_SELECTOR, '[data-testid="cell-frame-meta"]'
            )
            meta_text = ""
            meta_title_attr = ""
            if meta_el:
                meta_text = (meta_el[0].text or "").strip()
                meta_title_attr = (
                    meta_el[0].get_attribute("title") or ""
                ).strip()

            last_ms = self._parse_sidebar_time(meta_text, meta_title_attr)
            display_name = name or ("+" + digits if digits else "Contact")

            if pass_jid_owner is not None:
                pass_jid_owner[jid] = row_index
            log.info(
                "list_chats row_jid business_id=%s row=%s name=%r outcome=merged "
                "method=%s jid=%s detail=%s",
                self._business_id,
                row_index,
                (name or "")[:80],
                method,
                jid.split("@")[0][:28],
                (detail or "")[:120],
            )

            out[jid] = {
                "chat_jid": jid,
                "phone_digits": digits,
                "display_name": display_name,
                "last_message_preview": preview,
                "last_message_at_ms": last_ms or 0,
            }
            return True
        except Exception as exc:
            log.info(
                "list_chats row_jid business_id=%s row=%s outcome=error err=%s",
                self._business_id,
                row_index,
                exc,
            )
            return False

    def _jid_accept_for_pass(
        self,
        jid: Optional[str],
        *,
        pass_jid_owner: Optional[Dict[str, int]],
        row_index: int,
        method: str,
    ) -> bool:
        """True if jid is new for this scroll pass or already owned by this row."""
        if not jid:
            return False
        if pass_jid_owner is None:
            return True
        owner = pass_jid_owner.get(jid)
        if owner is None or owner == row_index:
            return True
        log.info(
            "list_chats row_jid_candidate business_id=%s row=%s candidate_jid=%s "
            "method=%s outcome=rejected reason=duplicate_in_pass other_row=%s",
            self._business_id,
            row_index,
            jid.split("@")[0][:32],
            method,
            owner,
        )
        return False

    def _resolve_jid_for_list_row(
        self,
        row: Any,
        *,
        pass_num: int,
        row_index: int,
        preview_name: str,
        pass_jid_owner: Optional[Dict[str, int]] = None,
    ) -> Tuple[Optional[str], str, Optional[str]]:
        """
        Returns (jid, method, detail). Each candidate is validated via
        _validate_jid AND checked for pass-level duplicate ownership before
        being accepted. A validation or duplicate rejection moves on to the
        next method — it never skips the row entirely.

        Method order (earliest wins):
          1. href_anchor / href_phone_query  — most reliable; WhatsApp URL encodes JID
          2. display_name_digits             — contacts whose name IS a phone number
          3. subtree_attrs                   — DOM attribute scan (may find shared IDs)
          4. row_href_outerhtml_attr         — HTML residue / outerHTML patterns
          5. ancestor_attrs                  — walk up DOM inside chat-list boundary
          6. click_navigate                  — ground-truth URL read (budget-gated)
        """
        driver = self._driver
        if driver is None:
            return None, "no_driver", None

        def _accept(raw_jid: Optional[str], method: str) -> Optional[str]:
            """
            Validate raw_jid then check pass-level dedup.
            Logs the rejection reason and returns None on failure so the caller
            can continue to the next extraction method.
            Returns the normalised JID on success.
            """
            if not raw_jid:
                return None
            vj = WhatsAppSessionManager._validate_jid(raw_jid)
            if not vj:
                log.info(
                    "list_chats row_jid_candidate business_id=%s row=%s "
                    "candidate_jid=%s method=%s outcome=rejected reason=invalid_format",
                    self._business_id,
                    row_index,
                    raw_jid.split("@")[0][:32],
                    method,
                )
                return None
            if not self._jid_accept_for_pass(
                vj,
                pass_jid_owner=pass_jid_owner,
                row_index=row_index,
                method=method,
            ):
                return None
            log.info(
                "list_chats row_jid_candidate business_id=%s row=%s "
                "candidate_jid=%s method=%s outcome=accepted",
                self._business_id,
                row_index,
                vj.split("@")[0][:32],
                method,
            )
            return vj

        # ── 1. href_anchor / href_phone_query ────────────────────────────────
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
        if link_el is not None:
            href = (link_el.get_attribute("href") or "").strip()
            vj = _accept(self._jid_from_chat_href_including_groups(href), "href_anchor")
            if vj:
                return vj, "href_anchor", href[:160]
            if "phone=" in href.lower():
                try:
                    q = parse_qs(urlparse(href).query)
                    for key in ("phone", "text"):
                        vals = q.get(key)
                        if vals and re.fullmatch(
                            r"\d{10,15}", (vals[0] or "").strip()
                        ):
                            vj = _accept(f"{vals[0].strip()}@c.us", "href_phone_query")
                            if vj:
                                return vj, "href_phone_query", vj
                except Exception:
                    pass

        # ── 2. display_name_digits (before subtree_attrs) ────────────────────
        # Contacts whose display name IS a phone number (e.g. "+92 314 7811141")
        # are resolved here immediately without DOM attribute scanning.
        vj = _accept(
            WhatsAppSessionManager._jid_from_display_name_phone(preview_name),
            "display_name_digits",
        )
        if vj:
            return vj, "display_name_digits", None

        # ── 3. subtree_attrs ─────────────────────────────────────────────────
        # May find shared page-level IDs (e.g. 9-digit internal IDs); those are
        # now rejected by _accept → _validate_jid instead of stopping the row.
        vj = _accept(self._jid_from_subtree_attr_scan(driver, row), "subtree_attrs")
        if vj:
            return vj, "subtree_attrs", None

        # ── 4. row_href_outerhtml_attr ────────────────────────────────────────
        vj = _accept(self._jid_from_row_markup_residual(row), "row_href_outerhtml_attr")
        if vj:
            return vj, "row_href_outerhtml_attr", None

        # ── 5. ancestor_attrs ────────────────────────────────────────────────
        vj = _accept(self._jid_from_dom_ancestor_attr_scan(driver, row), "ancestor_attrs")
        if vj:
            return vj, "ancestor_attrs", None

        # All DOM methods exhausted.  Click-based ground-truth resolution is handled
        # after the full scroll phase completes so that browser navigation never
        # invalidates the Selenium element references still held by the active pass.
        return None, "all_dom_methods_exhausted", None

    def _jid_from_row_open_chat_url(
        self, driver: webdriver.Chrome, row: Any
    ) -> Optional[str]:
        """Click a sidebar row, read the JID from the URL or conversation panel, then restore sidebar."""
        jid: Optional[str] = None

        def _chat_opened(d: webdriver.Chrome) -> bool:
            if WhatsAppSessionManager._chrome_url_has_thread(d.current_url or ""):
                return True
            return bool(
                d.find_elements(
                    By.CSS_SELECTOR, '[data-testid="conversation-panel-wrapper"]'
                )
            )

        def _read_jid_from_state(d: webdriver.Chrome) -> Optional[str]:
            cur = d.current_url or ""
            if WhatsAppSessionManager._chrome_url_has_thread(cur):
                candidate = self._jid_from_chat_href_including_groups(cur)
                if not candidate and "phone=" in cur.lower():
                    try:
                        q = parse_qs(urlparse(cur).query)
                        ph = (q.get("phone") or [None])[0]
                        if ph and re.fullmatch(r"\d{10,15}", ph.strip()):
                            candidate = f"{ph.strip()}@c.us"
                    except Exception:
                        pass
                if candidate:
                    return candidate
            # URL didn't give us a JID — try the conversation panel
            if d.find_elements(
                By.CSS_SELECTOR, '[data-testid="conversation-panel-wrapper"]'
            ):
                return self._jid_from_conversation_panel(d)
            return None

        try:
            driver.execute_script(
                "arguments[0].scrollIntoView({block:'center', inline:'nearest'});",
                row,
            )
            time.sleep(0.12)
            driver.execute_script("arguments[0].click();", row)

            try:
                WebDriverWait(driver, 12).until(_chat_opened)
            except Exception:
                pass

            cur_url = driver.current_url or ""
            url_has_thread = WhatsAppSessionManager._chrome_url_has_thread(cur_url)
            panel_visible = bool(
                driver.find_elements(
                    By.CSS_SELECTOR, '[data-testid="conversation-panel-wrapper"]'
                )
            )
            log.info(
                "list_chats row_click_attempt business_id=%s "
                "url=%s url_thread=%s panel=%s",
                self._business_id,
                cur_url[:80],
                url_has_thread,
                panel_visible,
            )

            if url_has_thread or panel_visible:
                jid = _read_jid_from_state(driver)

            # If JS click didn't open anything, retry with ActionChains native click.
            if not jid and not url_has_thread and not panel_visible:
                log.info(
                    "list_chats row_click_retry_native business_id=%s",
                    self._business_id,
                )
                try:
                    ActionChains(driver).move_to_element(row).click().perform()
                    try:
                        WebDriverWait(driver, 8).until(_chat_opened)
                    except Exception:
                        pass
                    cur_url2 = driver.current_url or ""
                    url_has_thread2 = WhatsAppSessionManager._chrome_url_has_thread(
                        cur_url2
                    )
                    panel_visible2 = bool(
                        driver.find_elements(
                            By.CSS_SELECTOR,
                            '[data-testid="conversation-panel-wrapper"]',
                        )
                    )
                    log.info(
                        "list_chats row_click_native_result business_id=%s "
                        "url=%s url_thread=%s panel=%s",
                        self._business_id,
                        cur_url2[:80],
                        url_has_thread2,
                        panel_visible2,
                    )
                    if url_has_thread2 or panel_visible2:
                        jid = _read_jid_from_state(driver)
                except Exception:
                    log.warning(
                        "list_chats row_click_native_failed business_id=%s",
                        self._business_id,
                        exc_info=True,
                    )

            log.info(
                "list_chats row_click_resolve business_id=%s jid=%s",
                self._business_id,
                jid.split("@")[0][:24] if jid else "none",
            )
        except Exception:
            log.warning(
                "list_chats row_click_resolve_failed business_id=%s",
                self._business_id,
                exc_info=True,
            )
        finally:
            # Always restore the browser to the sidebar so subsequent iterations
            # can re-gather fresh element references without stale handles.
            try:
                cur = driver.current_url or ""
                if (
                    WhatsAppSessionManager._chrome_url_has_thread(cur)
                    or not cur.startswith("https://web.whatsapp.com")
                ):
                    driver.get(WA_URL)
                    time.sleep(0.65)
            except Exception:
                try:
                    driver.get(WA_URL)
                    time.sleep(0.65)
                except Exception:
                    pass
            try:
                WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located(
                        (By.CSS_SELECTOR, '[data-testid="chat-list"]')
                    )
                )
            except Exception:
                pass
            try:
                WebDriverWait(driver, 8).until(
                    lambda d: bool(
                        d.find_elements(
                            By.CSS_SELECTOR,
                            '[data-testid="cell-frame-container"]',
                        )
                    )
                )
            except Exception:
                pass
        return jid

    def _jid_from_conversation_panel(
        self, driver: webdriver.Chrome
    ) -> Optional[str]:
        """Extract a JID from the currently-open conversation without using the URL."""
        # Most reliable: message data-id attrs encode the JID as
        # "true_PHONE@c.us_MSGID" or "false_PHONE@c.us_MSGID".
        try:
            raw = driver.execute_script(
                """
                var els = document.querySelectorAll('[data-id]');
                for (var i = 0; i < els.length; i++) {
                    var dataId = els[i].getAttribute('data-id') || '';
                    var m = dataId.match(
                        /(?:true|false)_(\\d{10,15}@(?:c\\.us|s\\.whatsapp\\.net|g\\.us))/
                    );
                    if (m) return m[1];
                }
                return null;
                """
            )
            if raw:
                jid = WhatsAppSessionManager._validate_jid(str(raw))
                if jid:
                    log.info(
                        "list_chats panel_jid_from_data_id business_id=%s jid=%s",
                        self._business_id,
                        jid.split("@")[0][:24],
                    )
                    return jid
        except Exception:
            pass

        # Fallback: aria-label / title on conversation header elements
        for sel in (
            '[data-testid="conversation-header"]',
            '[data-testid="contact-info"]',
            '[data-testid="conversation-panel-wrapper"]',
        ):
            try:
                for el in driver.find_elements(By.CSS_SELECTOR, sel):
                    for attr in ("aria-label", "title"):
                        text = (el.get_attribute(attr) or "").strip()
                        if text:
                            candidate = WhatsAppSessionManager._jid_from_display_name_phone(
                                text
                            )
                            if candidate:
                                jid = WhatsAppSessionManager._validate_jid(candidate)
                                if jid:
                                    log.info(
                                        "list_chats panel_jid_from_header "
                                        "business_id=%s jid=%s sel=%s",
                                        self._business_id,
                                        jid.split("@")[0][:24],
                                        sel,
                                    )
                                    return jid
            except Exception:
                pass

        log.info(
            "list_chats panel_jid_not_found business_id=%s", self._business_id
        )
        return None

    def _wait_for_real_sidebar_chats(
        self, driver: webdriver.Chrome, timeout: float = 90.0
    ) -> Tuple[int, Dict[str, int]]:
        deadline = time.time() + timeout
        last_counts: Dict[str, int] = {}
        while time.time() < deadline:
            rows, counts = self._gather_sidebar_candidate_rows(driver)
            last_counts = counts
            real_n = sum(
                1 for r in rows if self._is_real_contact_sidebar_row(r)
            )
            if real_n > 0:
                log.info(
                    "list_chats real_rows_ready business_id=%s real_rows=%s "
                    "raw_candidates=%s selector_counts=%s",
                    self._business_id,
                    real_n,
                    len(rows),
                    counts,
                )
                return real_n, counts
            time.sleep(0.55)
        rows, counts = self._gather_sidebar_candidate_rows(driver)
        real_n = sum(1 for r in rows if self._is_real_contact_sidebar_row(r))
        log.warning(
            "list_chats real_rows_timeout business_id=%s real_rows=%s "
            "raw_candidates=%s selector_counts=%s",
            self._business_id,
            real_n,
            len(rows),
            counts,
        )
        return real_n, counts

    @staticmethod
    def _get_sidebar_scroll_state(driver: webdriver.Chrome) -> Dict[str, Any]:
        try:
            return driver.execute_script(
                """
                const pane = document.querySelector('#pane-side');
                const chatList = document.querySelector('[data-testid="chat-list"]');
                const roots = [];
                if (pane) roots.push(pane);
                if (chatList && chatList !== pane) roots.push(chatList);
                if (!roots.length) {
                  return {scrollTop:0, scrollHeight:0, clientHeight:0,
                          atEnd:true, node:'missing'};
                }
                let best = null;
                let bestScore = 0;
                for (let r = 0; r < roots.length; r++) {
                  const root = roots[r];
                  const nodes = root.querySelectorAll(
                    'div[tabindex="-1"], div[tabindex="0"], div');
                  for (let i = 0; i < nodes.length; i++) {
                    const n = nodes[i];
                    const sh = n.scrollHeight, ch = n.clientHeight;
                    if (sh > ch + 40 && sh > bestScore) {
                      bestScore = sh;
                      best = n;
                    }
                  }
                }
                if (!best) best = pane || roots[0];
                const st = best.scrollTop, sh = best.scrollHeight,
                      ch = best.clientHeight;
                const scrollable = sh > ch + 8;
                return {
                  scrollTop: st,
                  scrollHeight: sh,
                  clientHeight: ch,
                  atEnd: !scrollable || (st + ch >= sh - 10),
                  node: (best === pane) ? 'pane' : 'inner'
                };
                """
            )
        except Exception:
            return {
                "scrollTop": 0,
                "scrollHeight": 0,
                "clientHeight": 0,
                "atEnd": True,
                "node": "error",
            }

    @staticmethod
    def _set_sidebar_scroll_top(driver: webdriver.Chrome, y: float) -> None:
        try:
            driver.execute_script(
                """
                const pane = document.querySelector('#pane-side');
                const chatList = document.querySelector('[data-testid="chat-list"]');
                const roots = [];
                if (pane) roots.push(pane);
                if (chatList && chatList !== pane) roots.push(chatList);
                if (!roots.length) return;
                let best = null;
                let bestScore = 0;
                for (let r = 0; r < roots.length; r++) {
                  const root = roots[r];
                  const nodes = root.querySelectorAll(
                    'div[tabindex="-1"], div[tabindex="0"], div');
                  for (let i = 0; i < nodes.length; i++) {
                    const n = nodes[i];
                    const sh = n.scrollHeight, ch = n.clientHeight;
                    if (sh > ch + 40 && sh > bestScore) {
                      bestScore = sh;
                      best = n;
                    }
                  }
                }
                if (!best) best = pane || roots[0];
                best.scrollTop = arguments[0];
                """,
                y,
            )
        except Exception:
            pass

    @staticmethod
    def _scroll_sidebar_step(driver: webdriver.Chrome, delta: int) -> None:
        try:
            driver.execute_script(
                """
                const pane = document.querySelector('#pane-side');
                const chatList = document.querySelector('[data-testid="chat-list"]');
                const roots = [];
                if (pane) roots.push(pane);
                if (chatList && chatList !== pane) roots.push(chatList);
                if (!roots.length) return;
                let best = null;
                let bestScore = 0;
                for (let r = 0; r < roots.length; r++) {
                  const root = roots[r];
                  const nodes = root.querySelectorAll(
                    'div[tabindex="-1"], div[tabindex="0"], div');
                  for (let i = 0; i < nodes.length; i++) {
                    const n = nodes[i];
                    const sh = n.scrollHeight, ch = n.clientHeight;
                    if (sh > ch + 40 && sh > bestScore) {
                      bestScore = sh;
                      best = n;
                    }
                  }
                }
                if (!best) best = pane || roots[0];
                const d = arguments[0];
                best.scrollTop = Math.min(best.scrollTop + d, best.scrollHeight);
                """,
                delta,
            )
        except Exception:
            pass

    def _collect_chats_with_virtual_scroll(
        self,
        driver: webdriver.Chrome,
        out: Dict[str, Dict[str, Any]],
        max_passes: Optional[int] = None,
    ) -> None:
        pause = float(os.environ.get("WHATSAPP_CHAT_SCROLL_PAUSE_SEC", "0.38"))
        if max_passes is None:
            max_passes = int(
                os.environ.get(
                    "WHATSAPP_CHAT_SCROLL_MAX_PASSES",
                    "140",
                )
            )
        self._set_sidebar_scroll_top(driver, 0)
        time.sleep(pause)

        stable_rounds = 0
        last_total = -1
        stuck_rounds = 0
        for pass_num in range(max_passes):
            # JID → first row_index in this scroll pass; detects shared DOM ids.
            pass_jid_owner: Dict[str, int] = {}
            rows, counts = self._gather_sidebar_candidate_rows(driver)
            real_rows = [r for r in rows if self._is_real_contact_sidebar_row(r)]
            merged_this_pass = 0
            for row_index, row in enumerate(real_rows):
                if pass_num == 0 and row_index < 3:
                    try:
                        html_dbg = row.get_attribute("outerHTML") or ""
                        log.debug(
                            "list_chats row_outerhtml business_id=%s row=%s "
                            "chars=%s\n%s",
                            self._business_id,
                            row_index,
                            len(html_dbg),
                            html_dbg,
                        )
                    except Exception as exc:
                        log.debug(
                            "list_chats row_outerhtml_failed business_id=%s "
                            "row=%s err=%s",
                            self._business_id,
                            row_index,
                            exc,
                        )
                if self._try_merge_sidebar_row(
                    row,
                    out,
                    pass_num=pass_num,
                    row_index=row_index,
                    pass_jid_owner=pass_jid_owner,
                ):
                    merged_this_pass += 1
            merged_after = len(out)
            st = self._get_sidebar_scroll_state(driver)
            log.info(
                "list_chats scroll_pass business_id=%s pass=%s/%s "
                "scroll_top=%s scroll_h=%s client_h=%s at_end=%s "
                "real_visible=%s merged_this_pass=%s unique_total=%s "
                "selector_counts=%s",
                self._business_id,
                pass_num,
                max_passes - 1,
                st.get("scrollTop"),
                st.get("scrollHeight"),
                st.get("clientHeight"),
                st.get("atEnd"),
                len(real_rows),
                merged_this_pass,
                merged_after,
                counts,
            )
            if merged_after == last_total:
                stable_rounds += 1
            else:
                stable_rounds = 0
            last_total = merged_after
            if st.get("atEnd") and stable_rounds >= 4:
                log.info(
                    "list_chats scroll_stop business_id=%s reason=at_end_stable "
                    "passes=%s unique=%s",
                    self._business_id,
                    pass_num + 1,
                    merged_after,
                )
                break
            ch = int(st.get("clientHeight") or 500)
            step = max(100, int(ch * 0.72))
            top_before = float(st.get("scrollTop") or 0)
            self._scroll_sidebar_step(driver, step)
            time.sleep(pause)
            st_after = self._get_sidebar_scroll_state(driver)
            top_after = float(st_after.get("scrollTop") or 0)
            if abs(top_after - top_before) < 3:
                stuck_rounds += 1
            else:
                stuck_rounds = 0
            if stuck_rounds >= 6:
                log.info(
                    "list_chats scroll_stop business_id=%s reason=scroll_top_stuck "
                    "passes=%s unique=%s",
                    self._business_id,
                    pass_num + 1,
                    merged_after,
                )
                break

        log.info(
            "list_chats scroll_collection_done business_id=%s unique_chats=%s",
            self._business_id,
            len(out),
        )

    def _sidebar_has_titled_chat_rows(self, driver: webdriver.Chrome) -> bool:
        rows, _ = self._gather_sidebar_candidate_rows(driver)
        return any(self._is_real_contact_sidebar_row(r) for r in rows)

    def _enrich_chats_via_row_clicks(
        self,
        driver: webdriver.Chrome,
        out: Dict[str, Dict[str, Any]],
    ) -> None:
        """
        Last resort when DOM exposes no /chat/ URLs. Disabled by default
        (WHATSAPP_CHAT_LIST_CLICK_FALLBACK).
        """
        max_rows = int(os.environ.get("WHATSAPP_CHAT_CLICK_MAX", "5"))
        try:
            cur = driver.current_url or ""
            if WhatsAppSessionManager._chrome_url_has_thread(cur):
                driver.get(WA_URL)
                time.sleep(0.7)
                WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located(
                        (By.CSS_SELECTOR, '[data-testid="chat-list"]')
                    )
                )
        except Exception:
            pass

        idx = 0
        failures = 0
        while idx < max_rows and failures < 12:
            try:
                rows = driver.find_elements(
                    By.CSS_SELECTOR, '[data-testid="cell-frame-container"]'
                )
                titled = [
                    r
                    for r in rows
                    if r.find_elements(
                        By.CSS_SELECTOR, '[data-testid="cell-frame-title"]'
                    )
                ]
                if idx >= len(titled):
                    break
                row = titled[idx]

                title_el = row.find_elements(
                    By.CSS_SELECTOR, '[data-testid="cell-frame-title"]'
                )
                name = (title_el[0].text or "").strip() if title_el else ""
                prev_el = row.find_elements(
                    By.CSS_SELECTOR, '[data-testid="last-msg-status"]'
                )
                preview = (prev_el[0].text or "").strip() if prev_el else ""
                meta_el = row.find_elements(
                    By.CSS_SELECTOR, '[data-testid="cell-frame-meta"]'
                )
                meta_text = ""
                meta_title_attr = ""
                if meta_el:
                    meta_text = (meta_el[0].text or "").strip()
                    meta_title_attr = (
                        meta_el[0].get_attribute("title") or ""
                    ).strip()
                last_ms = self._parse_sidebar_time(meta_text, meta_title_attr) or 0

                driver.execute_script(
                    "arguments[0].scrollIntoView({block:'center', inline:'nearest'});",
                    row,
                )
                time.sleep(0.15)
                driver.execute_script("arguments[0].click();", row)
                try:
                    WebDriverWait(driver, 12).until(
                        lambda d: WhatsAppSessionManager._chrome_url_has_thread(
                            d.current_url or ""
                        )
                    )
                except Exception:
                    failures += 1
                    idx += 1
                    driver.get(WA_URL)
                    time.sleep(0.6)
                    try:
                        WebDriverWait(driver, 18).until(
                            EC.presence_of_element_located(
                                (
                                    By.CSS_SELECTOR,
                                    '[data-testid="chat-list"]',
                                )
                            )
                        )
                    except Exception:
                        pass
                    continue

                cur_url = driver.current_url or ""
                jid = self._jid_from_chat_href(cur_url)
                if not jid and "phone=" in cur_url.lower():
                    try:
                        q = parse_qs(urlparse(cur_url).query)
                        ph = (q.get("phone") or [None])[0]
                        if ph and re.fullmatch(r"\d{10,15}", ph.strip()):
                            jid = f"{ph.strip()}@c.us"
                    except Exception:
                        pass
                driver.get(WA_URL)
                time.sleep(0.75)
                try:
                    WebDriverWait(driver, 20).until(
                        EC.presence_of_element_located(
                            (By.CSS_SELECTOR, '[data-testid="chat-list"]')
                        )
                    )
                except Exception:
                    pass

                idx += 1
                if not jid or jid.endswith("@g.us"):
                    continue
                if jid in out:
                    continue
                digits = "".join(ch for ch in jid.split("@")[0] if ch.isdigit())
                display_name = name or ("+" + digits if digits else "Contact")
                out[jid] = {
                    "chat_jid": jid,
                    "phone_digits": digits,
                    "display_name": display_name,
                    "last_message_preview": preview,
                    "last_message_at_ms": last_ms or 0,
                }
                log.info(
                    "click_fallback captured jid=%s idx=%s",
                    jid.split("@")[0][:20],
                    idx - 1,
                )
            except Exception:
                failures += 1
                idx += 1
                log.warning("click_fallback row_error", exc_info=True)
                try:
                    driver.get(WA_URL)
                    time.sleep(0.6)
                except Exception:
                    pass

        log.info(
            "click_fallback done business_id=%s count=%s",
            self._business_id,
            len(out),
        )

    def _click_remediate_unresolved_rows(
        self,
        driver: webdriver.Chrome,
        out: Dict[str, Dict[str, Any]],
    ) -> None:
        """
        Post-scroll pass: click any sidebar row whose JID we still couldn't resolve
        via DOM methods. Re-gathers fresh element references each iteration so no
        stale handles are held across browser navigations.
        """
        # Scroll back to top so we see the same rows the scroll phase visited.
        try:
            pane = driver.find_element(By.CSS_SELECTOR, '[data-testid="chat-list"]')
            driver.execute_script("arguments[0].scrollTop = 0;", pane)
            time.sleep(0.3)
        except Exception:
            pass

        failures = 0
        idx = 0
        while self._list_chats_row_click_budget > 0 and failures < 6:
            # Re-gather every iteration — previous click navigated the browser so
            # all prior element handles are stale.
            try:
                rows = driver.find_elements(
                    By.CSS_SELECTOR, '[data-testid="cell-frame-container"]'
                )
            except Exception:
                break
            if idx >= len(rows):
                break

            row = rows[idx]
            idx += 1

            # Skip if this row's display name resolves to an already-captured JID.
            try:
                name_text = self._extract_row_display_name(row) or ""
                # Quick pre-check: if display_name_digits resolves and is already known
                dn_jid = WhatsAppSessionManager._jid_from_display_name_phone(name_text)
                if dn_jid:
                    vdn = WhatsAppSessionManager._validate_jid(dn_jid)
                    if vdn and vdn in out:
                        log.info(
                            "click_remediate skip_already_captured jid=%s idx=%s",
                            vdn.split("@")[0][:20],
                            idx - 1,
                        )
                        continue
            except Exception:
                pass

            # Extract metadata before navigating (elements are fresh here).
            try:
                title_el = row.find_elements(
                    By.CSS_SELECTOR, '[data-testid="cell-frame-title"]'
                )
                name = (title_el[0].text or "").strip() if title_el else ""
                prev_el = row.find_elements(
                    By.CSS_SELECTOR, '[data-testid="last-msg-status"]'
                )
                preview = (prev_el[0].text or "").strip() if prev_el else ""
                meta_el = row.find_elements(
                    By.CSS_SELECTOR, '[data-testid="cell-frame-meta"]'
                )
                meta_text = (meta_el[0].text or "").strip() if meta_el else ""
                meta_title = (
                    (meta_el[0].get_attribute("title") or "").strip() if meta_el else ""
                )
                last_ms = self._parse_sidebar_time(meta_text, meta_title) or 0
            except Exception:
                name, preview, last_ms = "", "", 0

            self._list_chats_row_click_budget -= 1
            raw_jid = self._jid_from_row_open_chat_url(driver, row)
            # After _jid_from_row_open_chat_url the browser is back on the sidebar;
            # element references from before the click are all stale — don't use them.

            if not raw_jid:
                failures += 1
                continue

            jid = WhatsAppSessionManager._validate_jid(raw_jid)
            if not jid:
                log.info(
                    "click_remediate invalid_jid raw=%s idx=%s",
                    str(raw_jid)[:30],
                    idx - 1,
                )
                continue

            if jid in out:
                log.info(
                    "click_remediate skip_already_captured jid=%s idx=%s",
                    jid.split("@")[0][:20],
                    idx - 1,
                )
                continue

            digits = "".join(ch for ch in jid.split("@")[0] if ch.isdigit())
            display_name = name or ("+" + digits if digits else "Contact")
            out[jid] = {
                "chat_jid": jid,
                "phone_digits": digits,
                "display_name": display_name,
                "last_message_preview": preview,
                "last_message_at_ms": last_ms or 0,
            }
            log.info(
                "click_remediate captured jid=%s name=%s idx=%s budget_left=%s",
                jid.split("@")[0][:20],
                display_name[:20],
                idx - 1,
                self._list_chats_row_click_budget,
            )

        log.info(
            "click_remediate done business_id=%s captured=%s budget_left=%s",
            self._business_id,
            sum(1 for v in out.values() if v),
            self._list_chats_row_click_budget,
        )

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

            # Wait for real contact rows, not an empty virtualized shell.
            self._wait_for_real_sidebar_chats(driver)

            self._list_chats_row_click_budget = 20

            aggregated: Dict[str, Dict[str, Any]] = {}
            env_scroll = os.environ.get(
                "WHATSAPP_CHAT_SCROLL_MAX_PASSES", ""
            ).strip()
            if env_scroll.isdigit():
                scroll_cap = int(env_scroll)
            else:
                scroll_cap = max(72, scroll_rounds * 4)
            self._collect_chats_with_virtual_scroll(
                driver, aggregated, max_passes=scroll_cap
            )

            self._capture_chat_rows_from_pane_links(driver, aggregated)

            # Click-remediate any rows whose JID the DOM scroll phase couldn't
            # resolve. Runs after the full scroll so browser navigation here
            # never invalidates element handles held during scrolling.
            if self._list_chats_row_click_budget > 0:
                self._click_remediate_unresolved_rows(driver, aggregated)

            if not aggregated and _click_fallback_enabled():
                if self._sidebar_has_titled_chat_rows(driver):
                    log.warning(
                        "list_chats using_click_fallback business_id=%s "
                        "(set WHATSAPP_CHAT_LIST_CLICK_FALLBACK=0 to disable)",
                        self._business_id,
                    )
                    self._enrich_chats_via_row_clicks(driver, aggregated)

            # Final safety dedup: re-key by validated canonical JID so that any
            # two entries that _validate_jid resolves to the same string collapse
            # into one (first occurrence wins).  This prevents the DB from ever
            # receiving the same JID twice in a single upsert batch.
            deduped: Dict[str, Dict[str, Any]] = {}
            for raw_jid, entry in aggregated.items():
                canonical = WhatsAppSessionManager._validate_jid(raw_jid) or raw_jid
                if canonical not in deduped:
                    if canonical != raw_jid:
                        entry = dict(entry)
                        entry["chat_jid"] = canonical
                        entry["phone_digits"] = "".join(
                            ch for ch in canonical.split("@")[0] if ch.isdigit()
                        )
                    deduped[canonical] = entry
            chats: List[Dict[str, Any]] = list(deduped.values())

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
    def _jid_from_chat_href_including_groups(url: str) -> Optional[str]:
        """Parse /chat/&lt;token&gt; from a URL; keep @g.us (groups)."""
        if "/chat/" not in url and "chat/" not in url:
            return None
        try:
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
            return jid or None
        except Exception:
            return None

    @staticmethod
    def _jid_from_chat_href(url: str) -> Optional[str]:
        jid = WhatsAppSessionManager._jid_from_chat_href_including_groups(url)
        if jid and jid.endswith("@g.us"):
            return None
        return jid

    @classmethod
    def _extract_first_jid_from_scraped_text(cls, text: str) -> Optional[str]:
        """
        One blob of text (attribute value, aria-label, etc.): find a WhatsApp id.
        Prefers @c.us / @s.whatsapp.net / @g.us / @lid; else longest 7–20 digit run → @c.us.
        """
        if not text or not isinstance(text, str):
            return None
        t = text.strip()
        if not t or len(t) > 80_000:
            return None
        patterns = (
            r"(\d{10,20}@[cs]\.(?:us|whatsapp\.net))",
            r"(\d{6,20}@g\.us)",
            r"([A-Za-z0-9.\-+_]{1,120}@lid)",
            r"(\d{10,20}@lid)",
        )
        for pat in patterns:
            m = re.search(pat, t, flags=re.I)
            if not m:
                continue
            cand = m.group(1).strip()
            if cand.lower().endswith("@g.us") and re.fullmatch(
                r"\d{6,20}@g\.us", cand, flags=re.I
            ):
                return cand.lower()
            jid = cls._jid_from_token_with_prefix(cand)
            if jid:
                return jid
        jid = cls._jid_from_token_with_prefix(t)
        if jid:
            return jid
        # Require 10+ digits for bare runs — 7–9 digit matches are often internal
        # UI ids (e.g. linked-device fragments) and collapse unrelated chats.
        best: Optional[str] = None
        best_len = 0
        for m in re.finditer(r"\d{10,}", t):
            d = m.group(0)
            ln = len(d)
            if ln <= 20 and ln > best_len:
                best = d
                best_len = ln
        if best:
            return f"{best}@c.us"
        return None

    @staticmethod
    def _jid_from_display_name_phone(name: str) -> Optional[str]:
        """E.164-ish title lines often carry enough digits for @c.us (sidebar)."""
        raw = (name or "").strip()
        if not raw:
            return None
        digits = "".join(ch for ch in raw if ch.isdigit())
        if 10 <= len(digits) <= 15:
            return f"{digits}@c.us"
        return None

    @staticmethod
    def _collect_ancestor_attr_values_js(
        driver: webdriver.Chrome, row: Any
    ) -> List[str]:
        try:
            raw = driver.execute_script(
                """
                const el = arguments[0];
                const chatList = document.querySelector(
                  '[data-testid="chat-list"]');
                const allRows = chatList
                  ? Array.from(chatList.querySelectorAll(
                      '[data-testid="cell-frame-container"]'))
                  : [];
                const out = [];
                let p = el;
                for (let i = 0; i < 8 && p; i++) {
                  if (chatList && (!chatList.contains(p) || p === chatList)) {
                    break;
                  }
                  let rowsUnder = 0;
                  for (let j = 0; j < allRows.length; j++) {
                    const r = allRows[j];
                    if (r !== p && p.contains(r)) rowsUnder++;
                  }
                  if (rowsUnder > 1) break;
                  if (p.attributes) {
                    for (const a of p.attributes) {
                      const v = (a.value || '').trim();
                      if (v && v.length <= 1200) out.push(v);
                    }
                  }
                  p = p.parentElement;
                }
                return out;
                """,
                row,
            )
        except Exception:
            return []
        return [str(x) for x in (raw or []) if x]

    @staticmethod
    def _collect_subtree_attr_values_js(
        driver: webdriver.Chrome, row: Any
    ) -> List[str]:
        try:
            raw = driver.execute_script(
                """
                const root = arguments[0];
                const out = [];
                function walk(el) {
                  if (!el || el.nodeType !== 1) return;
                  if (el.attributes) {
                    for (const a of el.attributes) {
                      const v = (a.value || '').trim();
                      if (v && v.length <= 1200) out.push(v);
                    }
                  }
                  const ch = el.children;
                  if (!ch) return;
                  for (let i = 0; i < ch.length; i++) walk(ch[i]);
                }
                walk(root);
                return out;
                """,
                row,
            )
        except Exception:
            return []
        return [str(x) for x in (raw or []) if x]

    @classmethod
    def _jid_from_dom_ancestor_attr_scan(
        cls, driver: webdriver.Chrome, row: Any
    ) -> Optional[str]:
        for blob in cls._collect_ancestor_attr_values_js(driver, row):
            jid = cls._extract_first_jid_from_scraped_text(blob)
            if jid:
                return jid
        return None

    @classmethod
    def _jid_from_subtree_attr_scan(
        cls, driver: webdriver.Chrome, row: Any
    ) -> Optional[str]:
        for blob in cls._collect_subtree_attr_values_js(driver, row):
            jid = cls._extract_first_jid_from_scraped_text(blob)
            if jid:
                return jid
        return None

    @classmethod
    def _jid_from_row_markup_residual(cls, row: Any) -> Optional[str]:
        """href / phone inside row, outerHTML patterns, row root attributes."""
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
                    jid = cls._jid_from_chat_href_including_groups(href)
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
        jid = cls._jid_from_row_html_fragment_list(html)
        if jid:
            return jid
        for attr in (
            "data-id",
            "data-jid",
            "data-key",
            "id",
            "data-chat-id",
            "data-contact-id",
        ):
            try:
                blob = (row.get_attribute(attr) or "").strip()
            except Exception:
                blob = ""
            if blob:
                jid = cls._extract_first_jid_from_scraped_text(blob)
                if jid:
                    return jid
        return None

    @staticmethod
    def _validate_jid(jid: Optional[str]) -> Optional[str]:
        """
        Strict final gate applied to every JID before it is stored or used.
        Valid formats:
          - {10-15 digits}@c.us  (individual contact)
          - {10-15 digits}@s.whatsapp.net → normalised to @c.us
          - {digits}@g.us  (group; digit local-part, any length)
          - Bare 10-15 digit string → auto-appended with @c.us
        Anything else (too long, too short, concatenated numbers, etc.) returns None.
        """
        if not jid or not isinstance(jid, str):
            return None
        jid = jid.strip()
        lower = jid.lower()
        if lower.endswith("@g.us"):
            local = jid[: -len("@g.us")]
            return lower if re.fullmatch(r"\d+", local) else None
        for suffix in ("@c.us", "@s.whatsapp.net"):
            if lower.endswith(suffix):
                local = jid[: -len(suffix)]
                return f"{local}@c.us" if re.fullmatch(r"\d{10,15}", local) else None
        if re.fullmatch(r"\d{10,15}", jid):
            return f"{jid}@c.us"
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
    def _jid_from_token_with_prefix(cls, token: str) -> Optional[str]:
        """
        WhatsApp data-id values often embed the JID, e.g. false_123...@c.us — do not
        trust the full string as normalize_jid_candidate would.
        """
        token = (token or "").strip()
        if not token:
            return None
        m = re.search(
            r"(\d{10,20}@[cs]\.(?:us|whatsapp\.net)|\d{6,20}@g\.us|[A-Za-z0-9.\-+]+@lid)",
            token,
            flags=re.I,
        )
        if m:
            cand = m.group(1).strip()
            if cand.lower().endswith("@g.us") and re.fullmatch(
                r"\d{6,20}@g\.us", cand, flags=re.I
            ):
                return cand.lower()
            jid = cls._normalize_jid_candidate(cand)
            if jid:
                return jid
        if "_" in token:
            tail = token.rsplit("_", 1)[-1]
            jid = cls._normalize_jid_candidate(tail)
            if jid:
                return jid
            if re.fullmatch(r"\d{6,20}@g\.us", tail, flags=re.I):
                return tail.lower()
        return cls._normalize_jid_candidate(token)

    @classmethod
    def _jid_from_attr_blob(cls, blob: str) -> Optional[str]:
        blob = (blob or "").strip()
        if not blob:
            return None
        return cls._extract_first_jid_from_scraped_text(blob)

    @classmethod
    def _jid_from_dom_dataset_chain(
        cls, driver: webdriver.Chrome, row: Any
    ) -> Optional[str]:
        """Backward-compatible name: full ancestor attribute scan."""
        return cls._jid_from_dom_ancestor_attr_scan(driver, row)

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
    def _jid_from_row_html_fragment_list(cls, html: str) -> Optional[str]:
        """Like _jid_from_row_html_fragment but allows @g.us and a final blob scan."""
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
                jid = cls._extract_first_jid_from_scraped_text(token)
                if jid:
                    return jid
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
            r'["\']([A-Za-z0-9.\-+]+@(c\.us|s\.whatsapp\.net|lid|g\.us))["\']',
            snippet,
            flags=re.I,
        ):
            cand = m.group(1)
            jid = cls._extract_first_jid_from_scraped_text(cand)
            if jid:
                return jid
        return cls._extract_first_jid_from_scraped_text(snippet)

    @classmethod
    def _jid_from_cell_row_deep(
        cls, row: Any, driver: Optional[webdriver.Chrome] = None
    ) -> Optional[str]:
        """Resolve chat JID when the row is not wrapped in a classic <a href=/chat/…>."""
        if driver is not None:
            jid_a = cls._jid_from_dom_ancestor_attr_scan(driver, row)
            if jid_a:
                return jid_a
            jid_s = cls._jid_from_subtree_attr_scan(driver, row)
            if jid_s:
                return jid_s
        return cls._jid_from_row_markup_residual(row)

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
        rows, _ = self._gather_sidebar_candidate_rows(driver)
        for row in rows:
            self._try_merge_sidebar_row(row, out)

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
                jid = self._jid_from_chat_href_including_groups(href)
                if not jid and "phone=" in href.lower():
                    try:
                        q = parse_qs(urlparse(href).query)
                        ph = (q.get("phone") or [None])[0]
                        if ph and re.fullmatch(r"\d{10,15}", ph.strip()):
                            jid = f"{ph.strip()}@c.us"
                    except Exception:
                        pass
                if not jid:
                    continue
                # Normalise through the same gate used by the scroll path so that
                # @s.whatsapp.net → @c.us collapses and the dict key is canonical.
                jid = WhatsAppSessionManager._validate_jid(jid)
                if not jid:
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
        t_start = time.time()
        normalized = self._jid_suffix_for_chat_url(chat_jid)
        deadline = t_start + 25.0

        log.info(
            "fetch_chat_messages start business_id=%s jid=%s",
            self._business_id,
            normalized,
        )

        with self._lock:
            driver = self._driver
            if driver is None:
                raise RuntimeError("driver_not_initialized")

            # Log current browser URL so pasted logs show browser state at entry.
            cur_url = ""
            try:
                cur_url = driver.current_url or ""
            except Exception:
                pass
            log.info(
                "fetch_chat_messages browser_state jid=%s url=%s elapsed_ms=%.0f",
                normalized,
                cur_url[:80],
                (time.time() - t_start) * 1000,
            )

            # If the browser landed on a thread URL (e.g. left over from
            # _click_remediate) or navigated away from WhatsApp entirely,
            # return to the home sidebar before the login check.  Otherwise
            # _detect_logged_in may see only a conversation panel (no sidebar)
            # and return False even though the session is fully active.
            if WhatsAppSessionManager._chrome_url_has_thread(cur_url) or (
                cur_url and not cur_url.startswith("https://web.whatsapp.com")
            ):
                log.info(
                    "fetch_chat_messages pre_nav_home jid=%s url=%s",
                    normalized,
                    cur_url[:80],
                )
                try:
                    driver.set_page_load_timeout(15)
                    driver.get(WA_URL)
                    time.sleep(0.8)
                    cur_url = driver.current_url or ""
                except Exception as nav_exc:
                    log.warning(
                        "fetch_chat_messages pre_nav_error jid=%s: %s",
                        normalized,
                        nav_exc,
                    )

            logged_in = self._detect_logged_in(driver)
            if not logged_in:
                # Capture selector diagnostics before the retry so they appear
                # in logs even if the retry succeeds.
                try:
                    diag = {
                        "default_user": bool(driver.find_elements(By.CSS_SELECTOR, '[data-testid="default-user"]')),
                        "conv_panel": bool(driver.find_elements(By.CSS_SELECTOR, '[data-testid="conversation-panel-wrapper"]')),
                        "chat_list": bool(driver.find_elements(By.CSS_SELECTOR, '[data-testid="chat-list"]')),
                        "cell_frame": bool(driver.find_elements(By.CSS_SELECTOR, '[data-testid="cell-frame-container"]')),
                        "pane_links": bool(driver.find_elements(By.CSS_SELECTOR, '#pane-side a[href*="/chat/"]')),
                    }
                except Exception:
                    diag = {}
                log.warning(
                    "fetch_chat_messages login_check_failed jid=%s url=%s selectors=%s elapsed_ms=%.0f — retrying in 1.5s",
                    normalized,
                    cur_url[:80],
                    diag,
                    (time.time() - t_start) * 1000,
                )
                time.sleep(1.5)
                logged_in = self._detect_logged_in(driver)
                log.info(
                    "fetch_chat_messages login_check_retry jid=%s logged_in=%s elapsed_ms=%.0f",
                    normalized,
                    logged_in,
                    (time.time() - t_start) * 1000,
                )

            if not logged_in:
                raise RuntimeError("not_logged_in")

            # Step 1: Click the matching sidebar row — no full page navigation.
            # jid_local is the phone-number part before "@"; appears verbatim in hrefs.
            # jid_digits is pure digits — used to match rows whose title is a phone number
            # with formatting characters (spaces, dashes, parentheses).
            jid_local = normalized.split("@")[0]
            jid_digits = "".join(c for c in jid_local if c.isdigit())
            clicked: bool = False
            try:
                clicked = bool(
                    driver.execute_script(
                        """
                        var jidLocal = arguments[0];
                        var jidDigits = arguments[1];

                        // 1. Sidebar /chat/ links that embed the JID in the href
                        var links = document.querySelectorAll(
                            '#pane-side a[href*="/chat/"], #pane-side [href*="/chat/"]'
                        );
                        for (var i = 0; i < links.length; i++) {
                            var h = links[i].getAttribute('href') || '';
                            if (h.indexOf(jidLocal) !== -1) {
                                links[i].click();
                                return true;
                            }
                        }

                        // 2. cell-frame-container inner links
                        var containers = document.querySelectorAll(
                            '[data-testid="cell-frame-container"]'
                        );
                        for (var j = 0; j < containers.length; j++) {
                            var inner = containers[j].querySelector(
                                'a[href*="/chat/"], [href*="/chat/"]'
                            );
                            if (inner) {
                                var ih = inner.getAttribute('href') || '';
                                if (ih.indexOf(jidLocal) !== -1) {
                                    inner.click();
                                    return true;
                                }
                            }
                        }

                        // 3. Match by phone digits in the row title (for contacts
                        //    whose display name IS their phone number, with formatting)
                        if (jidDigits && jidDigits.length >= 8) {
                            for (var k = 0; k < containers.length; k++) {
                                var titleEl = containers[k].querySelector(
                                    '[data-testid="cell-frame-title"]'
                                );
                                if (!titleEl) continue;
                                var digits = (titleEl.textContent || '').replace(/\\D/g, '');
                                // suffix match: jidDigits must be a suffix of the title digits
                                // (handles country-code variants)
                                if (digits.length >= 8 &&
                                    (digits === jidDigits ||
                                     digits.endsWith(jidDigits) ||
                                     jidDigits.endsWith(digits))) {
                                    containers[k].click();
                                    return true;
                                }
                            }
                        }

                        return false;
                        """,
                        jid_local,
                        jid_digits,
                    )
                )
            except Exception as exc:
                log.warning(
                    "fetch_chat_messages sidebar_click_error jid=%s: %s",
                    normalized,
                    exc,
                )

            if not clicked:
                log.info(
                    "fetch_chat_messages sidebar_click_miss jid=%s falling_back_to_get",
                    normalized,
                )
                slug = quote(normalized, safe="")
                target = WA_URL.rstrip("/") + f"/chat/{slug}"
                try:
                    driver.set_page_load_timeout(20)
                    driver.get(target)
                except Exception as exc:
                    log.warning(
                        "fetch_chat_messages driver_get_error jid=%s: %s",
                        normalized,
                        exc,
                    )

            log.info(
                "fetch_chat_messages nav_done jid=%s elapsed_ms=%.0f clicked=%s",
                normalized,
                (time.time() - t_start) * 1000,
                clicked,
            )

            # Step 2: Wait for the first message bubble using progressively broader
            # selectors in a single combined check so we don't waste time retrying
            # sequentially after a timeout.
            remaining = deadline - time.time()
            if remaining < 2.0:
                log.warning(
                    "fetch_chat_messages deadline_exceeded_before_bubble jid=%s elapsed_ms=%.0f",
                    normalized,
                    (time.time() - t_start) * 1000,
                )
                now_ms = int(time.time() * 1000)
                return {
                    "chat_jid": normalized,
                    "transcript": "",
                    "latest_message_iso": datetime.fromtimestamp(
                        now_ms / 1000, tz=timezone.utc
                    ).isoformat(),
                    "messages": [],
                }

            # Selectors tried in order from most to least specific.
            _BUBBLE_SELECTORS = (
                '[data-testid="msg-container"]',
                '[data-testid*="msg-"]',
                '#main [data-id]',
                'span[copyable-text]',
            )

            def _first_bubble_sel(d: webdriver.Chrome) -> Optional[str]:
                for sel in _BUBBLE_SELECTORS:
                    try:
                        if d.find_elements(By.CSS_SELECTOR, sel):
                            return sel
                    except Exception:
                        pass
                return None

            bubble_sel: Optional[str] = None
            try:
                bubble_sel = WebDriverWait(
                    driver, max(2.0, remaining - 1.0)
                ).until(_first_bubble_sel)
                log.info(
                    "fetch_chat_messages first_bubble jid=%s sel=%s elapsed_ms=%.0f",
                    normalized,
                    bubble_sel,
                    (time.time() - t_start) * 1000,
                )
            except Exception:
                log.warning(
                    "fetch_chat_messages first_bubble_timeout jid=%s elapsed_ms=%.0f "
                    "url=%s panel=%s",
                    normalized,
                    (time.time() - t_start) * 1000,
                    (driver.current_url or "")[:80],
                    bool(
                        driver.find_elements(
                            By.CSS_SELECTOR,
                            '[data-testid="conversation-panel-wrapper"]',
                        )
                    ),
                )
                now_ms = int(time.time() * 1000)
                return {
                    "chat_jid": normalized,
                    "transcript": "",
                    "latest_message_iso": datetime.fromtimestamp(
                        now_ms / 1000, tz=timezone.utc
                    ).isoformat(),
                    "messages": [],
                }

            # Step 3: Extract all visible message bubbles in one JS call.
            # bubble_sel is the selector that confirmed DOM presence; pass it
            # as a fallback container so Chrome uses the right elements.
            raw_msgs: List[Dict[str, Any]] = []
            try:
                raw_msgs = (
                    driver.execute_script(
                        """
                        var limit = arguments[0];
                        var bubbleSel = arguments[1];

                        var containers = document.querySelectorAll(
                            '[data-testid="msg-container"]'
                        );
                        if (!containers.length)
                            containers = document.querySelectorAll('#main [data-id]');
                        if (!containers.length && bubbleSel)
                            containers = document.querySelectorAll(bubbleSel);
                        if (!containers.length)
                            containers = document.querySelectorAll('[data-testid*="msg-"]');

                        var results = [];
                        var start = containers.length > limit
                            ? containers.length - limit : 0;
                        for (var i = start; i < containers.length; i++) {
                            var c = containers[i];
                            try {
                                var isOut = c.classList.contains('message-out') ||
                                            c.querySelector('.message-out') !== null;

                                var textEls = c.querySelectorAll(
                                    'span.selectable-text.copyable-text span'
                                );
                                if (!textEls.length)
                                    textEls = c.querySelectorAll('.selectable-text span');
                                if (!textEls.length)
                                    textEls = c.querySelectorAll('span[copyable-text]');
                                var texts = [];
                                for (var t = 0; t < textEls.length; t++) {
                                    var tx = (textEls[t].textContent || '').trim();
                                    if (tx) texts.push(tx);
                                }

                                // Skip non-text messages (photos, audio, video, docs).
                                if (!texts.length) continue;

                                var tsMs = 0;
                                var dataId = c.getAttribute('data-id') || '';
                                var m = dataId.match(/_([0-9]{10,})[^0-9]/);
                                if (!m) m = dataId.match(/_([0-9]{10,})$/);
                                if (m) {
                                    tsMs = parseInt(m[1], 10);
                                    if (tsMs < 400000000000) tsMs *= 1000;
                                }
                                if (!tsMs) {
                                    var tsEl = c.querySelector('[data-timestamp]');
                                    if (tsEl) {
                                        var rawTs = parseInt(
                                            tsEl.getAttribute('data-timestamp'), 10
                                        );
                                        if (!isNaN(rawTs)) tsMs = rawTs * 1000;
                                    }
                                }

                                var prefix = '';
                                var metaEl = c.querySelector('[data-pre-plain-text]');
                                if (metaEl) {
                                    prefix = (
                                        metaEl.getAttribute('data-pre-plain-text') || ''
                                    ).trim();
                                    var nl = prefix.indexOf('\n');
                                    if (nl >= 0) prefix = prefix.substring(0, nl);
                                    prefix = prefix.substring(0, 120);
                                }

                                results.push({
                                    isOut: isOut,
                                    text: texts.join(' '),
                                    tsMs: tsMs,
                                    prefix: prefix
                                });
                            } catch (e) { /* skip malformed bubble */ }
                        }
                        return results;
                        """,
                        max_messages,
                        bubble_sel or "",
                    )
                    or []
                )
            except Exception as exc:
                log.warning(
                    "fetch_chat_messages js_extract_error jid=%s bubble_sel=%s exc_type=%s: %s",
                    normalized,
                    bubble_sel,
                    type(exc).__name__,
                    str(exc)[:400],
                )
                raise RuntimeError("js_extract_failed") from exc

            if bubble_sel and not raw_msgs:
                log.warning(
                    "fetch_chat_messages js_extract_empty jid=%s bubble_sel=%s elapsed_ms=%.0f"
                    " — bubbles found in DOM but extraction returned 0 rows",
                    normalized,
                    bubble_sel,
                    (time.time() - t_start) * 1000,
                )
                raise RuntimeError("js_extract_empty")

            # Step 4: Build output from JS results.
            lines: List[str] = []
            message_rows: List[Dict[str, Any]] = []
            latest_seen_ms = -1
            now_ms = int(time.time() * 1000)

            for item in raw_msgs:
                try:
                    is_out = bool(item.get("isOut"))
                    role = "You" if is_out else "Customer"
                    side = "business" if is_out else "customer"
                    text = str(item.get("text") or "").strip()
                    ts_ms = int(item.get("tsMs") or 0) or now_ms
                    prefix = str(item.get("prefix") or "").strip()

                    if ts_ms > latest_seen_ms:
                        latest_seen_ms = ts_ms

                    snippet = (
                        f"[{ts_ms}] {role}: {prefix + ' • ' if prefix else ''}"
                        + text.replace("\n", " ").strip()
                    ).strip()
                    lines.append(snippet)

                    body_parts: List[str] = []
                    if prefix:
                        body_parts.append(prefix)
                    if text:
                        body_parts.append(text)
                    body = "\n".join(body_parts).strip()
                    if not body:
                        continue
                    iso_one = datetime.fromtimestamp(
                        ts_ms / 1000, tz=timezone.utc
                    ).isoformat()
                    message_rows.append(
                        {
                            "role": side,
                            "text": body,
                            "timestamp_ms": ts_ms,
                            "timestamp_iso": iso_one,
                        }
                    )
                except Exception:
                    continue

            transcript = "\n".join(line for line in lines if line)
            fallback_ms = latest_seen_ms if latest_seen_ms > 0 else now_ms
            latest_iso = datetime.fromtimestamp(
                fallback_ms / 1000, tz=timezone.utc
            ).isoformat()

            log.info(
                "fetch_chat_messages done jid=%s messages=%d elapsed_ms=%.0f",
                normalized,
                len(message_rows),
                (time.time() - t_start) * 1000,
            )

            return {
                "chat_jid": normalized,
                "transcript": transcript,
                "latest_message_iso": latest_iso,
                "messages": message_rows,
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
