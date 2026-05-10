"""ChatLog automation service. Run: uvicorn main:app --host 0.0.0.0 --port $PORT"""

from fastapi import FastAPI, HTTPException

from session_manager import get_manager

app = FastAPI(title="ChatLog Service")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/whatsapp/session/start")
def whatsapp_session_start() -> dict:
    """
    Launch Chrome (if needed), open WhatsApp Web, reuse on-disk profile.
    Returns whether a QR scan is likely required and whether a session looks logged in.
    """
    try:
        get_manager().ensure_started()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not start browser session: {exc!s}",
        ) from exc
    status = get_manager().get_status()
    return {"ok": True, **status}


@app.get("/whatsapp/session/status")
def whatsapp_session_status() -> dict:
    """Current session state without starting a new browser."""
    return get_manager().get_status()
