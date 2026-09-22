from contextlib import closing
import os
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from build import build, DEFAULT_SOURCE, BOOKLETS
from backend.services.data_service import get_painel, classificar_faixa
from backend.main import painel
from fastapi import HTTPException
from backend.import_records import parse_wrong_items


class PainelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.database = Path(cls.directory.name) / 'test.sqlite3'
        build(DEFAULT_SOURCE, cls.database)
        cls.environment = patch.dict(os.environ, {'AVALIE_DB': str(cls.database)})
        cls.environment.start()

    @classmethod
    def tearDownClass(cls):
        cls.environment.stop()
        cls.directory.cleanup()

    def test_coverage_and_identity(self):
        data = get_painel()
        self.assertEqual(len(data['registros']), 1312)
        self.assertEqual(len(data['itens']), 236)
        self.assertEqual(len(data['filtros']['escolas']), 8)
        self.assertEqual(data['filtros']['anos'], ['Todos', '2º Ano', '4º Ano', '5º Ano', '8º Ano', '9º Ano'])
        self.assertEqual(data['metadata']['registros_avaliacao'], 896)
        self.assertEqual(data['metadata']['taxas_reconciliadas'], 1312)
        self.assertEqual(len(data['metadata']['divergencias_totais_listas']), 6)
        self.assertIsNone(data['metadata']['estudantes_distintos'])
        self.assertEqual(len({r['item_key'] for r in data['itens']}), 236)

    def test_each_year_component_and_booklet(self):
        for year, components in BOOKLETS.items():
            for component, (booklet, first, last) in components.items():
                name = 'Língua Portuguesa' if component == 'LP' else 'Matemática'
                data = get_painel(ano=f'{year}º Ano', componente=name)
                self.assertEqual({r['caderno'] for r in data['itens']}, {booklet})
                self.assertEqual([r['item_numero'] for r in data['itens']], list(range(first, last + 1)))
                self.assertEqual(data['indicadores']['total_escolas'], 6 if year in (2,4,5) else 5)
                self.assertEqual(sum(data['distribuicao']['values']), len(data['itens']))

    def test_reference_cell_and_independent_sql_average(self):
        data = get_painel('EEF FIRMINO JOSÉ', '2º Ano', 'Língua Portuguesa')
        row = data['itens'][0]
        self.assertEqual(row['acerto_pct'], 97.5)
        self.assertEqual(row['origem_linha'], 4)
        with closing(sqlite3.connect(self.database)) as conn:
            value = conn.execute('SELECT AVG(is_correct)*100 FROM item_answers').fetchone()[0]
        self.assertEqual(get_painel()['indicadores']['media_geral'], round(value, 1))

    def test_no_records_is_not_zero(self):
        data = get_painel('EEF 21 DE DEZEMBRO', '2º Ano')
        self.assertEqual(data['registros'], [])
        self.assertIsNone(data['indicadores']['media_geral'])
        self.assertEqual(data['distribuicao']['values'], [0,0,0])

    def test_boundaries(self):
        for value, expected in [(None,'Sem dados'), (0,'Crítico'), (56,'Crítico'),
                                (56.01,'Atenção'), (80,'Atenção'), (80.01,'Adequado'), (100,'Adequado')]:
            self.assertEqual(classificar_faixa(value), expected)

    def test_booklet_records_not_double_counted(self):
        self.assertEqual(get_painel()['indicadores']['registros_avaliacao'], 896)
        expected = {2:338, 4:98, 5:150, 8:149, 9:161}
        for year, count in expected.items():
            self.assertEqual(get_painel(ano=f'{year}º Ano')['indicadores']['registros_avaliacao'], count)
        self.assertEqual(get_painel(ano='2º Ano', componente='Língua Portuguesa')['indicadores']['registros_avaliacao'], 173)
        self.assertEqual(get_painel(ano='2º Ano', componente='Matemática')['indicadores']['registros_avaliacao'], 165)
        self.assertEqual(get_painel(ano='4º Ano', componente='Matemática')['indicadores']['registros_avaliacao'], 98)

    def test_item_rate_uses_actual_denominator(self):
        data = get_painel(ano='2º Ano', componente='Língua Portuguesa')
        item = data['itens'][0]
        self.assertEqual(item['registros_avaliacao'], 173)
        self.assertEqual(item['acerto_pct'], round(100 * item['acertos_item'] / 173, 1))

    def test_wrong_item_parsing(self):
        self.assertEqual(parse_wrong_items('Nenhuma',22,0),set())
        self.assertEqual(parse_wrong_items('01, 22',22,2),{1,22})
        self.assertEqual(parse_wrong_items('01, 22',22,3),{1,22})
        for value, errors in [(None,1), ('01, 01',2), ('00, 23',2), ('01;22',2)]:
            with self.assertRaises(ValueError):
                parse_wrong_items(value,22,errors)

    def test_no_student_names_in_api_payload(self):
        data = get_painel()
        self.assertNotIn('student_name', str(data))
        with closing(sqlite3.connect(self.database)) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM evaluation_records').fetchone()[0],896)
            name = conn.execute('SELECT student_name FROM evaluation_records LIMIT 1').fetchone()[0]
            self.assertNotIn(name, str(data))

    def test_static_queries_match_database(self):
        root = Path(__file__).resolve().parents[1] / 'docs' / 'data'
        manifest = json.loads((root / 'index.json').read_text(encoding='utf-8'))
        self.assertEqual(len(manifest['consultas']),144)
        for selection in [('Todas','Todos','Todos'), ('Todas','2º Ano','Matemática'),
                          ('EEF 21 DE DEZEMBRO','2º Ano','Todos')]:
            key = json.dumps(selection,ensure_ascii=False,separators=(',',':'))
            actual = json.loads((root / manifest['consultas'][key]).read_text(encoding='utf-8'))
            expected = get_painel(*selection)
            for field in ('indicadores','itens','registros','distribuicao'):
                self.assertEqual(actual[field],expected[field])

    def test_parameterized_school_filter(self):
        self.assertEqual(get_painel("' OR 1=1 --")['registros'], [])

    def test_failed_import_preserves_existing_database(self):
        original = self.database.read_bytes()
        with patch('build.read_source', side_effect=ValueError('Item duplicado')):
            with self.assertRaises(ValueError):
                build(DEFAULT_SOURCE, self.database)
        self.assertEqual(self.database.read_bytes(), original)

    def test_missing_db_reports_503(self):
        with patch.dict(os.environ, {'AVALIE_DB': str(self.database.parent / 'missing.sqlite3')}):
            with self.assertRaises(HTTPException) as result:
                painel(None, None, None)
            self.assertEqual(result.exception.status_code, 503)


if __name__ == '__main__':
    unittest.main()
