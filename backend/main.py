from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
from urllib.parse import urlsplit

from backend.services.data_service import get_painel
from backend.services.student_service import get_student_results, get_student_detail

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


@app.get('/students.js')
def student_script():
    return FileResponse(FRONTEND_DIR / 'students.js', media_type='application/javascript')


def require_local(request):
    allowed = {'127.0.0.1','::1','localhost'}
    if not request.client or request.client.host not in allowed or request.url.hostname not in allowed:
        raise HTTPException(403, 'A consulta nominal está disponível apenas no acesso local.')
    origin = request.headers.get('origin')
    if origin and urlsplit(origin).hostname not in allowed:
        raise HTTPException(403, 'Origem não permitida para consulta nominal.')


@app.get('/api/alunos')
def student_results(request: Request, escola: str | None = Query(None,max_length=200),
                    ano: str | None = Query(None,max_length=20),
                    componente: str | None = Query(None,max_length=50)):
    require_local(request)
    try:
        return JSONResponse(get_student_results(escola,ano,componente,identified=True),
                            headers={'Cache-Control':'no-store'})
    except FileNotFoundError as exc:
        raise HTTPException(503,str(exc)) from exc


@app.get('/api/alunos/{record_id}')
def student_detail(request: Request, record_id: int,
                   componente: str | None = Query(None,max_length=50)):
    require_local(request)
    try:
        result = get_student_detail(record_id,componente)
    except FileNotFoundError as exc:
        raise HTTPException(503,str(exc)) from exc
    if result is None:
        raise HTTPException(404,'Registro de avaliação não encontrado.')
    return JSONResponse(result,headers={'Cache-Control':'no-store'})


@app.get("/api/painel")
def painel(escola: str | None = Query(None, max_length=200),
           ano: str | None = Query(None, max_length=20),
           componente: str | None = Query(None, max_length=50)):
    try:
        return get_painel(escola, ano, componente)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
