"""Resultados por registro de prova; não une estudantes por nome."""
from contextlib import closing
from collections import defaultdict

from backend.services.data_service import connect, classificar_faixa, rounded, COMPONENTES


def selected_records(conn, escola=None, ano=None, componente=None):
    clauses, params = [], []
    if escola and escola != 'Todas':
        clauses.append('s.name = ?')
        params.append(escola)
    if ano and ano != 'Todos':
        clauses.append("CAST(e.year AS TEXT) || 'º Ano' = ?")
        params.append(ano)
    if componente and componente != 'Todos':
        clauses.append('i.component = ?')
        params.append(next((code for code,name in COMPONENTES.items() if name == componente), 'INVALID'))
    where = 'WHERE ' + ' AND '.join(clauses) if clauses else ''
    # WHERE contém somente cláusulas constantes. Todos os valores são parametrizados.
    query = f'''SELECT e.id, e.student_name aluno, s.name escola, e.year ano,
        e.booklet caderno, e.discipline disciplina_caderno,
        e.correct_count acertos_informados, e.wrong_count erros_informados,
        e.reported_rate * 100 percentual_informado,
        e.source_sheet origem_aba, e.source_row origem_linha,
        COUNT(*) itens, SUM(a.is_correct) acertos,
        (SELECT SUM(1-aa.is_correct) FROM item_answers aa WHERE aa.record_id=e.id) erros_lista_caderno
        FROM evaluation_records e JOIN schools s ON s.id=e.school_id
        JOIN item_answers a ON a.record_id=e.id JOIN items i ON i.id=a.item_id
        {where} GROUP BY e.id ORDER BY e.student_name COLLATE NOCASE, s.name, e.year, e.booklet'''
    records = []
    for raw in conn.execute(query, params):
        row = dict(raw)
        value = 100 * row['acertos'] / row['itens']
        row.update(ano_escolar=f"{row['ano']}º Ano", erros=row['itens']-row['acertos'],
                   percentual=rounded(value), faixa=classificar_faixa(value),
                   componente=componente if componente and componente != 'Todos' else row['disciplina_caderno'],
                   divergente=row['erros_informados'] != row['erros_lista_caderno'])
        row['percentual_informado'] = rounded(row['percentual_informado'])
        records.append(row)
    return records


def summarize(records):
    total_items = sum(r['itens'] for r in records)
    correct = sum(r['acertos'] for r in records)
    bands = ['Crítico','Atenção','Adequado']
    return {'registros': len(records),
            'media_registros': rounded(sum(100*r['acertos']/r['itens'] for r in records)/len(records)) if records else None,
            'percentual_itens': rounded(100*correct/total_items) if total_items else None,
            'acertos': correct, 'itens': total_items,
            'divergentes': sum(r['divergente'] for r in records),
            'distribuicao': {'labels': bands, 'values': [sum(r['faixa']==b for r in records) for b in bands]}}


def get_student_results(escola=None, ano=None, componente=None, *, identified=False):
    with closing(connect()) as conn:
        records = selected_records(conn, escola, ano, componente)
        has_individual = conn.execute('SELECT COUNT(*) FROM evaluation_records').fetchone()[0] > 0
    result = {'disponivel':has_individual, 'identificado':identified, 'resumo':summarize(records)}
    if identified:
        result['registros'] = records
    else:
        # Exportação pública contém somente grupos escola/ano/caderno, nunca linhas individuais.
        grouped = defaultdict(list)
        for row in records:
            grouped[row['escola'],row['ano'],row['caderno'],row['componente']].append(row)
        result['grupos'] = [{'escola':school, 'ano_escolar':f'{year}º Ano', 'caderno':booklet,
                             'componente':component, **summarize(members)}
                            for (school,year,booklet,component),members in sorted(grouped.items())]
    return result


def get_student_detail(record_id, componente=None):
    with closing(connect()) as conn:
        record = conn.execute('''SELECT e.id,e.student_name aluno,s.name escola,e.year ano,e.booklet caderno,
            e.correct_count acertos_informados,e.wrong_count erros_informados,
            e.reported_rate * 100 percentual_informado,e.wrong_items questoes_erradas_informadas,
            e.source_sheet origem_aba,e.source_row origem_linha
            FROM evaluation_records e JOIN schools s ON s.id=e.school_id WHERE e.id=?''',(record_id,)).fetchone()
        if record is None:
            return None
        clauses, params = ['a.record_id=?'], [record_id]
        if componente and componente != 'Todos':
            clauses.append('i.component=?')
            params.append(next((code for code,name in COMPONENTES.items() if name == componente),'INVALID'))
        items = [dict(row) for row in conn.execute('''SELECT i.number numero,i.component sigla,
            i.description habilidade,i.skill_code habilidade_codigo,a.alternative alternativa,a.is_correct acerto
            FROM item_answers a JOIN items i ON i.id=a.item_id WHERE ''' + ' AND '.join(clauses)
            + ' ORDER BY i.component,i.number', params)]
    return {**dict(record), 'itens':items}
