import pandas as pd
import os
import unicodedata
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
VALID_COMPONENTES = {"Língua Portuguesa", "Matemática"}
FAIXA_CRITICO_MAX = 56
FAIXA_ATENCAO_MAX = 80


def normalizar_ano_label(valor):
    texto = str(valor).strip()
    match = pd.Series([texto]).str.extract(r"(?i)(\d+)\s*º?\s*ano\b")[0].iloc[0]
    if pd.notna(match):
        return f"{int(match)}º Ano"
    fallback = pd.Series([texto]).str.extract(r"(\d+)")[0].iloc[0]
    return f"{int(fallback)}º Ano" if pd.notna(fallback) else None


def escalar_percentual_serie(serie):
    numerica = pd.to_numeric(serie, errors="coerce")
    if numerica.dropna().empty:
        return numerica
    if numerica.dropna().abs().max() <= 1.0:
        return numerica * 100
    return numerica


def chave_escola(valor):
    texto = " ".join(str(valor).strip().upper().split())
    return "".join(
        c for c in unicodedata.normalize("NFKD", texto)
        if not unicodedata.combining(c)
    )


def construir_mapa_escolas():
    mapa = {}
    for path, kwargs in [
        (DATA_DIR / "desempenho_por_ano.xlsx", {"header": None, "skiprows": 2}),
        (DATA_DIR / "desempenho_por_ano_analise.xlsx", {"sheet_name": 0, "header": 1}),
        (DATA_DIR / "desempenho_por_turma.xlsx", {"sheet_name": "modelo_turmas"}),
    ]:
        if not path.exists():
            continue
        try:
            df = pd.read_excel(path, **kwargs)
        except ValueError:
            df = pd.read_excel(path)
        escola_col = "escola" if "escola" in df.columns else df.columns[0]
        for raw in df[escola_col].tolist():
            texto = str(raw).strip()
            if not texto or texto.lower() == "nan":
                continue
            mapa[chave_escola(texto)] = texto
    return mapa


MAPA_ESCOLAS = construir_mapa_escolas()


def normalizar_nome_escola(valor):
    texto = str(valor).strip()
    if not texto or texto.lower() == "nan":
        return None
    return MAPA_ESCOLAS.get(chave_escola(texto), texto)


def load_habilidades():
    path = DATA_DIR / "DADOS_ACERTO_POR_HABILIDADE.xlsx"
    df = pd.read_excel(path)
    df.columns = [
        "avaliacao", "rede", "ano_escolar", "componente",
        "escola", "habilidade_codigo", "habilidade_descricao",
        "acerto_pct", "nivel_dificuldade"
    ]
    df["ano_escolar"] = df["ano_escolar"].apply(normalizar_ano_label)
    df["escola"] = df["escola"].apply(normalizar_nome_escola)
    df["componente"] = df["componente"].str.strip()
    df["componente"] = df["componente"].map({"LP": "Língua Portuguesa", "MT": "Matemática"}).fillna(df["componente"])
    df = df[df["componente"].isin(VALID_COMPONENTES)].copy()
    df = df.dropna(subset=["ano_escolar", "escola", "habilidade_codigo"])
    df["acerto_pct"] = escalar_percentual_serie(df["acerto_pct"]).round(1)
    df["habilidade_pos"] = df["habilidade_codigo"].str.extract(r"(H\s?\d+)", expand=False).str.replace(" ", "")
    df["habilidade_descritor"] = df["habilidade_codigo"].str.extract(r"\(([^)]+)\)", expand=False).fillna(df["habilidade_codigo"])
    df["faixa"] = df["acerto_pct"].apply(classificar_faixa)
    return df


def load_desempenho():
    path = DATA_DIR / "desempenho_por_ano.xlsx"
    df = pd.read_excel(path, header=None, skiprows=2)
    df.columns = ["escola", "ano_escolar", "lp_pct", "mt_pct", "media_geral"]
    df["lp_pct"] = escalar_percentual_serie(df["lp_pct"]).round(1)
    df["mt_pct"] = escalar_percentual_serie(df["mt_pct"]).round(1)
    df["media_geral"] = escalar_percentual_serie(df["media_geral"]).round(1)
    df["ano_escolar"] = df["ano_escolar"].apply(normalizar_ano_label)
    df["escola"] = df["escola"].apply(normalizar_nome_escola)
    df = df.dropna(subset=["ano_escolar", "escola"])
    return df


def ano_sort_key(valor):
    match = pd.Series([str(valor)]).str.extract(r"(\d+)")[0].iloc[0]
    return int(match) if pd.notna(match) else 999


def classificar_faixa(pct):
    if pd.isna(pct):
        return "Sem dados"
    if pct <= FAIXA_CRITICO_MAX:
        return "Crítico"
    elif pct <= FAIXA_ATENCAO_MAX:
        return "Atenção"
    else:
        return "Adequado"


_hab_cache = None
_des_cache = None


def get_habilidades():
    global _hab_cache
    if _hab_cache is None:
        _hab_cache = load_habilidades()
    return _hab_cache


def get_desempenho():
    global _des_cache
    if _des_cache is None:
        _des_cache = load_desempenho()
    return _des_cache


def filtrar_habilidades(escola=None, ano=None, componente=None):
    df = get_habilidades().copy()
    if escola and escola != "Todas":
        df = df[df["escola"] == escola]
    if ano and ano != "Todos":
        df = df[df["ano_escolar"] == ano]
    if componente and componente != "Todos":
        df = df[df["componente"] == componente]
    return df


def get_filtros():
    df = get_habilidades()
    escolas = sorted([x for x in df["escola"].unique() if pd.notna(x)])
    anos = sorted([x for x in df["ano_escolar"].unique() if pd.notna(x)], key=ano_sort_key)
    componentes = [x for x in ["Língua Portuguesa", "Matemática"] if x in set(df["componente"].dropna())]
    return {
        "escolas": ["Todas"] + escolas,
        "anos": ["Todos"] + anos,
        "componentes": ["Todos"] + componentes,
    }


def get_indicadores(escola=None, ano=None, componente=None):
    df = filtrar_habilidades(escola, ano, componente)
    des = get_desempenho()

    if df.empty:
        return {
            "media_geral": 0, "total_habilidades": 0,
            "habilidades_criticas": 0, "habilidades_adequadas": 0,
            "melhor_desempenho": 0, "pior_desempenho": 0,
            "total_escolas": 0, "media_lp": 0, "media_mt": 0
        }

    hab_agg = df.groupby("habilidade_codigo")["acerto_pct"].mean()

    # Conta habilidades críticas/adequadas por escola (sem suavizar pela média geral)
    hab_escola = df.groupby(["escola", "habilidade_codigo"])["acerto_pct"].mean()
    criticas = int(hab_escola[hab_escola <= FAIXA_CRITICO_MAX].reset_index()["habilidade_codigo"].nunique())
    adequadas = int(hab_escola[hab_escola > 80].reset_index()["habilidade_codigo"].nunique())

    # Calcula LP e MT a partir dos dados de habilidades (sem depender do filtro de componente)
    df_all = get_habilidades().copy()
    if escola and escola != "Todas":
        df_all = df_all[df_all["escola"] == escola]
    if ano and ano != "Todos":
        df_all = df_all[df_all["ano_escolar"] == ano]
    lp_data = df_all[df_all["componente"] == "Língua Portuguesa"]["acerto_pct"]
    mt_data = df_all[df_all["componente"] == "Matemática"]["acerto_pct"]
    media_lp = round(lp_data.mean(), 1) if not lp_data.empty else 0
    media_mt = round(mt_data.mean(), 1) if not mt_data.empty else 0

    return {
        "media_geral": round(df["acerto_pct"].mean(), 1),
        "total_habilidades": int(hab_agg.shape[0]),
        "habilidades_criticas": criticas,
        "habilidades_adequadas": adequadas,
        "melhor_desempenho": round(hab_agg.max(), 1),
        "pior_desempenho": round(hab_agg.min(), 1),
        "total_escolas": int(df["escola"].nunique()),
        "media_lp": media_lp,
        "media_mt": media_mt,
    }


def get_habilidades_cards(escola=None, ano=None, componente=None):
    df = filtrar_habilidades(escola, ano, componente)
    if df.empty:
        return []
    agg = df.groupby(["habilidade_codigo", "habilidade_descricao", "habilidade_pos"]).agg(
        acerto_pct=("acerto_pct", "mean"),
        nivel_dificuldade=("nivel_dificuldade", "first")
    ).reset_index()
    agg["acerto_pct"] = agg["acerto_pct"].round(1)
    agg["faixa"] = agg["acerto_pct"].apply(classificar_faixa)
    agg = agg.sort_values("habilidade_pos")
    return agg.to_dict(orient="records")


def get_graficos_habilidades(escola=None, ano=None, componente=None):
    df = filtrar_habilidades(escola, ano, componente)
    if df.empty:
        return {"labels": [], "values": [], "faixas": []}
    agg = df.groupby("habilidade_pos")["acerto_pct"].mean().round(1)
    agg = agg.sort_index()
    faixas = [classificar_faixa(v) for v in agg.values]
    return {
        "labels": agg.index.tolist(),
        "values": agg.values.tolist(),
        "faixas": faixas
    }


def get_graficos_escolas():
    des = get_desempenho()
    des = des[des["escola"] != "Média Geral da Rede"]
    agg = des.groupby("escola").agg(
        lp=("lp_pct", "mean"),
        mt=("mt_pct", "mean"),
        media=("media_geral", "mean")
    ).round(1).reset_index()
    agg = agg.sort_values("media", ascending=False)
    return {
        "escolas": agg["escola"].tolist(),
        "lp": agg["lp"].tolist(),
        "mt": agg["mt"].tolist(),
        "media": agg["media"].tolist()
    }


def get_graficos_turmas(escola=None, ano=None, componente=None):
    des = get_desempenho()
    des = des[des["escola"] != "Média Geral da Rede"]
    if escola and escola != "Todas":
        des = des[des["escola"] == escola]
    if ano and ano != "Todos":
        des = des[des["ano_escolar"] == ano]
    records = []
    for _, row in des.iterrows():
        if componente and componente != "Todos" and componente == "Língua Portuguesa":
            records.append({"label": f"{row['escola'][:20]} - {row['ano_escolar']}", "value": row["lp_pct"]})
        elif componente and componente != "Todos" and componente == "Matemática":
            records.append({"label": f"{row['escola'][:20]} - {row['ano_escolar']}", "value": row["mt_pct"]})
        else:
            records.append({"label": f"{row['escola'][:20]} - {row['ano_escolar']}", "value": row["media_geral"]})
    records.sort(key=lambda x: x["value"] if pd.notna(x["value"]) else 0, reverse=True)
    return {
        "labels": [r["label"] for r in records],
        "values": [r["value"] for r in records]
    }


def get_distribuicao_faixas(escola=None, ano=None, componente=None):
    df = filtrar_habilidades(escola, ano, componente)
    order = ["Crítico", "Atenção", "Adequado"]
    if df.empty:
        return {"labels": order, "values": [0, 0, 0, 0]}
    agg = df.groupby("habilidade_pos")["acerto_pct"].mean()
    faixas = agg.apply(classificar_faixa)
    contagem = faixas.value_counts()
    labels = order
    values = [int(contagem.get(f, 0)) for f in order]
    return {"labels": labels, "values": values}


def get_insights(escola=None, ano=None, componente=None):
    df = filtrar_habilidades(escola, ano, componente)
    des = get_desempenho()
    des = des[des["escola"] != "Média Geral da Rede"]
    if escola and escola != "Todas":
        des = des[des["escola"] == escola]
    if ano and ano != "Todos":
        des = des[des["ano_escolar"] == ano]
    insights = []

    if df.empty:
        return ["Nenhum dado disponível para os filtros selecionados."]

    hab_media = df.groupby(["habilidade_pos", "habilidade_descricao"])["acerto_pct"].mean().round(1)
    hab_media = hab_media.reset_index()
    hab_media.columns = ["codigo", "descricao", "media"]

    pior = hab_media.loc[hab_media["media"].idxmin()]
    melhor = hab_media.loc[hab_media["media"].idxmax()]
    insights.append(f"A habilidade {pior['codigo']} ({pior['descricao'][:80]}) apresenta o menor desempenho da seleção: {pior['media']}%. Requer atenção prioritária.")
    insights.append(f"A habilidade {melhor['codigo']} ({melhor['descricao'][:80]}) apresenta o melhor desempenho: {melhor['media']}%.")

    criticas = hab_media[hab_media["media"] <= FAIXA_CRITICO_MAX]
    if len(criticas) > 0:
        insights.append(f"Existem {len(criticas)} habilidade(s) em nível CRÍTICO (≤56%): {', '.join(criticas['codigo'].tolist())}.")
    else:
        insights.append("Nenhuma habilidade está em nível crítico (≤56%). Bom indicador geral.")

    atencao = hab_media[(hab_media["media"] > FAIXA_CRITICO_MAX) & (hab_media["media"] <= FAIXA_ATENCAO_MAX)]
    if len(atencao) > 0:
        insights.append(f"{len(atencao)} habilidade(s) estão em nível de ATENÇÃO (56,01%-80%): {', '.join(atencao['codigo'].tolist())}.")

    lp_media = df[df["componente"] == "Língua Portuguesa"]["acerto_pct"].mean()
    mt_media = df[df["componente"] == "Matemática"]["acerto_pct"].mean()
    if pd.notna(lp_media) and pd.notna(mt_media):
        if lp_media > mt_media:
            insights.append(f"Língua Portuguesa ({lp_media:.1f}%) apresenta desempenho superior a Matemática ({mt_media:.1f}%).")
        elif mt_media > lp_media:
            insights.append(f"Matemática ({mt_media:.1f}%) apresenta desempenho superior a Língua Portuguesa ({lp_media:.1f}%).")
        else:
            insights.append(f"Língua Portuguesa e Matemática apresentam desempenho equivalente ({lp_media:.1f}%).")

    escola_agg = des.groupby("escola")["media_geral"].mean().round(1)
    if not escola_agg.empty:
        pior_escola = escola_agg.idxmin()
        melhor_escola = escola_agg.idxmax()
        insights.append(f"A escola com melhor desempenho médio é {melhor_escola} ({escola_agg[melhor_escola]}%).")
        insights.append(f"A escola com menor desempenho médio é {pior_escola} ({escola_agg[pior_escola]}%). Recomenda-se intervenção pedagógica direcionada.")

    esc_criticas = df.groupby("escola").apply(lambda g: (g.groupby("habilidade_pos")["acerto_pct"].mean() <= FAIXA_CRITICO_MAX).sum())
    if esc_criticas.max() > 0:
        escola_mais_critica = esc_criticas.idxmax()
        insights.append(f"A escola {escola_mais_critica} concentra o maior número de habilidades críticas ({esc_criticas.max()}).")

    return insights


def get_tabela_detalhada(escola=None, ano=None, componente=None):
    df = filtrar_habilidades(escola, ano, componente)
    if df.empty:
        return []
    cols = ["avaliacao", "escola", "ano_escolar", "componente",
            "habilidade_pos", "habilidade_descritor", "habilidade_descricao",
            "acerto_pct", "faixa", "nivel_dificuldade"]
    return df[cols].sort_values(["escola", "ano_escolar", "componente", "habilidade_pos"]).to_dict(orient="records")


def get_comparativo_componentes(escola=None, ano=None):
    df = get_habilidades().copy()
    if escola and escola != "Todas":
        df = df[df["escola"] == escola]
    if ano and ano != "Todos":
        df = df[df["ano_escolar"] == ano]
    agg = df.groupby("componente")["acerto_pct"].mean().round(1)
    return {"labels": agg.index.tolist(), "values": agg.values.tolist()}


def get_ranking_habilidades(escola=None, ano=None, componente=None, top=10, order="asc"):
    df = filtrar_habilidades(escola, ano, componente)
    if df.empty:
        return {"labels": [], "values": [], "descricoes": []}
    agg = df.groupby(["habilidade_pos", "habilidade_descricao"])["acerto_pct"].mean().round(1).reset_index()
    agg.columns = ["codigo", "descricao", "media"]
    ascending = order == "asc"
    agg = agg.sort_values("media", ascending=ascending).head(top)
    return {
        "labels": agg["codigo"].tolist(),
        "values": agg["media"].tolist(),
        "descricoes": agg["descricao"].tolist()
    }
