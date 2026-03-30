import { fetchTableDetailsApi, explainQueryApi, terminateQueryApi } from './api.js';
import { analyzeExplainPlan } from './explain.js';

let activeServerRef = null;
let activeDbRef = 'postgres';
let currentRawSql = '';
export let currentModalPid = null;
let lastAlertTime = 0;
export let charts = {};

export function setActiveServer(server) { activeServerRef = server; }
export function setActiveDb(dbName) { activeDbRef = dbName; }

const C = {
    grid:   'rgba(26,37,64,0.6)',
    text:   '#4a5878',
    blue:   '#336791',
    light:  '#6cb4ee',
    green:  '#10b981',
    amber:  '#f59e0b',
    rose:   '#ef4444',
    indigo: '#6366f1',
};

export function initCharts() {
    Chart.defaults.color = C.text;
    Chart.defaults.font.family = "'JetBrains Mono', monospace";
    Chart.defaults.font.size = 10;

    const ctxStates = document.getElementById('chartStates');
    if (ctxStates) {
        charts.states = new Chart(ctxStates, {
            type: 'doughnut',
            data: {
                labels: ['Active', 'Idle in Tx', 'Waiting'],
                datasets: [{
                    data: [0, 0, 0],
                    backgroundColor: [C.blue, C.amber, C.rose],
                    borderWidth: 0,
                    hoverOffset: 4,
                }]
            },
            options: {
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: { legend: { position: 'right', labels: { boxWidth: 8, padding: 12, font: { size: 9 } } } }
            }
        });
    }

    const ctxTables = document.getElementById('chartTables');
    if (ctxTables) {
        charts.tables = new Chart(ctxTables, {
            type: 'bar',
            data: { labels: [], datasets: [{ label: 'MB', data: [], backgroundColor: C.indigo, borderRadius: 4, borderSkipped: false }] },
            options: {
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: C.grid }, ticks: { font: { size: 9 } } },
                    y: { grid: { display: false }, ticks: { font: { size: 9 } } }
                }
            }
        });
    }

    const ctxTps = document.getElementById('chartTps');
    if (ctxTps) {
        charts.tps = new Chart(ctxTps, {
            type: 'line',
            data: {
                labels: Array(20).fill(''),
                datasets: [
                    { label: 'Commits', data: Array(20).fill(0), borderColor: C.green, backgroundColor: 'rgba(16,185,129,0.08)', tension: 0.4, borderWidth: 1.5, pointRadius: 0, fill: true },
                ]
            },
            options: {
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: C.grid }, ticks: { font: { size: 9 } } },
                    x: { grid: { display: false }, ticks: { display: false } }
                }
            }
        });
    }
}

export function updateCharts(activeCount, idleTxCount, locksCount, tables) {
    if (charts.states) {
        charts.states.data.datasets[0].data = [activeCount, idleTxCount, locksCount];
        charts.states.update('none');
    }
    if (charts.tables && tables.length > 0) {
        const top5 = tables.slice(0, 5);
        charts.tables.data.labels = top5.map(t => t.name.length > 12 ? t.name.substring(0, 12) + '…' : t.name);
        charts.tables.data.datasets[0].data = top5.map(t => (t.size_bytes / (1024 ** 2)).toFixed(2));
        charts.tables.update('none');
    }
    if (charts.tps) {
        const tps = Math.floor(Math.random() * 150) + 400;
        charts.tps.data.datasets[0].data.push(tps);
        charts.tps.data.datasets[0].data.shift();
        charts.tps.update('none');
    }
}

export function showToast(title, message, type = 'error') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    let bgClass, titleClass, msgClass, closeClass;

    if (type === 'error') {
        bgClass = 'bg-rose-600 shadow-rose-500/20';
        titleClass = 'text-white';
        msgClass = 'text-rose-100';
        closeClass = 'text-rose-200 hover:text-white hover:bg-rose-700';
    } else if (type === 'warning') {
        bgClass = 'bg-amber-500 shadow-amber-500/20';
        titleClass = 'text-white';
        msgClass = 'text-amber-50';
        closeClass = 'text-amber-200 hover:text-white hover:bg-amber-600';
    } else if (type === 'success') {
        bgClass = 'bg-emerald-600 shadow-emerald-500/20';
        titleClass = 'text-white';
        msgClass = 'text-emerald-100';
        closeClass = 'text-emerald-200 hover:text-white hover:bg-emerald-700';
    } else {
        bgClass = 'bg-indigo-600 shadow-indigo-500/20';
        titleClass = 'text-white';
        msgClass = 'text-indigo-100';
        closeClass = 'text-indigo-200 hover:text-white hover:bg-indigo-700';
    }

    toast.className = `toast flex items-start gap-3 p-4 rounded-xl shadow-2xl transform transition-all duration-300 translate-y-5 opacity-0 min-w-[280px] max-w-sm ${bgClass}`;

    toast.innerHTML = `
        <div class="flex-1">
            <p class="text-xs font-bold ${titleClass} mb-1">${title}</p>
            <p class="text-[10px] leading-relaxed ${msgClass} break-all">${message}</p>
        </div>
        <button onclick="this.closest('.toast').remove()" class="w-6 h-6 flex items-center justify-center rounded-md transition-colors ${closeClass} shrink-0">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
    `;
    
    container.appendChild(toast);
    
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.remove('translate-y-5', 'opacity-0');
        });
    });

    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 6000);
}

export function hideLoader() {
    const loader = document.getElementById('loader');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 600);
    }
}

export function checkAlerts(kpis, queries) {
    const now = Date.now();
    if (now - lastAlertTime < 60_000) return;
    const dl = kpis.deadlocks || 0;
    const locks = queries.filter(q => q.locked).length;
    if (dl > 0) {
        showToast('🚨 Deadlock Detected', `${dl} deadlock(s) in the database`, 'error');
        lastAlertTime = now;
    } else if (locks > 0) {
        showToast('⚠️ Lock Warning', `${locks} query(ies) waiting on locks`, 'warning');
        lastAlertTime = now;
    }
    if ((kpis.cache_hit_ratio || 0) < 85) {
        showToast('📉 Low Cache Hit', `Buffer hit ratio: ${(kpis.cache_hit_ratio || 0).toFixed(1)}%`, 'warning');
    }
}

window.toggleTheme = () => {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
};

window.showPage = (name) => {
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    const page = document.getElementById('page-' + name);
    if (page) { 
        page.classList.add('active'); 
        page.classList.remove('fade-up'); 
        void page.offsetWidth; 
        page.classList.add('fade-up'); 
    }
    
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => { 
        const onclickAttr = item.getAttribute('onclick');
        if (onclickAttr && (onclickAttr.includes(`('${name}')`) || onclickAttr.includes(`("${name}")`))) {
            item.classList.add('active'); 
        }
    });
};

window.closeModal = (id) => { 
    const el = document.getElementById(id);
    if(el) el.classList.add('hidden'); 
};

window.filterTable = (tbodyId, val) => {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const q = val.toLowerCase();
    tbody.querySelectorAll('tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
};

window.currentFilter = 'all';
window.setQueryFilter = (type) => {
    window.currentFilter = type;
    document.querySelectorAll('[id^="qf"]').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('qf' + type.charAt(0).toUpperCase() + type.slice(1));
    if(btn) btn.classList.add('active');
    if (window.renderQueryRows) window.renderQueryRows();
};

window.renderQueryRows = () => {
    const tbody = document.getElementById('tbodyQueries');
    if (!tbody) return;
    let rows = window._allQueryRows || [];
    
    if (window.currentFilter === 'active') rows = rows.filter(r => r.dataset.state === 'active');
    if (window.currentFilter === 'locked') rows = rows.filter(r => r.dataset.locked === 'true');
    
    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-500 text-xs">No matching queries</td></tr>';
    } else {
        rows.forEach(r => tbody.appendChild(r.cloneNode(true)));
        tbody.querySelectorAll('tr[data-b64]').forEach(tr => {
            tr.onclick = () => {
                const b64 = tr.dataset.b64;
                const pid = tr.dataset.pid;
                const user = tr.dataset.user;
                const state = tr.dataset.state;
                const dur = tr.dataset.dur;
                window.openModal(pid, user, state, dur, b64);
            };
        });
    }
};

window.updateGauge = (id, pct) => {
    const el = document.getElementById(id);
    if (!el) return;
    const circumference = 2 * Math.PI * 16; 
    const filled = (pct / 100) * circumference;
    el.setAttribute('stroke-dasharray', `${filled} ${circumference - filled}`);
};

window.changeRefreshInterval = () => {
    const refreshEl = document.getElementById('refreshInterval');
    if (!refreshEl) return;
    const val = parseInt(refreshEl.value);
    if (window._refreshTimer) clearInterval(window._refreshTimer);
    if (val > 0 && window._loadDashboard) {
        window._refreshTimer = setInterval(window._loadDashboard, val);
    }
};

export function initUI() {
    document.querySelectorAll('[id$="Modal"]').forEach(m => {
        m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
    });
}

window.openErrorModal = (time, user, db, sev, b64Msg, b64Query) => {
    const msg = decodeURIComponent(atob(b64Msg));
    const query = decodeURIComponent(atob(b64Query));
    
    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setTxt('errModalTime', time);
    setTxt('errModalUser', user);
    setTxt('errModalDb', db);
    setTxt('errModalSev', sev);
    setTxt('errModalMsg', msg);
    
    const queryEl = document.getElementById('errModalQuery');
    if (queryEl) {
        queryEl.innerHTML = (query || '-').replace(
            /\b(SELECT|FROM|WHERE|AND|OR|JOIN|LEFT|RIGHT|INNER|OUTER|ON|UPDATE|SET|INSERT|INTO|VALUES|DELETE|BEGIN|COMMIT|ROLLBACK|CREATE|INDEX|TABLE|CONCURRENTLY)\b/gi,
            '<span class="sql-kw">$1</span>'
        );
    }
    
    document.getElementById('errorModal')?.classList.remove('hidden');
};

window.openModal = (pid, user, state, dur, b64Sql) => {
    const sql = decodeURIComponent(atob(b64Sql));
    currentRawSql = sql;
    currentModalPid = pid; 

    document.getElementById('explainContainer')?.classList.add('hidden');
    
    const btn = document.getElementById('explainBtn');
    if(btn) {
        btn.disabled = false;
        btn.innerHTML = `
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            Smart Analyze
        `;
    }

    const killBtn = document.getElementById('killQueryBtn');
    if (killBtn) {
        if (pid && !isNaN(pid)) {
            killBtn.classList.remove('hidden');
        } else {
            killBtn.classList.add('hidden');
        }
    }

    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setTxt('modalPid', pid);
    setTxt('modalUser', user);
    setTxt('modalDur', dur);
    setTxt('modalState', state);
    
    const sqlEl = document.getElementById('modalSql');
    if(sqlEl) {
        sqlEl.innerHTML = sql.replace(
            /\b(SELECT|FROM|WHERE|AND|OR|JOIN|LEFT|RIGHT|INNER|OUTER|ON|UPDATE|SET|INSERT|INTO|VALUES|DELETE|BEGIN|COMMIT|ROLLBACK|VACUUM|ANALYZE|EXPLAIN|WITH|AS|UNION|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|DISTINCT|COUNT|SUM|AVG|MAX|MIN|CASE|WHEN|THEN|ELSE|END|NOT|IN|EXISTS|LIKE|ILIKE|RETURNING|CREATE|INDEX|TABLE|CONCURRENTLY)\b/gi,
            '<span class="sql-kw">$1</span>'
        );
    }
    document.getElementById('queryModal')?.classList.remove('hidden');
};

window.killQuery = async () => {
    if (!currentModalPid || isNaN(currentModalPid)) return;
    if (!confirm(`PID ${currentModalPid} numaralı sorguyu sonlandırmak istediğinizden emin misiniz?`)) return;

    const btn = document.getElementById('killQueryBtn');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = 'Terminating...';
    btn.disabled = true;

    try {
        const data = await terminateQueryApi(activeServerRef, activeDbRef, parseInt(currentModalPid));
        if (data.status === 'success') {
            showToast('Başarılı', data.message, 'success');
            window.closeModal('queryModal');
            if (window._loadDashboard) window._loadDashboard(); 
        } else {
            showToast('Hata', data.message, 'error');
        }
    } catch (e) {
        showToast('Bağlantı Hatası', 'Sunucuya ulaşılamadı.', 'error');
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
};

window.runExplain = async () => {
    const btn = document.getElementById('explainBtn');
    if(btn) {
        btn.innerHTML = `<svg class="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Analyzing…`;
        btn.disabled = true;
    }

    try {
        const data = await explainQueryApi(activeServerRef, activeDbRef, currentRawSql);
        if (data.status === 'success') {
            const smartContainer = document.getElementById('smartAnalysisContainer');
            if(smartContainer) smartContainer.innerHTML = analyzeExplainPlan(data.plan);
            
            const explainText = document.getElementById('explainText');
            if(explainText) explainText.textContent = data.plan;
            
            document.getElementById('explainContainer')?.classList.remove('hidden');
            if(btn) btn.innerHTML = `✓ Analysis Complete`;
        } else {
            // ── YENİ: KESİLMİŞ (TRUNCATED) SORGULARI ALGILAYAN ZEKİ KONTROL ──
            let errMsg = data.message;
            if (errMsg.toLowerCase().includes('syntax error') && currentRawSql.length > 1000) {
                errMsg = "Sorgunun sonu kesilmiş! (PostgreSQL 'track_activity_query_size' limitine takıldığı için tamamı okunamadı). Bu yüzden analiz edilemiyor.";
                showToast('Kırpılmış Sorgu', errMsg, 'warning');
            } else {
                showToast('EXPLAIN Başarısız', errMsg, 'error');
            }
            if(btn) { btn.disabled = false; btn.innerHTML = 'Smart Analyze'; }
        }
    } catch {
        showToast('Bağlantı Hatası', 'Sunucuya ulaşılamadı.', 'error');
        if(btn) { btn.disabled = false; btn.innerHTML = 'Smart Analyze'; }
    }
};

window.copySql = () => {
    navigator.clipboard.writeText(currentRawSql);
    showToast('Kopyalandı', 'SQL panoya başarıyla kopyalandı.', 'success');
};

window.fetchTableDetails = async (db, schema, table) => {
    try {
        const data = await fetchTableDetailsApi(activeServerRef, db, schema, table);
        if (data.status === 'success') {
            const tableNameEl = document.getElementById('detailTableName');
            if(tableNameEl) tableNameEl.textContent = `${schema}.${table}`;

            const colBody = document.getElementById('tbodyTableColumns');
            if(colBody) {
                colBody.innerHTML = data.columns.map(c => `
                    <tr>
                        <td class="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">${c.column_name}</td>
                        <td class="font-mono text-[10px] text-blue-600 dark:text-blue-400">${c.data_type}</td>
                        <td class="font-mono text-[10px] text-slate-600 dark:text-slate-500">${c.character_maximum_length || '—'}</td>
                        <td class="font-mono text-[10px] ${c.is_nullable === 'YES' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}">${c.is_nullable}</td>
                        <td class="font-mono text-[10px] text-slate-500">${c.column_default || '—'}</td>
                    </tr>
                `).join('');
            }

            const idxBody = document.getElementById('tbodyTableIndexes');
            if(idxBody) {
                idxBody.innerHTML = (data.indexes || []).map(i => `
                    <tr>
                        <td class="font-mono text-[10px] text-violet-600 dark:text-violet-400 font-bold">${i.indexname}</td>
                        <td class="font-mono text-[10px] text-slate-600 dark:text-slate-400 break-all">${i.indexdef}</td>
                    </tr>
                `).join('') || '<tr><td colspan="2" class="text-center py-4 text-slate-500 text-xs">No indexes</td></tr>';
            }

            document.getElementById('tableDetailModal')?.classList.remove('hidden');
        }
    } catch (e) {
        showToast('Hata', 'Tablo detayları yüklenemedi.', 'error');
    }
};