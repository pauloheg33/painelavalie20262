from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from pathlib import Path

from backend.services.data_service import get_painel

app = FastAPI(title="AVALIE.CE 2026.2 — Ararendá–CE")
FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"


@app.get("/")
def root():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/style.css")
def stylesheet():
    return FileResponse(FRONTEND_DIR / "style.css", media_type="text/css")


@app.get("/script.js")
def script():
    return FileResponse(FRONTEND_DIR / "script.js", media_type="application/javascript")


@app.get('/config.js')
def configuration():
    return FileResponse(FRONTEND_DIR / 'config.js', media_type='application/javascript')


@app.get("/api/painel")
def painel(escola: str | None = Query(None, max_length=200),
           ano: str | None = Query(None, max_length=20),
           componente: str | None = Query(None, max_length=50)):
    try:
        return get_painel(escola, ano, componente)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
