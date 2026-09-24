// Resultados nominais são consultados apenas pela API local.
let studentData = null;
let studentPage = 1;
let studentDetailVersion = 0;
const STUDENT_PAGE_SIZE = 25;

function setupStudentActions() {
    ['student-search', 'student-band', 'student-sort'].forEach(id => {
        document.getElementById(id).addEventListener(id === 'student-search' ? 'input' : 'change', () => {
            studentPage = 1;
            closeStudentDetail();
            renderStudentResults();
        });
    });
    document.getElementById('student-prev').addEventListener('click', () => { studentPage--; renderStudentResults(); });
    document.getElementById('student-next').addEventListener('click', () => { studentPage++; renderStudentResults(); });
    document.getElementById('student-close').addEventListener('click', closeStudentDetail);
}

function closeStudentDetail() {
    studentDetailVersion++;
    document.getElementById('student-detail').classList.add('hidden');
}

async function loadAlunos(version) {
    closeStudentDetail();
    let data;
    if (window.AVALIE_STATIC) {
        data = painelData.alunos;
        if (!data) throw new Error('Resultados dos alunos indisponíveis nesta publicação.');
    } else {
        const response = await fetch('/api/alunos?' + new URLSearchParams(getFilters()), {cache:'no-store'});
        if (!response.ok) throw new Error((await response.json()).detail || 'Não foi possível consultar os alunos.');
        data = await response.json();
    }
    if (version !== requestVersion) return;
    studentData = data;
    studentPage = 1;
    document.getElementById('student-mode').textContent = data.identificado
        ? 'Resultados por registro de prova. Use os filtros do topo e busque um aluno para consultar os itens.'
        : 'Resumo das avaliações por escola, ano e caderno. A consulta nominal está disponível na versão local.';
    document.getElementById('student-local-controls').classList.toggle('hidden', !data.identificado);
    renderStudentResults();
}

function studentSearchKey(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
}

function filteredStudentRows() {
    const search = studentSearchKey(document.getElementById('student-search').value.trim());
    const band = document.getElementById('student-band').value;
    const order = document.getElementById('student-sort').value;
    return studentData.registros.filter(row => (!search || studentSearchKey(row.aluno).includes(search)) &&
        (band === 'Todas' || row.faixa === band)).sort((a,b) => {
            const difference = order === 'menor' ? a.percentual-b.percentual : order === 'maior' ? b.percentual-a.percentual : 0;
            return difference || a.aluno.localeCompare(b.aluno,'pt-BR') || a.id-b.id;
        });
}

function summarizeStudentRows(rows) {
    const items = rows.reduce((sum,r) => sum+r.itens,0);
    const correct = rows.reduce((sum,r) => sum+r.acertos,0);
    const labels = ['Crítico','Atenção','Adequado'];
    return {registros:rows.length, itens:items, acertos:correct,
        media_registros:rows.length ? rows.reduce((sum,r) => sum+100*r.acertos/r.itens,0)/rows.length : null,
        percentual_itens:items ? 100*correct/items : null,
        divergentes:rows.filter(r => r.divergente).length,
        distribuicao:{labels, values:labels.map(band => rows.filter(r => r.faixa===band).length)}};
}

function renderStudentResults() {
    if (!studentData) return;
    const rows = studentData.identificado ? filteredStudentRows() : studentData.grupos;
    const summary = studentData.identificado ? summarizeStudentRows(rows) : studentData.resumo;
    const kpis = [
        ['Avaliações',summary.registros,'registros de prova'],
        ['Média por avaliação',pct(summary.media_registros),'média dos percentuais'],
        ['Acertos nos itens',pct(summary.percentual_itens),'ponderado pelas respostas'],
        ['Registros a conferir',summary.divergentes,'totais e listas divergentes']
    ];
    document.getElementById('student-kpis').innerHTML = kpis.map(([label,value,sub]) =>
        `<div class="kpi-card"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span></div>`).join('');
    renderDoughnutChart('chart-student-bands',summary.distribuicao.labels,summary.distribuicao.values);
    charts['chart-student-bands'].options.plugins.tooltip.callbacks.label = c => `${c.label}: ${c.raw} avaliação(ões)`;
    charts['chart-student-bands'].update();
    document.getElementById('student-summary').innerHTML = `
        <p><strong>${summary.acertos.toLocaleString('pt-BR')}</strong> acertos em <strong>${summary.itens.toLocaleString('pt-BR')}</strong> itens respondidos.</p>
        <p>${summary.distribuicao.labels.map((label,i) => `${label}: <strong>${summary.distribuicao.values[i]}</strong>`).join(' · ')}</p>
        <p>${studentData.identificado ? 'Cada linha representa uma avaliação.' : 'A tabela agrupa as avaliações por escola, ano e caderno.'} No 2º ano, LP e Matemática têm registros separados; nos demais anos, o caderno reúne os dois componentes.</p>`;
    const empty = !rows.length;
    document.getElementById('student-empty').classList.toggle('hidden',!empty);
    document.getElementById('student-empty').textContent = studentData.disponivel
        ? 'Não há avaliações para os filtros selecionados.' : 'A base individual Database.xlsx ainda não foi importada.';
    document.getElementById('student-table-wrapper').classList.toggle('hidden',empty);
    const headings = studentData.identificado
        ? ['Aluno','Escola','Ano','Caderno','Componente','Acertos','Resultado','Faixa','Consulta']
        : ['Escola','Ano','Caderno','Componente','Avaliações','Média por avaliação','Crítico','Atenção','Adequado'];
    document.getElementById('student-head').innerHTML = `<tr>${headings.map(h => `<th scope="col">${h}</th>`).join('')}</tr>`;
    const pages = Math.max(1,Math.ceil(rows.length/STUDENT_PAGE_SIZE));
    studentPage = Math.min(Math.max(1,studentPage),pages);
    const visible = studentData.identificado ? rows.slice((studentPage-1)*STUDENT_PAGE_SIZE,studentPage*STUDENT_PAGE_SIZE) : rows;
    const body = document.getElementById('student-body');
    body.innerHTML = '';
    visible.forEach(row => {
        const tr = document.createElement('tr');
        if (studentData.identificado) {
            tr.innerHTML = `<td><strong>${sanitize(row.aluno)}</strong>${row.divergente ? '<br><span class="badge badge-atencao">Conferir totais</span>' : ''}</td>
                <td>${sanitize(row.escola)}</td><td>${sanitize(row.ano_escolar)}</td><td>${sanitize(row.caderno)}</td>
                <td>${sanitize(row.componente)}</td><td>${row.acertos} / ${row.itens}</td><td><strong>${pct(row.percentual)}</strong></td>
                <td><span class="badge ${badgeClass(row.faixa)}">${row.faixa}</span></td><td><button class="student-button" type="button">Ver prova</button></td>`;
            tr.querySelector('button').addEventListener('click',() => showStudentDetail(row.id));
        } else {
            tr.innerHTML = `<td><strong>${sanitize(row.escola)}</strong></td><td>${sanitize(row.ano_escolar)}</td><td>${sanitize(row.caderno)}</td>
                <td>${sanitize(row.componente)}</td><td>${row.registros}</td><td><strong>${pct(row.media_registros)}</strong></td>
                ${row.distribuicao.values.map(value => `<td>${value}</td>`).join('')}`;
        }
        body.appendChild(tr);
    });
    document.getElementById('student-pagination').classList.toggle('hidden',!studentData.identificado || empty);
    document.getElementById('student-page-info').textContent = `Página ${studentPage} de ${pages} · ${rows.length} avaliações`;
    document.getElementById('student-prev').disabled = studentPage === 1;
    document.getElementById('student-next').disabled = studentPage === pages;
}

async function showStudentDetail(id) {
    if (window.AVALIE_STATIC) return;
    const version = ++studentDetailVersion;
    const pageVersion = requestVersion;
    const panel = document.getElementById('student-detail');
    const content = document.getElementById('student-detail-content');
    panel.classList.remove('hidden');
    content.textContent = 'Consultando prova…';
    try {
        const response = await fetch(`/api/alunos/${id}?` + new URLSearchParams({componente:getFilters().componente}),{cache:'no-store'});
        if (!response.ok) throw new Error('Não foi possível consultar esta prova.');
        const data = await response.json();
        if (version !== studentDetailVersion || pageVersion !== requestVersion || getCurrentPage() !== 'alunos') return;
        const row = studentData.registros.find(r => r.id === id);
        content.innerHTML = `<div class="student-detail-meta"><strong>${sanitize(data.aluno)}</strong><br>
            ${sanitize(data.escola)} · ${data.ano}º Ano · ${sanitize(data.caderno)}<br>
            Seleção: ${row.acertos} acertos em ${row.itens} itens (${pct(row.percentual)}).<br>
            Total informado no caderno: ${data.acertos_informados} acertos, ${data.erros_informados} erros (${pct(data.percentual_informado)}).
            </div>${row.divergente ? '<p class="student-review">O total de erros informado difere da lista de questões erradas. Os resultados por item abaixo seguem a lista; os totais originais foram preservados.</p>' : ''}
            <p>Verde: acerto. Vermelho: erro. Identificação pela lista de questões erradas, sem nova correção por gabarito.</p>`;
        for (const code of ['LP','MT']) {
            const items = data.itens.filter(item => item.sigla === code);
            if (!items.length) continue;
            const heading = document.createElement('h4');
            heading.textContent = code === 'LP' ? 'Língua Portuguesa' : 'Matemática';
            content.appendChild(heading);
            const grid = document.createElement('div');
            grid.className = 'student-answer-grid';
            grid.innerHTML = items.map(item => `<div class="student-answer${item.acerto ? '' : ' wrong'}" title="${sanitize(item.habilidade_codigo + ' — ' + item.habilidade).replace(/"/g,'&quot;')}">
                <strong>Item ${String(item.numero).padStart(2,'0')}</strong><small>${item.acerto ? 'Acerto' : 'Erro'}</small>
                <small>Resposta: ${sanitize(item.alternativa || 'Não registrada')}</small></div>`).join('');
            content.appendChild(grid);
        }
        panel.scrollIntoView({behavior:'smooth',block:'start'});
        panel.focus({preventScroll:true});
    } catch (error) {
        if (version === studentDetailVersion && pageVersion === requestVersion) content.textContent = error.message;
    }
}
