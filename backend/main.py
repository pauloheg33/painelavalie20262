from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from services.data_service import (
    get_filtros, get_indicadores, get_habilidades_cards,
    get_graficos_habilidades, get_graficos_escolas, get_graficos_turmas,
    get_distribuicao_faixas, get_insights, get_tabela_detalhada,
    get_comparativo_componentes, get_ranking_habilidades
)

app = FastAPI(title="Dashboard CICLO II 2026 - Ararendá")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
def root():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/api/filtros")
def filtros():
    return get_filtros()


@app.get("/api/indicadores")
def indicadores(
    escola: str = Query(None),
    ano: str = Query(None),
    componente: str = Query(None)
):
    return get_indicadores(escola, ano, componente)


@app.get("/api/habilidades")
def habilidades(
    escola: str = Query(None),
    ano: str = Query(None),
    componente: str = Query(None)
):
    return get_habilidades_cards(escola, ano, componente)


@app.get("/api/graficos/habilidades")
def graf_habilidades(
    escola: str = Query(None),
    ano: str = Query(None),
    componente: str = Query(None)
):
    return get_graficos_habilidades(escola, ano, componente)


@app.get("/api/graficos/escolas")
def graf_escolas():
    return get_graficos_escolas()


@app.get("/api/graficos/turmas")
def graf_turmas(
    escola: str = Query(None),
    ano: str = Query(None),
    componente: str = Query(None)
):
    return get_graficos_turmas(escola, ano, componente)


@app.get("/api/graficos/distribuicao")
def graf_distribuicao(
    escola: str = Query(None),
    ano: str = Query(None),
    componente: str = Query(None)
):
    return get_distribuicao_faixas(escola, ano, componente)


@app.get("/api/graficos/componentes")
def graf_componentes(
    escola: str = Query(None),
    ano: str = Query(None)
):
    return get_comparativo_componentes(escola, ano)


@app.get("/api/graficos/ranking")
def graf_ranking(
    escola: str = Query(None),
    ano: str = Query(None),
    componente: str = Query(None),
    top: int = Query(10),
    order: str = Query("asc")
):
    return get_ranking_habilidades(escola, ano, componente, top, order)


@app.get("/api/insights")
def insights(
    escola: str = Query(None),
    ano: str = Query(None),
    componente: str = Query(None)
):
    return get_insights(escola, ano, componente)


@app.get("/api/tabela")
def tabela(
    escola: str = Query(None),
    ano: str = Query(None),
    componente: str = Query(None)
):
    return get_tabela_detalhada(escola, ano, componente)
