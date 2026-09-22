# AVALIE.CE 2026.2 — Ararendá–CE

Painel da rede municipal para o 2º, 4º, 5º, 8º e 9º anos do Ensino Fundamental, em Língua Portuguesa e Matemática. Mantém o design do painel original, com importação da consolidação Excel para SQLite e consultas por uma API FastAPI.

## Executar

Requer Python 3.10 ou superior. Na raiz do projeto:

```powershell
python -m pip install -r requirements.txt
python build.py
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Abra http://127.0.0.1:8000. A documentação da API está em `/docs`.

No modo local, o frontend usa a API. No GitHub Pages, usa consultas agregadas previamente exportadas do banco. Chart.js, jsPDF, fontes e ícones são carregados por CDN.

## GitHub Pages

```powershell
python build.py
python export_static.py
```

Versione e envie `docs/` junto das mudanças de código. O Pages deve publicar a branch `main`, pasta `/docs`. Os filtros consultam os mesmos cálculos exportados do SQLite para JSON; não existe backend Python em execução no Pages. Atualizações nas bases exigem reimportar, reexportar e enviar a nova versão.

A exportação inclui apenas taxas, contagens e metadados de conferência, sem nomes de alunos, alternativas individuais ou arquivos de banco. `Database.xlsx` permanece local.

## Base e importação

Consolidação: `backend/data/DADOS_ACERTO_POR_HABILIDADE.xlsx`, abas `ITENS_2_ANO`, `ITENS_4_ANO`, `ITENS_5_ANO`, `ITENS_8_ANO` e `ITENS_9_ANO`, cabeçalho na linha 3. Contém 1.312 taxas por escola e item, 236 itens distintos e sete escolas.

Base individual: `backend/data/Database.xlsx`, abas `2º ano`, `4º e 5º` e `8º e 9º`. Contém 896 registros de avaliação, com alunos, alternativas, totais e listas de questões erradas. Os 1.312 resultados por item foram reconciliados com a consolidação. O arquivo individual e o banco com nomes ficam locais e estão ignorados pelo Git. Para executar a importação completa após clonar o repositório, disponibilize também esse arquivo na pasta indicada.

**896 registros não equivalem a 896 estudantes distintos.** No 2º ano são 173 registros de LP e 165 de MT; nos demais anos são 98, 150, 149 e 161 registros de cadernos conjuntos. Não há identificador estável de estudante nem coluna de turma. A publicação estática e a rota `/api/painel` expõem apenas resultados agregados; as consultas nominais usam rotas restritas ao acesso local.

Foram encontradas seis divergências entre a quantidade de questões na lista e a coluna Erros: aba `4º e 5º`, linhas 105–110, EEF Francisco Mourão Lima, C0501. Preservamos os dados originais e apuramos os itens pelas listas, conforme o método informado. Os detalhes ficam nos metadados do banco e a ocorrência é sinalizada no painel e no relatório dessa escola.

| Ano | Caderno LP | Itens LP | Caderno MT | Itens MT |
| --- | --- | --- | --- | --- |
| 2º | P0201 | 01–22 | M0201 | 01–22 |
| 4º | C0401 | 01–22 | C0401 | 23–44 |
| 5º | C0501 | 01–22 | C0501 | 23–44 |
| 8º | C0801 | 01–26 | C0801 | 27–52 |
| 9º | C0901 | 01–26 | C0901 | 27–52 |

O banco gerado fica em `backend/data/avalie.sqlite3` e não é versionado. `python build.py` reimporta os dois arquivos sem alterar os originais. Valida avaliação, rede, anos, componentes, faixas de itens, taxas de 0 a 1, duplicidades, descrições e cobertura de itens de cada escola/prova. Na base individual, valida cadernos, totais, percentuais e listas e reconcilia as taxas. Cria um banco temporário e substitui o anterior apenas após sucesso.

É possível especificar `--source consolidacao.xlsx --individual registros.xlsx --database arquivo.sqlite3`. Para a API consultar outro banco, defina a variável `AVALIE_DB` com o caminho absoluto. O modo `--consolidated-only` importa apenas a consolidação e identifica as médias como não ponderadas, deixando indisponíveis as contagens de avaliações.

Tabelas: `schools`, `items`, `item_rates`, `evaluation_records`, `item_answers` e `metadata`. Cada taxa e registro preserva aba e linha de origem. Os metadados registram SHA-256 das fontes, data de importação e divergências. Os nomes de escola da base individual são associados às identificações da consolidação, incluindo as variantes abreviadas. A API abre o banco em modo somente leitura e não serve arquivos Excel ou SQLite.

## Regras atuais

### Resultados dos Alunos

A aba usa os registros de `Database.xlsx`. Na versão local, permite busca por nome (com ou sem acentos), filtros de faixa e ordenação, paginação de 25 avaliações e consulta dos itens de cada prova. Os itens exibem a alternativa registrada e o acerto/erro apurado pela lista. Os totais informados no caderno são mostrados separadamente, preservando as seis divergências conhecidas.

No GitHub Pages, a mesma aba mostra apenas resumos por escola, ano e caderno, com contagens e distribuição das avaliações por faixa. Não publica nomes, identificadores de avaliações ou alternativas individuais. Os endpoints nominais `/api/alunos` e `/api/alunos/{id}` são restritos ao acesso loopback local, não aceitam origens externas e retornam `Cache-Control: no-store`. Isso não substitui autenticação para uma futura hospedagem privada.

“Média por avaliação” é a média aritmética dos percentuais dos registros selecionados; “Acertos nos itens” é a razão entre acertos e oportunidades de resposta. Podem diferir porque os cadernos possuem quantidades diferentes de itens. Filtros de componente recalculam o resultado somente com os itens correspondentes. Os registros conjuntos nunca são duplicados na seleção de ambos os componentes.

### Cálculos

- A identidade do item inclui ano, componente, caderno e número. Não agrega itens de provas distintas com o mesmo número.
- Uma taxa é importada com sua precisão original; arredondamento para uma casa decimal ocorre na apresentação.
- Taxa do item = acertos daquele item ÷ registros da prova × 100. Médias dos componentes, anos, escolas e rede = soma de acertos nos itens ÷ soma das oportunidades de resposta × 100. Isso pondera os itens pela quantidade real de registros de cada prova, sem fazer média simples entre escolas de tamanhos diferentes. Não é a média dos percentuais gerais informados nos registros.
- Questão presente na lista de erros é erro; questão ausente é acerto. A alternativa registrada é preservada, sem nova correção por gabarito. A lista `Nenhuma` é aceita apenas quando o total de erros é zero. Divergências entre totais e listas são mantidas para conferência; o cálculo por item usa a lista.
- O total de avaliações conta registros físicos dos cadernos. Nos cadernos conjuntos, selecionar ambos os componentes não duplica o registro. Selecionar um componente inclui os registros daquele caderno.
- A distribuição e os indicadores de itens críticos/adequados usam os mesmos itens agregados da seleção. A comparação de escolas conta os itens críticos de cada escola.
- Faixas preservadas do painel anterior: Crítico até 56%; Atenção acima de 56% até 80%; Adequado acima de 80%. Não foram identificadas como classificação oficial do AVALIE.CE.
- Ausência de dados é exibida como indisponível, sem transformar em zero. Nenhuma turma, código CAEd ou dificuldade é inventada.
- LP e MT nos indicadores respeitam escola e ano e permitem comparação independentemente do filtro de componente. A aba Escolas apresenta toda a base, como no design original.
- As escolas possuem coberturas de anos diferentes: rankings gerais devem ser interpretados com essa diferença.

## Verificar

```powershell
python -m unittest discover -s tests -v
```

Os testes exigem as duas fontes locais. Verificam cobertura, separação dos cadernos, denominadores reais, contagem de avaliações sem duplicação, taxa de referência, médias independentes, listas de erros, filtros vazios, limites de classificação e preservação do banco em importação inválida.
