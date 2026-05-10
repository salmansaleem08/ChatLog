"""ChatLog automation service. Run: uvicorn main:app --host 0.0.0.0 --port $PORT"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field

from session_manager import get_manager, normalize_business_id

load_dotenv(Path(__file__).resolve().parent / ".env")

_LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, _LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s [chatlog] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("chatlog.api")

app = FastAPI(title="ChatLog Service")


def require_automation_secret(
    x_chatlog_secret: Optional[str] = Header(default=None, alias="X-ChatLog-Secret"),
) -> None:
    expected = os.environ.get("CHATLOG_AUTOMATION_SECRET", "").strip()
    if not expected or not x_chatlog_secret or x_chatlog_secret != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


class StartBody(BaseModel):
    business_id: str = Field(..., min_length=32, max_length=64)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/whatsapp/session/start")
def whatsapp_session_start(
    body: StartBody,
    _: Any = Depends(require_automation_secret),
) -> dict:
    """
    Launch Chrome for this business_id, open WhatsApp Web, reuse on-disk profile.
    """
    try:
        bid = normalize_business_id(body.business_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid business_id") from exc

    try:
        get_manager(bid).ensure_started()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not start browser session: {exc!s}",
        ) from exc
    status = get_manager(bid).get_status()
    return {"ok": True, "business_id": bid, **status}


@app.get("/whatsapp/session/status")
def whatsapp_session_status(
    business_id: str = Query(..., min_length=32, max_length=64),
    _: Any = Depends(require_automation_secret),
) -> dict:
    try:
        bid = normalize_business_id(business_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid business_id") from exc

    mgr = get_manager(bid)
    try:
        mgr.ensure_started()
        status_payload = mgr.get_status()
        return {"ok": True, "business_id": bid, **status_payload}
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"WhatsApp automation error: {exc!s}",
        ) from exc


@app.get("/whatsapp/chats/list")
def whatsapp_chats_list(
    business_id: str = Query(..., min_length=32, max_length=64),
    _: Any = Depends(require_automation_secret),
) -> dict:
    try:
        bid = normalize_business_id(business_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid business_id") from exc
    mgr = get_manager(bid)
    try:
        log.info("chats_list start business_id=%s", bid)
        mgr.ensure_started()
        chats = mgr.list_chats()
        log.info("chats_list ok business_id=%s count=%s", bid, len(chats))
        return {"ok": True, "business_id": bid, "chats": chats}
    except RuntimeError as exc:
        reason = str(exc)
        log.warning(
            "chats_list failed business_id=%s reason=%s",
            bid,
            reason,
            exc_info=True,
        )
        if reason == "not_logged_in":
            code = 409
        elif reason in ("chat_list_timeout", "driver_not_initialized") or reason.startswith(
            "driver"
        ):
            code = 503
        else:
            code = 500
        raise HTTPException(status_code=code, detail=f"cannot_list_chats:{reason}") from exc


@app.get("/whatsapp/chat/messages")
def whatsapp_chat_messages(
    business_id: str = Query(..., min_length=32, max_length=64),
    chat_jid: str = Query(..., min_length=5, max_length=120),
    _: Any = Depends(require_automation_secret),
) -> dict:
    try:
        bid = normalize_business_id(business_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid business_id") from exc
    mgr = get_manager(bid)
    try:
        mgr.ensure_started()
        payload = mgr.fetch_chat_messages(chat_jid)
        return {"ok": True, "business_id": bid, **payload}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        reason = str(exc)
        raise HTTPException(
            status_code=409 if reason == "not_logged_in" else 500,
            detail=f"cannot_read_messages:{reason}",
        ) from exc


@app.get("/whatsapp/session/qr")
def whatsapp_session_qr(
    business_id: str = Query(..., min_length=32, max_length=64),
    _: Any = Depends(require_automation_secret),
) -> Response:
    """PNG of the QR canvas when the session is waiting for scan (may be empty)."""
    try:
        bid = normalize_business_id(business_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid business_id") from exc

    mgr = get_manager(bid)
    try:
        mgr.ensure_started()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not start browser session: {exc!s}",
        ) from exc

    png = mgr.get_qr_png()
    if not png:
        st = mgr.get_status()
        if st.get("logged_in"):
            log.info("session_qr skip already_logged_in business_id=%s", bid)
            raise HTTPException(status_code=409, detail="already_logged_in")
        log.warning(
            "session_qr not_ready business_id=%s running=%s needs_qr=%s",
            bid,
            st.get("running"),
            st.get("needs_qr"),
        )
        raise HTTPException(status_code=404, detail="qr_not_ready")
    return Response(content=png, media_type="image/png")
