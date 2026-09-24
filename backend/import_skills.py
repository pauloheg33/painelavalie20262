"""Relaciona habilidades por ano, componente e descrição, sem aproximação textual."""
import re
import unicodedata

import openpyxl


def normalize_description(value):
    text = unicodedata.normalize('NFKD', value.casefold())
    return re.sub(r'[^a-z0-9]', '', text.encode('ascii', 'ignore').decode())


def read_skills(source, items):
    mapping = {}
    with source.open('rb') as stream:
        workbook = openpyxl.load_workbook(stream, read_only=True, data_only=True)
        try:
            for row_number, row in enumerate(workbook['Habilidades'].iter_rows(min_row=7, values_only=True), 7):
                if not any(row):
                    continue
                grade, component, code, description, evaluation, network = row[:6]
                match = re.match(r'^(2|4|5|8|9)\D', str(grade))
                components = {'Língua Portuguesa': 'LP', 'Matemática': 'MT'}
                if not match or component not in components or not code or not description or evaluation != 'AVALIE.CE 2026.2' or network != 'Rede municipal':
                    raise ValueError(f'Habilidade inválida na linha {row_number}')
                key = (int(match[1]), components[component], normalize_description(description))
                if key in mapping and mapping[key][0] != code:
                    raise ValueError(f'Códigos ambíguos na linha {row_number}: {key}')
                mapping[key] = (str(code).strip(), 'Habilidades', row_number)
        finally:
            workbook.close()
    matched = {}
    for item_id, year, component, booklet, number, description in items.values():
        key = (year, component, normalize_description(description))
        if key not in mapping:
            raise ValueError(f'Habilidade sem correspondência: {item_id}: {description}')
        matched[item_id] = mapping[key]
    return matched
