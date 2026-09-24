// ===== CONFIGURAÇÃO GLOBAL =====
const FAIXA_COLORS = {
    'Crítico': { bg: '#FEE2E2', border: '#EF4444', text: '#B91C1C' },
    'Atenção': { bg: '#FEF3C7', border: '#F59E0B', text: '#B45309' },
    'Adequado': { bg: '#DCFCE7', border: '#22C55E', text: '#15803D' }
};
const FAIXA_CRITICO_MAX = 56;
const FAIXA_ATENCAO_MAX = 80;

let charts = {};
let habData = [];
let analiseData = null;
let habilidadeSelecionadaKey = null;

Chart.register(ChartDataLabels);
Chart.defaults.plugins.datalabels = { display: false };

// ===== DADOS CONSULTADOS PELA API =====
let painelData = null;
let requestVersion = 0;
let staticManifest = null;
function mean(arr) {
    const values = arr.filter(v => v != null && Number.isFinite(v));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
function rd(value, digits) { return value == null ? null : Number(value.toFixed(digits)); }
function pct(value) { return value == null ? '—' : value.toLocaleString('pt-BR', {maximumFractionDigits: 1}) + '%'; }
function classificarFaixa(value) {
    if (value == null) return 'Sem dados';
    return value <= 56 ? 'Crítico' : value <= 80 ? 'Atenção' : 'Adequado';
}
function anoSortKey(value) { return Number(String(value || '').match(/(\d+)/)?.[1] || 999); }
function itemLabel(row) { return `${row.ano}º ${row.sigla} · ${row.habilidade_pos}`; }
function filtrarHab() { return habData; }
function getFilterOptions() { return painelData.filtros; }
function getIndicadores() { return painelData.indicadores; }
function getHabilidadesCards() { return painelData.itens; }
function getGraficosHabilidades() {
    const rows = painelData.itens;
    return {labels: rows.map(itemLabel), values: rows.map(r => r.acerto_pct), faixas: rows.map(r => r.faixa)};
}
function getDistribuicaoFaixas() { return painelData.distribuicao; }
function getRanking(escola, ano, componente, top, order) {
    const rows = [...painelData.itens].sort((a,b) => order === 'asc' ? a.acerto_pct-b.acerto_pct : b.acerto_pct-a.acerto_pct).slice(0,top);
    return {labels: rows.map(itemLabel), values: rows.map(r => r.acerto_pct), descricoes: rows.map(r => r.habilidade_descricao)};
}
function getTabelaDetalhada() { return habData; }

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', async () => {
    setupSidebar();
    setupNavigation();
    setupReportActions();
    setupStudentActions();
    setupFilterListeners();
    await loadCurrentPage(true);
});

async function loadData(filters = {}) {
    if (window.AVALIE_STATIC) {
        if (!staticManifest) {
            const response = await fetch('data/index.json');
            if (!response.ok) throw new Error('Não foi possível carregar a publicação.');
            staticManifest = await response.json();
        }
        const key = JSON.stringify([filters.escola || 'Todas', filters.ano || 'Todos', filters.componente || 'Todos']);
        const filename = staticManifest.consultas[key];
        if (!filename) throw new Error('Seleção não disponível nesta publicação.');
        const response = await fetch('data/' + filename);
        if (!response.ok) throw new Error('Não foi possível carregar os resultados.');
        return {...staticManifest.shared, ...await response.json()};
    }
    const response = await fetch('/api/painel?' + new URLSearchParams(filters));
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Não foi possível consultar os dados.');
    }
    return response.json();
}

// ===== SIDEBAR =====
function setupSidebar() {
    const btn = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.getElementById('sidebar');
    btn.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
}

// ===== NAVEGAÇÃO POR ABAS =====
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            const page = item.dataset.page;
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById('page-' + page).classList.add('active');
            loadCurrentPage();
        });
    });
}

function getCurrentPage() {
    const active = document.querySelector('.nav-item.active');
    return active ? active.dataset.page : 'visao-geral';
}

// ===== FILTROS =====
function loadFilters() {
    const data = getFilterOptions();
    populateSelect('filter-escola', data.escolas, 'Todas');
    populateSelect('filter-ano', data.anos, 'Todos');
    populateSelect('filter-componente', data.componentes, 'Todos');
}

function populateSelect(id, options, defaultValue) {
    const sel = document.getElementById(id);
    sel.innerHTML = '';
    const selectedValue = options.includes(defaultValue) ? defaultValue : (options[0] || '');
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (opt === selectedValue) o.selected = true;
        sel.appendChild(o);
    });
}

function getFilters() {
    return {
        escola: document.getElementById('filter-escola').value,
        ano: document.getElementById('filter-ano').value,
        componente: document.getElementById('filter-componente').value
    };
}

function setupFilterListeners() {
    ['filter-escola', 'filter-ano', 'filter-componente'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => loadCurrentPage());
    });
}

// ===== LOAD CURRENT PAGE =====
function setFiltersDisabled(disabled) {
    ['filter-escola', 'filter-ano', 'filter-componente'].forEach(id => {
        const el = document.getElementById(id);
        el.disabled = disabled;
        el.style.opacity = disabled ? '0.4' : '';
        el.style.cursor = disabled ? 'not-allowed' : '';
        el.closest('.filter-group').style.pointerEvents = disabled ? 'none' : '';
    });
}

async function loadCurrentPage(initial = false) {
    const version = ++requestVersion;
    const page = getCurrentPage();
    setFiltersDisabled(page === 'escolas');
    const status = document.getElementById('data-status');
    const activePage = document.querySelector('.page.active');
    activePage.style.visibility = 'hidden';
    status.textContent = 'Consultando resultados…';
    status.hidden = false;
    status.classList.remove('error');
    document.getElementById('btn-download-report').disabled = true;
    try {
        const data = await loadData(initial || page === 'escolas' ? {} : getFilters());
        if (version !== requestVersion) return;
        painelData = data;
        habData = data.registros;
        analiseData = data.analise;
        if (initial) loadFilters();
        status.textContent = '';
        status.hidden = true;
        if (page === 'alunos') {
            await loadAlunos(version);
            if (version === requestVersion) activePage.style.visibility = '';
            return;
        }
        const loaders = {'visao-geral': loadVisaoGeral, habilidades: loadHabilidades,
            escolas: loadEscolas, detalhamento: loadDetalhamento, relatorios: loadRelatorios};
        if (loaders[page]) loaders[page]();
        activePage.style.visibility = '';
    } catch (error) {
        if (version !== requestVersion) return;
        painelData = null;
        habData = [];
        status.textContent = error.message + ' Recarregue a página para tentar novamente.';
        status.hidden = false;
        status.classList.add('error');
    }
}

// ===== VISÃO GERAL =====
function loadVisaoGeral() {
    const { escola, ano, componente } = getFilters();
    const ind = getIndicadores(escola, ano, componente);
    const hab = getGraficosHabilidades(escola, ano, componente);
    const dist = getDistribuicaoFaixas(escola, ano, componente);
    const rkL = getRanking(escola, ano, componente, 8, 'asc');
    const rkH = getRanking(escola, ano, componente, 8, 'desc');
    renderKPIs(ind);
    renderBarChart('chart-hab-geral', hab.labels, hab.values, hab.faixas, 'Acerto %');
    renderDoughnutChart('chart-distribuicao', dist.labels, dist.values);
    renderHorizontalBar('chart-ranking-baixo', rkL.labels, rkL.values, rkL.descricoes, true);
    renderHorizontalBar('chart-ranking-alto', rkH.labels, rkH.values, rkH.descricoes, false);
}

function renderKPIs(ind) {
    const strip = document.getElementById('kpi-strip');
    strip.innerHTML = '';
    const kpis = [
        { label: 'Média das taxas', value: pct(ind.media_geral), cls: '', sub: 'itens da seleção' },
        { label: 'Língua Portuguesa', value: pct(ind.media_lp), cls: 'purple', sub: 'média LP' },
        { label: 'Matemática', value: pct(ind.media_mt), cls: 'purple', sub: 'média MT' },
        { label: 'Itens', value: ind.total_habilidades, cls: '', sub: 'ano + componente + item' },
        { label: 'Itens críticos', value: ind.habilidades_criticas, cls: 'red', sub: '≤ 56%' },
        { label: 'Itens adequados', value: ind.habilidades_adequadas, cls: 'green', sub: '≥ 80,01%' },
        { label: 'Melhor', value: pct(ind.melhor_desempenho), cls: 'green', sub: 'item' },
        { label: 'Pior', value: pct(ind.pior_desempenho), cls: 'red', sub: 'item' },
        { label: 'Escolas', value: ind.total_escolas, cls: 'amber', sub: 'analisadas' },
        { label: 'Registros de avaliação', value: ind.registros_avaliacao ?? '—', cls: '', sub: 'não são estudantes distintos' },
    ];
    kpis.forEach(k => {
        const div = document.createElement('div');
        div.className = 'kpi-card ' + k.cls;
        div.innerHTML = `<span class="kpi-label">${k.label}</span><span class="kpi-value">${k.value}</span><span class="kpi-sub">${k.sub}</span>`;
        strip.appendChild(div);
    });
}

// ===== HABILIDADES =====
function loadHabilidades() {
    const { escola, ano, componente } = getFilters();
    const data = getHabilidadesCards(escola, ano, componente);
    const grid = document.getElementById('hab-grid');
    grid.innerHTML = '';
    if (!data.length) {
        habilidadeSelecionadaKey = null;
        renderHabDetail(null);
        document.getElementById('hab-detail-empty').textContent = 'Não há registros para os filtros selecionados.';
        return;
    }
    const currentExists = data.some(h => h.habilidade_codigo === habilidadeSelecionadaKey);
    if (!currentExists) habilidadeSelecionadaKey = data[0].habilidade_codigo;
    data.forEach(h => {
        const card = document.createElement('div');
        const cls = faixaClass(h.faixa);
        card.className = 'hab-card ' + cls;
        if (h.habilidade_codigo === habilidadeSelecionadaKey) card.classList.add('active');
        const codigoMatriz = h.habilidade_descritor;
        card.innerHTML = `
            <span class="hab-code">${sanitize(itemLabel(h))}</span>
            <span class="hab-skill-code">${sanitize(codigoMatriz)}</span>
            <span class="hab-pct">${h.acerto_pct}%</span>
            <span class="hab-faixa">${h.faixa}</span>
        `;
        card.addEventListener('click', () => {
            habilidadeSelecionadaKey = h.habilidade_codigo;
            renderHabDetail(h);
            loadHabilidades();
        });
        grid.appendChild(card);
    });
    const selecionada = data.find(h => h.habilidade_codigo === habilidadeSelecionadaKey) || data[0];
    renderHabDetail(selecionada);
}

function faixaClass(faixa) {
    const map = { 'Crítico': 'faixa-critico', 'Atenção': 'faixa-atencao', 'Adequado': 'faixa-adequado' };
    return map[faixa] || '';
}

function renderHabDetail(h) {
    const empty = document.getElementById('hab-detail-empty');
    const content = document.getElementById('hab-detail-content');
    if (!empty || !content) return;
    if (!h) {
        empty.classList.remove('hidden');
        content.classList.add('hidden');
        return;
    }
    empty.classList.add('hidden');
    content.classList.remove('hidden');
    document.getElementById('hab-detail-caed').textContent = h.habilidade_descritor || h.habilidade_codigo;
    document.getElementById('hab-detail-pos').textContent = h.habilidade_pos || '';
    document.getElementById('hab-detail-avaliacao').textContent = h.avaliacao || 'AVALIE.CE 2026.2';
    document.getElementById('hab-detail-ano').textContent = h.ano_escolar || '';
    document.getElementById('hab-detail-componente').textContent = h.componente || '';
    document.getElementById('hab-detail-escola').textContent = h.escola || '';
    document.getElementById('hab-detail-pct').textContent = `${h.acerto_pct}%`;
    document.getElementById('hab-detail-faixa').textContent = h.faixa || '';
    document.getElementById('hab-detail-nivel').textContent = h.registros_avaliacao != null
        ? `${h.acertos_item} acertos em ${h.registros_avaliacao} registros (${h.total_escolas} escola(s))`
        : (h.total_escolas === 1 ? `${h.origem_aba}, linha ${h.origem_linha}` : `${h.total_escolas} escolas com registros deste item`);
    document.getElementById('hab-detail-desc').textContent = h.habilidade_descricao || '';
}

// ===== ESCOLAS — ANÁLISE COMPLETA =====

function escClassColor(cls) {
    const m = { 'Adequado': '#22C55E', 'Atenção': '#F59E0B', 'Crítico': '#EF4444' };
    return m[cls] || '#667A90';
}

function shortEscola(nome) {
    return nome.replace(/^EE[A-Z]*\s+/i, '').substring(0, 22);
}

function loadEscolas() {
    destroyChart('chart-escolas'); // limpa ref antiga se houver
    ['chart-esc-ranking', 'chart-esc-lp-mt', 'chart-esc-etapas', 'chart-esc-criticas'].forEach(destroyChart);

    if (!analiseData) {
        const strip = document.getElementById('esc-kpi-strip');
        if (strip) strip.innerHTML = '<p style="color:#667A90;padding:8px 0;">Carregando dados de análise…</p>';
        return;
    }

    const { escolas, detalhe, rede } = analiseData;

    renderEscolasKPIs(escolas, rede);
    renderEscolasRanking(escolas, rede);
    renderEscolasLpMt(escolas, rede);
    renderEscolasEtapas(detalhe, rede);
    renderEscolasCriticas(escolas);
    renderEscolasHeatmap(detalhe, escolas);
}

function renderEscolasKPIs(escolas, rede) {
    const strip = document.getElementById('esc-kpi-strip');
    if (!strip) return;
    const sorted = [...escolas].sort((a, b) => b.media - a.media);
    const melhor = sorted[0];
    const pior = sorted[sorted.length - 1];
    const acima = escolas.filter(e => e.media >= rede.media).length;
    const totalCriticas = escolas.reduce((s, e) => s + (e.hab_criticas || 0), 0);
    const gapRede = rd(rede.lp - rede.mt, 1);

    const kpis = [
        { label: 'Média das taxas', value: rede.media + '%', cls: '', sub: 'consolidação municipal' },
        { label: 'LP Rede', value: rede.lp + '%', cls: 'purple', sub: 'Língua Portuguesa' },
        { label: 'MT Rede', value: rede.mt + '%', cls: 'amber', sub: 'Matemática' },
        { label: 'Melhor Escola', value: melhor.media + '%', cls: 'green', sub: shortEscola(melhor.escola) },
        { label: 'Menor Média', value: pior.media + '%', cls: 'red', sub: shortEscola(pior.escola) },
        { label: 'Acima da Rede', value: acima, cls: 'green', sub: 'de ' + escolas.length + ' escolas' },
    ];

    strip.innerHTML = '';
    kpis.forEach(k => {
        const div = document.createElement('div');
        div.className = 'kpi-card ' + k.cls;
        div.innerHTML = `<span class="kpi-label">${sanitize(k.label)}</span><span class="kpi-value">${sanitize(String(k.value))}</span><span class="kpi-sub">${sanitize(k.sub)}</span>`;
        strip.appendChild(div);
    });
}

function renderEscolasRanking(escolas, rede) {
    const el = document.getElementById('chart-esc-ranking');
    if (!el) return;
    const sorted = [...escolas].sort((a, b) => a.media - b.media);
    const labels = sorted.map(e => truncate(e.escola, 24));
    const values = sorted.map(e => e.media);
    const colors = sorted.map(e => escClassColor(e.classificacao));

    charts['chart-esc-ranking'] = new Chart(el.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Média das taxas (%)',
                    data: values,
                    backgroundColor: colors.map(c => c + 'bb'),
                    borderColor: colors,
                    borderWidth: 2,
                    borderRadius: 4
                },
                {
                    label: 'Média das taxas da rede (' + rede.media + '%)',
                    data: Array(sorted.length).fill(rede.media),
                    type: 'line',
                    borderColor: '#17324D',
                    borderDash: [8, 4],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { size: 10 }, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label: c => c.datasetIndex === 0
                            ? `${c.raw}% — ${sorted[c.dataIndex].classificacao}`
                            : `Rede: ${c.raw}%`
                    }
                },
                datalabels: {
                    display: ctx => ctx.datasetIndex === 0,
                    anchor: 'end', align: 'end', offset: 2,
                    font: { size: 10, weight: '700' },
                    color: '#17324D',
                    textStrokeColor: '#fff', textStrokeWidth: 3,
                    formatter: v => v + '%'
                }
            },
            scales: {
                x: { min: 0, max: 105, ticks: { callback: v => v <= 100 ? v + '%' : '' } },
                y: { ticks: { font: { size: 9 } } }
            }
        }
    });
}

function renderEscolasLpMt(escolas, rede) {
    const el = document.getElementById('chart-esc-lp-mt');
    if (!el) return;
    const sorted = [...escolas].sort((a, b) => b.media - a.media);
    const labels = sorted.map(e => truncate(e.escola, 20));
    const n = sorted.length;

    charts['chart-esc-lp-mt'] = new Chart(el.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'LP', data: sorted.map(e => e.lp), backgroundColor: '#3B82F6bb', borderColor: '#3B82F6', borderWidth: 1.5, borderRadius: 3 },
                { label: 'Matemática', data: sorted.map(e => e.mt), backgroundColor: '#6366F1bb', borderColor: '#6366F1', borderWidth: 1.5, borderRadius: 3 },
                { label: 'Rede LP (' + rede.lp + '%)', data: Array(n).fill(rede.lp), type: 'line', borderColor: '#173A5E', borderDash: [6, 3], borderWidth: 2, pointRadius: 0, fill: false },
                { label: 'Rede MT (' + rede.mt + '%)', data: Array(n).fill(rede.mt), type: 'line', borderColor: '#0EA5E9', borderDash: [6, 3], borderWidth: 2, pointRadius: 0, fill: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { size: 10 }, usePointStyle: true } },
                tooltip: { callbacks: { label: c => c.dataset.label + ': ' + c.raw + '%' } },
                datalabels: {
                    display: ctx => ctx.datasetIndex < 2,
                    anchor: 'end', align: 'end', offset: 1,
                    font: { size: 8, weight: '700' },
                    color: '#17324D',
                    textStrokeColor: '#fff', textStrokeWidth: 2,
                    formatter: v => v + '%'
                }
            },
            scales: {
                y: { min: 0, max: 105, ticks: { callback: v => v <= 100 ? v + '%' : '' } },
                x: { ticks: { font: { size: 8 }, maxRotation: 30 } }
            }
        }
    });
}

function renderEscolasEtapas(detalhe, rede) {
    const el = document.getElementById('chart-esc-etapas');
    if (!el) return;
    const present = [...new Set(detalhe.map(r => r.ano_escolar).filter(Boolean))].sort((a, b) => anoSortKey(a) - anoSortKey(b));
    const n = present.length;

    const etapaLp = present.map(e => analiseData.etapas.find(r => r.ano_escolar === e)?.lp ?? null);
    const etapaMt = present.map(e => analiseData.etapas.find(r => r.ano_escolar === e)?.mt ?? null);
    const etapaMedia = present.map(e => analiseData.etapas.find(r => r.ano_escolar === e)?.media ?? null);

    charts['chart-esc-etapas'] = new Chart(el.getContext('2d'), {
        type: 'bar',
        data: {
            labels: present,
            datasets: [
                { label: 'LP', data: etapaLp, backgroundColor: '#3B82F6bb', borderColor: '#3B82F6', borderWidth: 1.5, borderRadius: 3 },
                { label: 'Matemática', data: etapaMt, backgroundColor: '#6366F1bb', borderColor: '#6366F1', borderWidth: 1.5, borderRadius: 3 },
                {
                    label: 'Média p/ Etapa', data: etapaMedia, type: 'line',
                    borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,.12)',
                    borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#22C55E', fill: false, tension: 0.3
                },
                {
                    label: 'Rede (' + rede.media + '%)', data: Array(n).fill(rede.media), type: 'line',
                    borderColor: '#17324D', borderDash: [8, 4], borderWidth: 2, pointRadius: 0, fill: false
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { size: 10 }, usePointStyle: true } },
                tooltip: { callbacks: { label: c => c.dataset.label + ': ' + c.raw + '%' } },
                datalabels: {
                    display: ctx => ctx.datasetIndex < 2,
                    anchor: 'end', align: 'end', offset: 1,
                    font: { size: 9, weight: '700' }, color: '#17324D',
                    textStrokeColor: '#fff', textStrokeWidth: 2,
                    formatter: v => v != null ? v + '%' : ''
                }
            },
            scales: {
                y: { min: 0, max: 105, ticks: { callback: v => v <= 100 ? v + '%' : '' } },
                x: { ticks: { font: { size: 11 } } }
            }
        }
    });
}

function renderEscolasCriticas(escolas) {
    const el = document.getElementById('chart-esc-criticas');
    if (!el) return;
    const sorted = [...escolas].sort((a, b) => (b.hab_criticas || 0) - (a.hab_criticas || 0));
    const labels = sorted.map(e => truncate(e.escola, 24));
    const values = sorted.map(e => e.hab_criticas || 0);
    const maxVal = Math.max(...values, 1);
    const xMax = Math.max(5, Math.ceil((maxVal + Math.max(2, maxVal * 0.12)) / 5) * 5);

    charts['chart-esc-criticas'] = new Chart(el.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Itens Críticos (nº)',
                data: values,
                backgroundColor: values.map(v => {
                    const r = v / maxVal;
                    return r > 0.7 ? '#EF444499' : r > 0.5 ? '#F59E0B99' : r > 0.3 ? '#FDE68A99' : '#22C55E99';
                }),
                borderColor: values.map(v => {
                    const r = v / maxVal;
                    return r > 0.7 ? '#EF4444' : r > 0.5 ? '#F59E0B' : r > 0.3 ? '#F59E0B' : '#22C55E';
                }),
                borderWidth: 1.5,
                borderRadius: 4,
                maxBarThickness: 22,
                categoryPercentage: 0.72,
                barPercentage: 0.86,
                clip: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            layout: {
                padding: { right: 18 }
            },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => c.raw + ' item(ns) crítica(s)' } },
                datalabels: {
                    display: true, anchor: 'end', align: 'right', offset: 4, clamp: true, clip: false,
                    font: { size: 10, weight: '700' }, color: '#17324D',
                    textStrokeColor: '#fff', textStrokeWidth: 2,
                    formatter: v => v
                }
            },
            scales: {
                x: {
                    min: 0,
                    max: xMax,
                    grace: '8%',
                    ticks: { stepSize: xMax <= 10 ? 2 : 10 }
                },
                y: { ticks: { font: { size: 9 } } }
            }
        }
    });
}

function renderEscolasHeatmap(detalhe, escolas) {
    const container = document.getElementById('esc-heatmap');
    if (!container) return;

    const present = [...new Set(detalhe.map(r => r.ano_escolar).filter(Boolean))].sort((a, b) => anoSortKey(a) - anoSortKey(b));
    const sortedEsc = [...escolas].sort((a, b) => b.media - a.media);

    // A matriz segue as faixas vigentes do painel, calculadas a partir da média.
    // Não usamos a classificação textual da planilha porque ela pode conter
    // nomenclaturas antigas, como "Regular".
    const clsBg = {
        'Adequado': '#DCFCE7',
        'Atenção': '#FDE68A',
        'Crítico': '#FCA5A5'
    };
    const clsBorder = {
        'Adequado': '#86EFAC',
        'Atenção': '#D97706',
        'Crítico': '#DC2626'
    };
    const clsTxt = {
        'Adequado': '#15803D',
        'Atenção': '#92400E',
        'Crítico': '#991B1B'
    };
    const clsLabel = {};

    const cellStyle = 'text-align:center;padding:7px 6px;border-bottom:1px solid #e2e8f0;';
    const thStyle = 'padding:8px 10px;background:#17324D;color:#fff;font-size:11px;font-weight:600;';

    let html = `<table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead><tr>
            <th style="${thStyle}text-align:left;min-width:180px;">Escola</th>
            ${present.map(e => `<th style="${thStyle}min-width:90px;">${e}</th>`).join('')}
            <th style="${thStyle}min-width:90px;">Média</th>
        </tr></thead><tbody>`;

    sortedEsc.forEach((esc, idx) => {
        const rowBg = idx % 2 === 0 ? '#EEF4FF' : '#fff';
        html += `<tr style="background:${rowBg};">`;
        html += `<td style="padding:8px 10px;font-weight:600;color:#17324D;border-bottom:1px solid #e2e8f0;">${sanitize(esc.escola)}</td>`;
        present.forEach(etapa => {
            const row = detalhe.find(r => r.escola === esc.escola && r.ano_escolar === etapa);
            if (row) {
                const faixa = row.faixa;
                const bg = clsBg[faixa] || '#f1f5f9';
                const border = clsBorder[faixa] || '#cbd5e1';
                const tc = clsTxt[faixa] || '#475569';
                html += `<td style="${cellStyle}">
                    <div style="background:${bg};color:${tc};border:1px solid ${border};border-radius:6px;padding:4px 6px;font-weight:700;">${row.media_geral}%</div>
                    <div style="font-size:9px;color:${tc};margin-top:2px;">${clsLabel[faixa] || faixa}</div>
                </td>`;
            } else {
                html += `<td style="${cellStyle}color:#CBD5E1;">—</td>`;
            }
        });
        const faixa = esc.classificacao;
        const bg = clsBg[faixa] || '#f1f5f9';
        const border = clsBorder[faixa] || '#cbd5e1';
        const tc = clsTxt[faixa] || '#475569';
        html += `<td style="${cellStyle}">
            <div style="background:${bg};color:${tc};border:1px solid ${border};border-radius:6px;padding:4px 6px;font-weight:800;">${esc.media}%</div>
            <div style="font-size:9px;color:${tc};margin-top:2px;">${clsLabel[faixa] || faixa}</div>
        </td></tr>`;
    });

    // Linha da rede
    html += `<tr style="background:#EEF4FF;font-weight:700;">
        <td style="padding:8px 10px;color:#17324D;border-bottom:1px solid #e2e8f0;">Média das taxas da rede</td>`;
    present.forEach(etapa => {
        const avg = analiseData.etapas.find(r => r.ano_escolar === etapa)?.media ?? null;
        html += `<td style="${cellStyle}background:#DBEAFE;">${avg != null ? `<span style="font-weight:700;color:#17324D;">${avg}%</span>` : '—'}</td>`;
    });
    html += `<td style="${cellStyle}background:#DBEAFE;"><span style="font-weight:800;color:#17324D;">${pct(analiseData.rede.media)}</span></td></tr>`;
    html += `</tbody></table>`;

    // Legenda
    html += `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:11px;">`;
    Object.entries(clsBg).forEach(([cls, bg]) => {
        html += `<span style="display:flex;align-items:center;gap:5px;">
            <span style="width:14px;height:14px;border-radius:3px;background:${bg};border:1px solid ${clsBorder[cls]};display:inline-block;"></span>
            <span style="color:${clsTxt[cls]};font-weight:600;">${clsLabel[cls] || cls}</span>
        </span>`;
    });
    html += `</div>`;

    container.innerHTML = html;
}

// ===== DETALHAMENTO =====
function loadDetalhamento() {
    const { escola, ano, componente } = getFilters();
    const data = getTabelaDetalhada(escola, ano, componente);
    const tbody = document.getElementById('tabela-body');
    tbody.innerHTML = '';
    const maxRows = data.length;
    data.slice(0, maxRows).forEach(row => {
        const tr = document.createElement('tr');
        const bcls = badgeClass(row.faixa);
        tr.innerHTML = `
            <td>${sanitize(row.escola)}</td>
            <td>${sanitize(row.ano_escolar)}</td>
            <td>${sanitize(row.componente)}</td>
            <td>${sanitize(row.habilidade_pos)}</td>
            <td>${sanitize(row.habilidade_descritor)}</td>
            <td title="${sanitize(row.habilidade_descricao)}">${sanitize(truncate(row.habilidade_descricao, 60))}</td>
            <td><strong>${row.acerto_pct}%</strong></td>
            <td><span class="badge ${bcls}">${row.faixa}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// ===== RELATÓRIOS =====
function setupReportActions() {
    const btn = document.getElementById('btn-download-report');
    const faixaSel = document.getElementById('report-filter-faixa');
    const sortSel = document.getElementById('report-sort-order');
    if (!btn || !faixaSel || !sortSel) return;
    btn.addEventListener('click', downloadRelatorioPdf);
    [faixaSel, sortSel].forEach(el => {
        el.addEventListener('change', () => {
            if (getCurrentPage() === 'relatorios' && painelData) loadRelatorios();
        });
    });
}

function getReportLocalFilters() {
    return {
        faixa: document.getElementById('report-filter-faixa')?.value || 'Todas',
        ordenacao: document.getElementById('report-sort-order')?.value || 'acerto_desc'
    };
}

function renderSiteIconDataUrl() {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#7DD3FC';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '72px "Material Icons Round"';
    ctx.fillText('school', canvas.width / 2, canvas.height / 2);
    return canvas.toDataURL('image/png');
}

function compareRelatorioRows(a, b, ordenacao, anoFiltro = 'Todos', componenteFiltro = 'Todos') {
    const groupByAno = anoFiltro === 'Todos';
    const groupByComponente = componenteFiltro === 'Todos';

    if (groupByAno) {
        const anoDiff = anoSortKey(a.ano_escolar) - anoSortKey(b.ano_escolar);
        if (anoDiff !== 0) return anoDiff;
    }

    if (groupByComponente) {
        const compDiff = (a.componente || '').localeCompare(b.componente || '');
        if (compDiff !== 0) return compDiff;
    }

    if (ordenacao === 'acerto_asc' && a.acerto_pct !== b.acerto_pct) {
        return a.acerto_pct - b.acerto_pct;
    }
    if (ordenacao === 'codigo_asc') {
        return (
            (a.habilidade_pos || '').localeCompare(b.habilidade_pos || '', undefined, {numeric: true}) ||
            b.acerto_pct - a.acerto_pct ||
            anoSortKey(a.ano_escolar) - anoSortKey(b.ano_escolar) ||
            (a.componente || '').localeCompare(b.componente || '')
        );
    }
    if (a.acerto_pct !== b.acerto_pct) {
        return b.acerto_pct - a.acerto_pct;
    }
    return (
        (a.habilidade_pos || '').localeCompare(b.habilidade_pos || '', undefined, {numeric: true}) ||
        anoSortKey(a.ano_escolar) - anoSortKey(b.ano_escolar) ||
        (a.componente || '').localeCompare(b.componente || '')
    );
}

function getRelatorioRows(escola, ano, componente, faixa = 'Todas', ordenacao = 'acerto_desc') {
    if (!escola || escola === 'Todas') return [];
    let rows = filtrarHab(escola, ano, componente).map(r => ({
        escola: r.escola,
        ano_escolar: r.ano_escolar,
        componente: r.componente,
        habilidade_pos: r.habilidade_pos,
        habilidade_descritor: r.habilidade_descritor,
        habilidade_descricao: r.habilidade_descricao,
        acerto_pct: r.acerto_pct,
        faixa: r.faixa,
        origem: `${r.origem_aba}, linha ${r.origem_linha}`,
        registros_avaliacao: r.registros_avaliacao,
        acertos_item: r.acertos_item
    }));
    if (faixa === 'Crítico + Atenção') {
        rows = rows.filter(r => r.faixa === 'Crítico' || r.faixa === 'Atenção');
    } else if (faixa && faixa !== 'Todas') {
        rows = rows.filter(r => r.faixa === faixa);
    }
    rows.sort((a, b) => compareRelatorioRows(a, b, ordenacao, ano, componente));
    return rows;
}

function loadRelatorios() {
    const { escola, ano, componente } = getFilters();
    const { faixa, ordenacao } = getReportLocalFilters();
    const rows = getRelatorioRows(escola, ano, componente, faixa, ordenacao);
    const summary = document.getElementById('report-summary');
    const empty = document.getElementById('report-empty');
    const wrapper = document.getElementById('report-table-wrapper');
    const tbody = document.getElementById('report-body');
    const btn = document.getElementById('btn-download-report');

    if (!summary || !empty || !wrapper || !tbody || !btn) return;

    if (!escola || escola === 'Todas') {
        summary.textContent = 'Escolha uma escola específica nos filtros do topo para montar o relatório.';
        empty.classList.remove('hidden');
        wrapper.classList.add('hidden');
        tbody.innerHTML = '';
        btn.disabled = true;
        return;
    }

    const anos = [...new Set(rows.map(r => r.ano_escolar).filter(Boolean))].sort((a, b) => anoSortKey(a) - anoSortKey(b));
    const comps = [...new Set(rows.map(r => r.componente).filter(Boolean))];
    const ordenacaoLabel = {
        acerto_desc: 'Percentual de acerto (decrescente)',
        acerto_asc: 'Percentual de acerto (crescente)',
        codigo_asc: 'Código da habilidade'
    }[ordenacao] || 'Percentual de acerto (decrescente)';
    summary.innerHTML = `
        <strong>${sanitize(escola)}</strong> ·
        ${rows.length} item(ns) ·
        Ano: ${sanitize(anos.join(', ') || (ano === 'Todos' ? 'Todos' : ano))} ·
        Componente: ${sanitize(comps.join(' / ') || (componente === 'Todos' ? 'Todos' : componente))} ·
        Faixa: ${sanitize(faixa)} ·
        Ordem: ${sanitize(ordenacaoLabel)}
    `;

    tbody.innerHTML = '';
    if (!rows.length) {
        empty.textContent = 'Não há registros para os filtros selecionados.';
        empty.classList.remove('hidden');
        wrapper.classList.add('hidden');
        btn.disabled = true;
        return;
    }

    rows.forEach(row => {
        const tr = document.createElement('tr');
        const bcls = badgeClass(row.faixa);
        tr.innerHTML = `
            <td>${sanitize(row.ano_escolar)}</td>
            <td>${sanitize(row.componente)}</td>
            <td class="report-cell-code">${sanitize(row.habilidade_pos)}</td>
            <td class="report-cell-code">${sanitize(row.habilidade_descritor)}</td>
            <td class="report-cell-desc" title="${sanitize(row.habilidade_descricao)}">${sanitize(row.habilidade_descricao)}</td>
            <td><span class="report-cell-pct">${row.acerto_pct}%</span></td>
            <td><span class="badge ${bcls}">${sanitize(row.faixa)}</span></td>
            <td>${row.registros_avaliacao ?? '—'}</td>
        `;
        tbody.appendChild(tr);
    });

    empty.classList.add('hidden');
    wrapper.classList.remove('hidden');
    btn.disabled = false;
}

async function downloadRelatorioPdf() {
    const { escola, ano, componente } = getFilters();
    const { faixa, ordenacao } = getReportLocalFilters();
    const rows = getRelatorioRows(escola, ano, componente, faixa, ordenacao);
    if (!escola || escola === 'Todas' || !rows.length) {
        alert('Selecione uma escola com dados disponíveis para gerar o PDF.');
        return;
    }

    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF ? window.jspdf.jsPDF : null;
    if (!jsPDFCtor) {
        alert('Biblioteca de PDF não carregada.');
        return;
    }

    const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const filtrosTxt = [
        `Escola: ${escola}`,
        `Ano: ${ano === 'Todos' ? 'Todos' : ano}`,
        `Componente: ${componente === 'Todos' ? 'Todos' : componente}`,
        `Faixa: ${faixa}`,
        `Ordenação: ${({
            acerto_desc: 'Percentual de acerto (decrescente)',
            acerto_asc: 'Percentual de acerto (crescente)',
            codigo_asc: 'Código da habilidade'
        }[ordenacao] || 'Percentual de acerto (decrescente)')}`
    ];

    const marginX = 14;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - (marginX * 2);
    let y = 16;
    const now = new Date();
    const emittedAt = now.toLocaleDateString('pt-BR');
    let currentSectionTitle = '';

    function faixaAccentColor(valor) {
        const colors = {
            'Crítico': { fill: [254, 226, 226], border: [239, 68, 68], text: [185, 28, 28] },
            'Atenção': { fill: [254, 243, 199], border: [245, 158, 11], text: [180, 83, 9] },
            'Adequado': { fill: [220, 252, 231], border: [34, 197, 94], text: [21, 128, 61] }
        };
        return colors[valor] || { fill: [248, 250, 252], border: [214, 224, 238], text: [52, 80, 107] };
    }

    function drawHeader(pageNumber) {
        if (pageNumber === 1) {
            doc.setFillColor(23, 58, 94);
            doc.rect(0, 0, pageWidth, 28, 'F');
            doc.setFillColor(36, 80, 122);
            doc.rect(0, 28, pageWidth, 10, 'F');

            const iconX = marginX;
            const iconY = 7.4;
            const textX = iconX + 14;
            const iconDataUrl = renderSiteIconDataUrl();
            if (iconDataUrl) {
                doc.addImage(iconDataUrl, 'PNG', iconX - 0.8, iconY - 0.3, 8.8, 8.8, undefined, 'FAST');
            }

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.setTextColor(255, 255, 255);
            doc.text('SADE', textX, 14);

            doc.setFontSize(13);
            doc.text('Relatório de Itens por Escola', marginX, 24);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9.5);
            doc.text('PAINEL DE RESULTADOS — AVALIE.CE 2026.2', marginX, 34);

            doc.setTextColor(23, 50, 77);
            doc.setFillColor(248, 250, 252);
            doc.roundedRect(marginX, 45, contentWidth, 56, 4, 4, 'F');
            doc.setDrawColor(214, 224, 238);
            doc.roundedRect(marginX, 45, contentWidth, 56, 4, 4, 'S');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.text('REDE MUNICIPAL DE ARARENDÁ-CE', marginX + 4, 52);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.7);
            let filterY = 58;
            filtrosTxt.forEach(linha => {
                const lines = doc.splitTextToSize(linha, contentWidth - 8);
                doc.text(lines, marginX + 4, filterY);
                filterY += lines.length * 4;
            });
            doc.setFontSize(8);
            doc.text(`Total de itens: ${rows.length}. Apuração pelas listas; sem nova correção por gabarito.`, marginX + 4, 94);
            const issues = (painelData.metadata.divergencias_totais_listas || []).filter(r => r.escola === escola);
            if (issues.length) doc.text(`Atenção: ${issues.length} registros da escola divergem entre total de erros e lista. Prevalece a lista.`, marginX + 4, 98);
            y = 110;
        } else {
            doc.setDrawColor(214, 224, 238);
            doc.line(marginX, 16, pageWidth - marginX, 16);
            y = 24;
        }

        doc.setFontSize(9);
        doc.setTextColor(124, 140, 165);
        doc.text('AVALIE.CE 2026.2 · Ararendá-CE', marginX, pageHeight - 8);
        doc.text(`Emitido em ${emittedAt} · Página ${pageNumber}`, pageWidth - marginX - 52, pageHeight - 8);
    }

    function drawAnoSectionTitle(anoLabel, isContinuation = false) {
        const title = isContinuation ? `${anoLabel} — CONTINUAÇÃO` : anoLabel;
        currentSectionTitle = anoLabel;
        doc.setFillColor(236, 242, 248);
        doc.roundedRect(marginX, y - 2, contentWidth, 11, 2.5, 2.5, 'F');
        doc.setDrawColor(91, 125, 177);
        doc.setLineWidth(0.5);
        doc.roundedRect(marginX, y - 2, contentWidth, 11, 2.5, 2.5, 'S');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(23, 58, 94);
        doc.text(`ANO ESCOLAR: ${title}`, marginX + 4, y + 5);
        y += 15;
    }

    function getWrappedTextHeight(lines, fontSize, lineHeightFactor = 1.15) {
        const count = Array.isArray(lines) ? Math.max(lines.length, 1) : 1;
        return count * fontSize * 0.352778 * lineHeightFactor;
    }

    function getRelatorioBlockLayout(row) {
        const descricaoWidth = contentWidth - 12;
        const metaWidth = contentWidth - 12;
        const descricaoFontSize = 9.6;
        const descricaoLineHeight = 1.22;
        const metaFontSize = 8.2;
        const metaLineHeight = 1.22;
        const topPadding = 13;
        const bottomPadding = 8;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(descricaoFontSize);
        const descricao = doc.splitTextToSize(row.habilidade_descricao || '', descricaoWidth);
        doc.setFontSize(metaFontSize);
        const metaLine1 = doc.splitTextToSize(
            `Ano: ${row.ano_escolar || '-'}   |   Componente: ${row.componente || '-'}`,
            metaWidth
        );
        const metaLine2 = doc.splitTextToSize(
            `Acerto: ${row.acerto_pct}%   |   Faixa: ${row.faixa || '-'}   |   Registros: ${row.registros_avaliacao ?? '-'}   |   Habilidade: ${row.habilidade_descritor || '-'}`,
            metaWidth
        );
        const metaLines = [...metaLine1, ...metaLine2];
        const descricaoHeight = getWrappedTextHeight(descricao, descricaoFontSize, descricaoLineHeight);
        const metaHeight = getWrappedTextHeight(metaLines, metaFontSize, metaLineHeight);
        const blockHeight = topPadding + descricaoHeight + 5 + metaHeight + bottomPadding;

        return {
            descricaoWidth,
            metaWidth,
            descricaoFontSize,
            descricaoLineHeight,
            metaFontSize,
            metaLineHeight,
            descricao,
            metaLines,
            descricaoHeight,
            metaHeight,
            blockHeight
        };
    }

    function ensureSpace(requiredHeight, continuationTitle = '') {
        if (y + requiredHeight <= pageHeight - 16) return;
        doc.addPage();
        drawHeader(doc.getNumberOfPages());
        if (continuationTitle) {
            drawAnoSectionTitle(continuationTitle, true);
        }
    }

    drawHeader(1);
    const yearGroups = ano === 'Todos'
        ? [...new Set(rows.map(row => row.ano_escolar).filter(Boolean))]
            .sort((a, b) => anoSortKey(a) - anoSortKey(b))
            .map(anoEscolar => ({ anoEscolar, rows: rows.filter(row => row.ano_escolar === anoEscolar) }))
        : [{ anoEscolar: ano, rows }];

    yearGroups.forEach((group, groupIdx) => {
        const anoLabel = group.anoEscolar || 'ANO NÃO INFORMADO';
        const firstRowLayout = group.rows.length ? getRelatorioBlockLayout(group.rows[0]) : null;
        const requiredForNewSection = 15 + (firstRowLayout ? firstRowLayout.blockHeight : 0);

        if (groupIdx > 0 && y + requiredForNewSection > pageHeight - 16) {
            doc.addPage();
            drawHeader(doc.getNumberOfPages());
        }

        drawAnoSectionTitle(anoLabel, false);

        group.rows.forEach(row => {
            const layout = getRelatorioBlockLayout(row);
            const accent = faixaAccentColor(row.faixa);

            ensureSpace(layout.blockHeight, currentSectionTitle || anoLabel);

            doc.setFillColor(...accent.fill);
            doc.roundedRect(marginX, y - 4, contentWidth, layout.blockHeight, 3, 3, 'F');
            doc.setDrawColor(...accent.border);
            doc.setLineWidth(0.6);
            doc.roundedRect(marginX, y - 4, contentWidth, layout.blockHeight, 3, 3, 'S');
            doc.setDrawColor(214, 224, 238);
            doc.setFillColor(23, 58, 94);
            doc.roundedRect(marginX + 2, y - 1.5, 22, 7, 2, 2, 'F');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(255, 255, 255);
            doc.text(`${row.habilidade_pos}`, marginX + 5, y + 3);
            doc.setTextColor(...accent.text);
            doc.text(`${row.habilidade_descritor}`, marginX + 28, y + 3);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(layout.descricaoFontSize);
            doc.setTextColor(52, 80, 107);
            const descricaoY = y + 9.5;
            doc.text(layout.descricao, marginX + 4, descricaoY, {
                maxWidth: layout.descricaoWidth,
                lineHeightFactor: layout.descricaoLineHeight
            });

            const metaY = descricaoY + layout.descricaoHeight + 4.5;
            doc.setFontSize(layout.metaFontSize);
            doc.setTextColor(95, 111, 108);
            doc.text(layout.metaLines, marginX + 4, metaY, {
                maxWidth: layout.metaWidth,
                lineHeightFactor: layout.metaLineHeight
            });

            y += layout.blockHeight + 4;
        });
    });

    const fileBase = `relatorio_${slugify(escola)}_${slugify(ano === 'Todos' ? 'todos-anos' : ano)}_${slugify(componente === 'Todos' ? 'todos-componentes' : componente)}`;
    doc.save(`${fileBase}.pdf`);
}

function badgeClass(faixa) {
    const map = { 'Crítico': 'badge-critico', 'Atenção': 'badge-atencao', 'Adequado': 'badge-adequado' };
    return map[faixa] || '';
}

// ===== CHART HELPERS =====
function destroyChart(id) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function getBarColors(values, faixas) {
    if (faixas) return faixas.map(f => FAIXA_COLORS[f]?.border || '#667A90');
    return values.map(v => {
        if (v <= FAIXA_CRITICO_MAX) return '#EF4444';
        if (v <= FAIXA_ATENCAO_MAX) return '#F59E0B';
        return '#22C55E';
    });
}

function renderBarChart(id, labels, values, faixas, label) {
    destroyChart(id);
    const canvas = document.getElementById(id);
    const wrapper = canvas.parentElement;
    wrapper.style.minWidth = labels.length > 30 ? `${labels.length * 44}px` : '';
    const ctx = canvas.getContext('2d');
    charts[id] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label, data: values,
                backgroundColor: getBarColors(values, faixas),
                borderRadius: 4, maxBarThickness: 28
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => c.raw + '%' } },
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'end',
                    offset: 1,
                    font: { size: 10, weight: '800' },
                    color: '#17324D',
                    textStrokeColor: '#fff',
                    textStrokeWidth: 3,
                    formatter: v => v + '%'
                }
            },
            scales: {
                y: { min: 0, max: 110, ticks: { callback: v => v <= 100 ? v + '%' : '', font: { size: 10 } } },
                x: { ticks: { font: { size: 9 }, maxRotation: 45 } }
            }
        }
    });
}

function renderDoughnutChart(id, labels, values) {
    destroyChart(id);
    const ctx = document.getElementById(id).getContext('2d');
    const colors = labels.map(l => FAIXA_COLORS[l]?.border || '#667A90');
    charts[id] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 16, usePointStyle: true } },
                tooltip: { callbacks: { label: c => c.label + ': ' + c.raw + ' item(ns)' } },
                datalabels: {
                    display: true,
                    color: '#fff',
                    font: { weight: 'bold', size: 13 },
                    formatter: (value, ctx) => {
                        const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                        return total ? Math.round(value / total * 100) + '%' : '';
                    }
                }
            }
        }
    });
}

function renderHorizontalBar(id, labels, values, descricoes, isLow) {
    destroyChart(id);
    const ctx = document.getElementById(id).getContext('2d');
    const colors = values.map(v => {
        if (v <= FAIXA_CRITICO_MAX) return '#EF4444';
        if (v <= FAIXA_ATENCAO_MAX) return '#F59E0B';
        return '#22C55E';
    });
    charts[id] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label: 'Acerto %', data: values, backgroundColor: colors, borderRadius: 4 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: (c) => descricoes ? truncate(descricoes[c.dataIndex], 70) : '',
                        label: c => c.raw + '%'
                    }
                },
                datalabels: {
                    display: true,
                    anchor: 'end',
                    align: 'end',
                    offset: 2,
                    font: { size: 10, weight: '800' },
                    color: '#17324D',
                    textStrokeColor: '#fff',
                    textStrokeWidth: 3,
                    formatter: v => v + '%'
                }
            },
            scales: {
                x: { min: 0, max: 110, ticks: { callback: v => v <= 100 ? v + '%' : '' } },
                y: { ticks: { font: { size: 11 } } }
            }
        }
    });
}

// ===== UTILS =====
function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '…' : str;
}

function slugify(str) {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function sanitize(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
