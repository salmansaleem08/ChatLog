"""ChatLog HTTP service (scaffold). Run locally: uvicorn main:app --reload"""

from fastapi import FastAPI

app = FastAPI(title="ChatLog Service")

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
