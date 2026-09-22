"""Publica somente consultas agregadas; SQLite e registros individuais ficam locais."""
from itertools import product
import json
from pathlib import Path
import shutil

from backend.services.data_service import get_painel

ROOT = Path(__file__).resolve().parent


def export_static(destination=ROOT / 'docs'):
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    data_dir = destination / 'data'
    data_dir.mkdir(exist_ok=True)
    base = get_painel()
    shared = {k: base[k] for k in ('avaliacao','metodologia','metadata','analise','filtros','participacao')}
    manifest = {'shared': shared, 'consultas': {}}
    filters = base['filtros']
    for index, (school, year, component) in enumerate(product(filters['escolas'],filters['anos'],filters['componentes'])):
        payload = get_painel(school, year, component)
        # Lista explícita de campos agregados: nenhuma consulta de registros individuais.
        result = {k: payload[k] for k in ('indicadores','itens','registros','distribuicao')}
        name = f'{index:03d}.json'
        (data_dir / name).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        key = json.dumps([school,year,component],ensure_ascii=False,separators=(',',':'))
        manifest['consultas'][key] = name
    (data_dir / 'index.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    for filename in ('index.html','style.css','script.js'):
        shutil.copyfile(ROOT / 'frontend' / filename, destination / filename)
    (destination / 'config.js').write_text('window.AVALIE_STATIC = true;\n',encoding='utf-8')
    (destination / '.nojekyll').write_text('',encoding='utf-8')
    print(f'Exportação estática: {len(manifest["consultas"])} consultas agregadas em {destination}')
    return manifest


if __name__ == '__main__':
    export_static()
