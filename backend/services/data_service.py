"""Consultas do painel: escola × ano × componente × item."""
from collections import defaultdict
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / "backend" / "data" / "avalie.sqlite3"
AVALIACAO = "AVALIE.CE 2026.2"
COMPONENTES = {"LP": "Língua Portuguesa", "MT": "Matemática"}
METODOLOGIA = (
    "Taxas importadas da consolidação por item. Médias calculadas sobre as taxas "
    "disponíveis, sem ponderação pelo número de registros de cada escola. "
    "A base individual ainda não foi importada. Os resultados não representam "
    "contagens de estudantes nem uma nova correção por gabarito."
)
METODOLOGIA_INDIVIDUAL = (
    "Taxas por item apuradas pelas listas de questões erradas e conferidas com a consolidação. "
    "Médias = acertos em itens ÷ oportunidades de resposta, com os registros de cada prova. "
    "Registros de avaliação não equivalem a estudantes distintos. Sem nova correção por gabarito."
)


def database_path():
    return Path(os.environ.get("AVALIE_DB", DEFAULT_DB)).resolve()


def connect():
    path = database_path()
    if not path.is_file():
        raise FileNotFoundError("Banco não encontrado. Execute python build.py para importar a consolidação.")
    conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def classificar_faixa(pct):
    if pct is None:
        return "Sem dados"
    return "Crítico" if pct <= 56 else "Atenção" if pct <= 80 else "Adequado"


def average(rows):
    if rows and all(r.get('registros_avaliacao') is not None for r in rows):
        denominator = sum(r['registros_avaliacao'] for r in rows)
        return 100 * sum(r['acertos_item'] for r in rows) / denominator if denominator else None
    values = [r["acerto_pct"] for r in rows if r["acerto_pct"] is not None]
    return sum(values) / len(values) if values else None


def rounded(value):
    return round(value, 1) if value is not None else None


def groups(rows, key):
    result = defaultdict(list)
    for row in rows:
        result[key(row)].append(row)
    return result


def load_rows(conn):
    rows = conn.execute("""
        SELECT s.name escola, i.id item_key, i.year ano, i.component sigla,
               i.booklet caderno, i.number item_numero, i.description habilidade_descricao,
               r.rate * 100 acerto_pct, r.source_sheet origem_aba, r.source_row origem_linha,
               a.registros_avaliacao, a.acertos_item
        FROM item_rates r JOIN schools s ON s.id=r.school_id JOIN items i ON i.id=r.item_id
        LEFT JOIN (
            SELECT e.school_id, a.item_id, COUNT(*) registros_avaliacao, SUM(a.is_correct) acertos_item
            FROM item_answers a JOIN evaluation_records e ON e.id=a.record_id
            GROUP BY e.school_id, a.item_id
        ) a ON a.school_id=r.school_id AND a.item_id=r.item_id
        ORDER BY s.name, i.year, i.component, i.number
    """).fetchall()
    result = []
    for raw in rows:
        row = dict(raw)
        row.update(avaliacao=AVALIACAO, ano_escolar=f"{row['ano']}º Ano",
                   componente=COMPONENTES[row["sigla"]], habilidade_codigo=row["item_key"],
                   habilidade_pos=f"Item {row['item_numero']:02d}",
                   habilidade_descritor=row["caderno"], faixa=classificar_faixa(row["acerto_pct"]))
        result.append(row)
    return result


def filter_rows(rows, escola=None, ano=None, componente=None):
    return [r for r in rows
            if (not escola or escola == "Todas" or r["escola"] == escola)
            and (not ano or ano == "Todos" or r["ano_escolar"] == ano)
            and (not componente or componente == "Todos" or r["componente"] == componente)]


def aggregate_items(rows):
    result = []
    for key, members in groups(rows, lambda r: r["item_key"]).items():
        row = members[0].copy()
        value = average(members)
        schools = sorted({r["escola"] for r in members})
        row.update(acerto_pct=rounded(value), faixa=classificar_faixa(value),
                   escola=schools[0] if len(schools) == 1 else f"{len(schools)} escolas",
                   total_escolas=len(schools))
        if all(r['registros_avaliacao'] is not None for r in members):
            row['registros_avaliacao'] = sum(r['registros_avaliacao'] for r in members)
            row['acertos_item'] = sum(r['acertos_item'] for r in members)
        result.append(row)
    return sorted(result, key=lambda r: (r["ano"], r["sigla"], r["item_numero"]))


def school_analysis(rows):
    schools, detail = [], []
    for escola, members in groups(rows, lambda r: r["escola"]).items():
        value = average(members)
        schools.append({"escola": escola, "media": rounded(value),
                        "lp": rounded(average([r for r in members if r["sigla"] == "LP"])),
                        "mt": rounded(average([r for r in members if r["sigla"] == "MT"])),
                        "hab_criticas": sum(r["faixa"] == "Crítico" for r in members),
                        "classificacao": classificar_faixa(value)})
        for year, subset in groups(members, lambda r: r["ano"]).items():
            detail.append({"escola": escola, "ano_escolar": f"{year}º Ano",
                           "lp_pct": rounded(average([r for r in subset if r["sigla"] == "LP"])),
                           "mt_pct": rounded(average([r for r in subset if r["sigla"] == "MT"])),
                           "media_geral": rounded(average(subset)), 'faixa': classificar_faixa(average(subset))})
    stages = [{'ano_escolar': f'{year}º Ano', 'media': rounded(average(subset)),
               'lp': rounded(average([r for r in subset if r['sigla'] == 'LP'])),
               'mt': rounded(average([r for r in subset if r['sigla'] == 'MT']))}
              for year, subset in sorted(groups(rows, lambda r: r['ano']).items())]
    return {"escolas": sorted(schools, key=lambda r: r["media"], reverse=True), "detalhe": detail,
            'etapas': stages,
            "rede": {"media": rounded(average(rows)),
                     "lp": rounded(average([r for r in rows if r["sigla"] == "LP"])),
                     "mt": rounded(average([r for r in rows if r["sigla"] == "MT"]))}}


def get_painel(escola=None, ano=None, componente=None):
    with closing(connect()) as conn:
        all_rows = load_rows(conn)
        metadata = {r["key"]: json.loads(r["value"]) for r in conn.execute("SELECT * FROM metadata")}
        participation = [dict(r) for r in conn.execute('''
            SELECT s.name escola, e.year ano, e.booklet caderno, COUNT(*) registros
            FROM evaluation_records e JOIN schools s ON s.id=e.school_id
            GROUP BY s.name, e.year, e.booklet ORDER BY s.name, e.year, e.booklet
        ''')]
    rows = filter_rows(all_rows, escola, ano, componente)
    items = aggregate_items(rows)
    all_components = filter_rows(all_rows, escola, ano)
    values = [r["acerto_pct"] for r in items]
    distribution = {f: sum(r["faixa"] == f for r in items) for f in ("Crítico", "Atenção", "Adequado")}
    indicators = {
        "media_geral": rounded(average(rows)), "total_habilidades": len(items),
        "habilidades_criticas": distribution["Crítico"], "habilidades_adequadas": distribution["Adequado"],
        "melhor_desempenho": max(values) if values else None,
        "pior_desempenho": min(values) if values else None,
        "total_escolas": len({r["escola"] for r in rows}),
        "media_lp": rounded(average([r for r in all_components if r["sigla"] == "LP"])),
        "media_mt": rounded(average([r for r in all_components if r["sigla"] == "MT"])),
    }
    analysis = school_analysis(all_rows)
    selected_proofs = {(r['escola'], r['ano'], r['caderno']) for r in rows}
    indicators['registros_avaliacao'] = (sum(p['registros'] for p in participation
        if (p['escola'],p['ano'],p['caderno']) in selected_proofs)
        if metadata['base_individual_importada'] else None)
    for row in rows:
        row["acerto_pct"] = rounded(row["acerto_pct"])
    methodology = METODOLOGIA_INDIVIDUAL if metadata['base_individual_importada'] else METODOLOGIA
    if metadata.get('divergencias_totais_listas'):
        methodology += f" Atenção: {len(metadata['divergencias_totais_listas'])} registros possuem divergência entre o total de erros informado e a lista; prevalece a lista na apuração por item."
    return {"avaliacao": AVALIACAO, "metodologia": methodology, "metadata": metadata,
            'participacao': participation,
            "indicadores": indicators, "itens": items, "registros": rows,
            "distribuicao": {"labels": list(distribution), "values": list(distribution.values())},
            "analise": analysis,
            "filtros": {"escolas": ["Todas"] + sorted({r["escola"] for r in all_rows}),
                        "anos": ["Todos"] + [f"{y}º Ano" for y in sorted({r["ano"] for r in all_rows})],
                        "componentes": ["Todos"] + list(COMPONENTES.values())}}
