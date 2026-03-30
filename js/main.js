import { checkAuth } from './auth.js';
import { fetchMonitoringData, fetchConfigData, fetchServersApi, fetchLogFilesApi, fetchLogContentApi } from './api.js';
import { hideLoader, checkAlerts, setActiveDb, setActiveServer, initCharts, updateCharts, initUI } from './ui.js';

checkAuth();

let selectedServer = null;
let selectedDb = null;
let isFirstLoad = true;

window.selectServer = (serverId) => {
    selectedServer = serverId;
    selectedDb = null; 
    setActiveServer(serverId);
    
    const loader = document.getElementById('loader');
    if(loader) {
        loader.style.display = 'flex';
        loader.style.opacity = '1';
        setTimeout(() => hideLoader(), 600);
    }
    
    if (window.loadLogFiles) window.loadLogFiles();
    
    loadDashboard();
};

window.selectDatabase = (dbName) => {
    selectedDb = dbName;
    loadDashboard();
};

const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
const setHtml = (id, val) => { const el = document.getElementById(id); if(el) el.innerHTML = val; };
const setClass = (id, val) => { const el = document.getElementById(id); if(el) el.className = val; };

function fmtBytes(bytes) {
    if (!bytes) return '0 B';
    if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB';
    if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(2) + ' MB';
    return (bytes / 1024).toFixed(1) + ' KB';
}

function fmtNum(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return (n || 0).toLocaleString('tr-TR');
}

function healthBadge(bloatRatio) {
    if (bloatRatio > 15) return `<span class="status-pill health-critical">BLOATED</span>`;
    if (bloatRatio > 5)  return `<span class="status-pill health-warn">VACUUM</span>`;
    return `<span class="status-pill health-ok">HEALTHY</span>`;
}

// ── CSV LOG DOSYALARINI LİSTELEME VE OKUMA ──
window.loadLogFiles = async () => {
    const selectEl = document.getElementById('logFileSelect');
    if (!selectEl) return;
    
    selectEl.innerHTML = '<option value="">Dosyalar Yükleniyor...</option>';
    
    try {
        const data = await fetchLogFilesApi(selectedServer);
        if (data.status === 'success') {
            if (data.files.length === 0) {
                selectEl.innerHTML = '<option value="">Son 30 güne ait CSV log bulunamadı</option>';
                setHtml('tbodyErrorLogs', '<tr><td colspan="6" class="text-center py-8 text-slate-500 text-xs">Log klasöründe dosya yok.</td></tr>');
            } else {
                selectEl.innerHTML = data.files.map(f => `<option value="${f.filename}">${f.filename} (${f.mtime})</option>`).join('');
                window.loadLogContent(data.files[0].filename);
            }
        } else {
            selectEl.innerHTML = `<option value="">Hata: Bulunamadı</option>`;
            setHtml('tbodyErrorLogs', `<tr><td colspan="6" class="text-center py-8 text-rose-500 text-xs">${data.message}</td></tr>`);
        }
    } catch (e) {
        selectEl.innerHTML = '<option value="">Bağlantı Hatası</option>';
    }
};

// YENİ EKLENDİ: isSilent parametresi ile arkadan sessizce yenileme yeteneği eklendi
window.loadLogContent = async (filename, isSilent = false) => {
    if (!filename) return;
    
    // Sadece manuel seçimlerde Yükleniyor... spineri gösterilir, auto-refresh yaparken gösterilmez.
    if (!isSilent) {
        setHtml('tbodyErrorLogs', '<tr><td colspan="6" class="text-center py-8 text-slate-500 text-xs"><svg class="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>Log satırları okunuyor, lütfen bekleyin...</td></tr>');
    }
    
    try {
        const data = await fetchLogContentApi(selectedServer, filename);
        if (data.status === 'success') {
            const errors = data.errors;
            if (errors.length === 0) {
                setHtml('tbodyErrorLogs', '<tr><td colspan="6" class="text-center py-8 text-emerald-500 text-xs font-bold">Bu log dosyasında hiç hata (ERROR/FATAL/PANIC) bulunamadı. Mükemmel!</td></tr>');
            } else {
                setHtml('tbodyErrorLogs', errors.map(err => {
                    const sevColor = (err.severity === 'FATAL' || err.severity === 'PANIC') ? 'text-rose-500 font-bold' : 'text-amber-500 font-bold';
                    const shortMsg = err.message.length > 60 ? err.message.substring(0, 60) + '...' : err.message;
                    const b64Msg = btoa(encodeURIComponent(err.message));
                    const b64Query = btoa(encodeURIComponent(err.query || ''));
                    
                    return `
                    <tr onclick="window.openErrorModal('${err.time}', '${err.user}', '${err.db}', '${err.severity}', '${b64Msg}', '${b64Query}')">
                        <td class="font-mono text-[10px] text-slate-500 dark:text-slate-400">${err.time}</td>
                        <td class="font-mono text-[10px] ${sevColor}">${err.severity}</td>
                        <td class="font-mono text-[10px] text-blue-600 dark:text-[#6cb4ee]">${err.user}</td>
                        <td class="font-mono text-[10px] text-slate-600 dark:text-slate-300">${err.db}</td>
                        <td class="font-mono text-[10px] text-slate-600 dark:text-slate-400 max-w-[300px] truncate">${shortMsg}</td>
                        <td class="text-center"><button class="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-1 rounded">Detay</button></td>
                    </tr>`;
                }).join(''));
            }
        } else {
            if(!isSilent) setHtml('tbodyErrorLogs', `<tr><td colspan="6" class="text-center py-8 text-rose-500 text-xs">${data.message}</td></tr>`);
        }
    } catch (e) {
        if(!isSilent) setHtml('tbodyErrorLogs', '<tr><td colspan="6" class="text-center py-8 text-rose-500 text-xs">Log içeriği alınamadı veya çok büyük.</td></tr>');
    }
};

// ── Main data loader ──────────────────────────────────────────────
async function loadDashboard() {
    if (!selectedServer) return;

    const data = await fetchMonitoringData(selectedServer, selectedDb);
    if (!data || data.status !== 'success') return;

    const queries     = data.queries     || [];
    const slowQueries = data.slow_queries || [];
    const tables      = data.tables      || [];
    const kpis        = data.kpis        || {};
    const sm          = data.server_metrics || { cpu:0, ram:0, disk:0 };

    setActiveDb(data.current_db);
    
    const serverSelectEl = document.getElementById('serverSelect');
    const serverName = serverSelectEl ? serverSelectEl.options[serverSelectEl.selectedIndex]?.text : selectedServer;
    setTxt('topbarDb', `${serverName} / ${data.current_db}`);

    // ── 1. Server Metrics ─────────────────────────────────────────
    ['cpu', 'ram', 'disk'].forEach((m, i) => {
        const val = sm[m] || 0;
        const ids = ['osCpu', 'osRam', 'osDisk'];
        const gaugeIds = ['cpuGauge', 'ramGauge', 'diskGauge'];
        
        setTxt(ids[i] + 'Text', val.toFixed(1) + '%');
        
        const barEl = document.getElementById(ids[i] + 'Bar');
        if (barEl) barEl.style.width = val + '%';
        
        if (window.updateGauge) window.updateGauge(gaugeIds[i], val);
    });

    // ── 2. KPI Cards ──────────────────────────────────────────────
    setTxt('kpiConns', kpis.active_connections || 0);
    const cacheVal = (kpis.cache_hit_ratio || 0).toFixed(1) + '%';
    setTxt('kpiCache', cacheVal);
    setClass('kpiCache', `font-mono text-3xl font-bold count-up ${(kpis.cache_hit_ratio || 0) < 90 ? 'text-amber-500' : 'text-emerald-500'}`);
    setTxt('kpiSize', fmtBytes(kpis.total_size_bytes));

    // ── 3. Diagnostics ────────────────────────────────────────────
    setTxt('kpiIndexHit', (kpis.index_hit_rate || 0).toFixed(1) + '%');

    const rbRate = kpis.rollback_rate || 0;
    setTxt('kpiRollbacks', rbRate.toFixed(2) + '%');
    setClass('kpiRollbacks', `font-mono text-xs font-bold ${rbRate > 1 ? 'text-rose-500' : ''}`);

    const dl = kpis.deadlocks || 0;
    setTxt('kpiDeadlocks', dl);
    setClass('kpiDeadlocks', `font-mono text-xs font-bold ${dl > 0 ? 'text-rose-500' : ''}`);

    setTxt('kpiTempFiles', kpis.temp_files || 0);

    // ── 4. DB List ────────────────────────────────────────────────
    const dbHtml = (data.databases || []).map(db => `
        <button onclick="window.selectDatabase('${db}')"
            class="db-btn ${db === data.current_db ? 'active' : ''}">
            ${db}
        </button>
    `).join('');
    setHtml('dbList', dbHtml);

    // ── 5. Locks count ────────────────────────────────────────────
    const locksCount = queries.filter(q => q.locked).length;
    setTxt('kpiLocks', locksCount);

    const navLock = document.getElementById('navLockCount');
    if (navLock) {
        navLock.textContent = locksCount;
        if (locksCount > 0) navLock.classList.remove('hidden'); else navLock.classList.add('hidden');
    }

    const navQ = document.getElementById('navQueryCount');
    if (navQ) {
        navQ.textContent = queries.length;
        if (queries.length > 0) navQ.classList.remove('hidden'); else navQ.classList.add('hidden');
    }

    // ── 6. Live Queries Table ─────────────────────────────────────
    const qRows = [];
    if (queries.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="7" class="text-center py-8 text-slate-500 text-xs italic">No active queries in the last 5 minutes</td>';
        qRows.push(tr);
    } else {
        queries.forEach(q => {
            const isLocked = q.locked;
            const b64 = btoa(encodeURIComponent(q.query || ''));
            const stateColor = isLocked ? 'text-rose-600 dark:text-rose-400 font-bold' :
                (q.state || '').includes('idle') ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400';
            const shortQ = (q.query || '').length > 50 ? q.query.substring(0, 50) + '…' : (q.query || '—');

            const tr = document.createElement('tr');
            tr.className = isLocked ? 'row-locked cursor-pointer' : 'cursor-pointer';
            tr.dataset.b64   = b64;
            tr.dataset.pid   = q.pid;
            tr.dataset.user  = q.user;
            tr.dataset.state = q.state || '';
            tr.dataset.dur   = q.duration_sec + 's';
            tr.dataset.locked = isLocked ? 'true' : 'false';
            tr.innerHTML = `
                <td class="font-mono text-[10px] text-slate-500 dark:text-slate-400">${q.start_time || '—'}</td>
                <td class="font-mono text-[10px] text-blue-600 dark:text-[#6cb4ee] font-bold">${q.pid}</td>
                <td class="font-mono text-[10px] text-slate-700 dark:text-slate-200">${q.user}</td>
                <td class="font-mono text-[10px] ${stateColor}">${q.state || '—'}</td>
                <td class="font-mono text-[10px] text-amber-600 dark:text-amber-400">${q.duration_sec}s</td>
                <td class="font-mono text-[10px] ${isLocked ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-500'}">${isLocked ? '🔒 Lock' : '—'}</td>
                <td class="font-mono text-[10px] text-slate-600 dark:text-slate-400 truncate max-w-[240px]">${shortQ}</td>
            `;
            tr.onclick = () => window.openModal(q.pid, q.user, q.state, q.duration_sec + 's', b64);
            qRows.push(tr);
        });
    }
    window._allQueryRows = qRows;
    if (window.renderQueryRows) window.renderQueryRows();

    // ── 7. Slow Queries ───────────────────────────────────────────
    const slowHtml = slowQueries.length === 0
        ? '<tr><td colspan="6" class="text-center py-8 text-slate-500 text-xs italic">pg_stat_statements data not available</td></tr>'
        : slowQueries.map(sq => {
            const shortQ = (sq.query || '').length > 50 ? sq.query.substring(0, 50) + '…' : sq.query;
            const b64 = btoa(encodeURIComponent(sq.query || ''));
            return `
            <tr onclick="window.openModal('Historical','App','Slow Query','${sq.calls} calls','${b64}')">
                <td class="font-mono text-[10px] text-slate-600 dark:text-slate-400">${fmtNum(sq.calls)}</td>
                <td class="font-mono text-[10px] text-amber-600 dark:text-amber-400 font-bold">${sq.mean_time_ms} ms</td>
                <td class="font-mono text-[10px] text-rose-600 dark:text-rose-400">${sq.max_time_ms} ms</td>
                <td class="font-mono text-[10px] text-slate-600 dark:text-slate-500 truncate max-w-[200px]">${shortQ}</td>
            </tr>`;
        }).join('');
    setHtml('tbodySlowQueries', slowHtml);

    const slowFullHtml = slowQueries.length === 0
        ? '<tr><td colspan="6" class="text-center py-8 text-slate-500 text-xs italic">pg_stat_statements data not available</td></tr>'
        : slowQueries.map(sq => {
            const b64 = btoa(encodeURIComponent(sq.query || ''));
            const shortQ = (sq.query || '').length > 60 ? sq.query.substring(0, 60) + '…' : sq.query;
            const totalMs = ((sq.mean_time_ms || 0) * (sq.calls || 1)).toFixed(0);
            const rowsPerCall = sq.rows ? (sq.rows / sq.calls).toFixed(1) : '—';
            return `
            <tr onclick="window.openModal('Historical','App','Slow Query','${sq.calls} calls','${b64}')">
                <td class="font-mono text-[10px] text-slate-600 dark:text-slate-400 font-bold">${fmtNum(sq.calls)}</td>
                <td class="font-mono text-[10px] text-amber-600 dark:text-amber-400 font-bold">${sq.mean_time_ms} ms</td>
                <td class="font-mono text-[10px] text-rose-600 dark:text-rose-400">${sq.max_time_ms} ms</td>
                <td class="font-mono text-[10px] text-slate-600 dark:text-slate-500">${fmtNum(totalMs)} ms</td>
                <td class="font-mono text-[10px] text-slate-600 dark:text-slate-500">${rowsPerCall}</td>
                <td class="font-mono text-[10px] text-slate-600 dark:text-slate-400 max-w-[280px] truncate">${shortQ}</td>
            </tr>`;
        }).join('');
    setHtml('tbodySlowFull', slowFullHtml);

    // ── 8. Tables ─────────────────────────────────────────────────
    const tableRowHtml = tables.map(t => {
        const sizeStr = fmtBytes(t.size_bytes);
        const bloatRatio = t.rows > 0 ? (t.dead / t.rows) * 100 : 0;
        return `
        <tr onclick="window.fetchTableDetails('${t.db_name}','${t.schema_name}','${t.name}')">
            <td class="font-mono text-[10px] text-blue-600 dark:text-blue-400">${t.schema_name || 'public'}</td>
            <td class="font-mono text-[10px] text-blue-600 dark:text-[#6cb4ee] font-bold">${t.name}</td>
            <td class="font-mono text-[10px] text-slate-600 dark:text-slate-300">${sizeStr}</td>
            <td class="font-mono text-[10px] text-slate-600 dark:text-slate-400">${fmtNum(t.rows)}</td>
            <td class="font-mono text-[10px] ${t.dead > 1000 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-500'}">${fmtNum(t.dead)}</td>
            <td class="font-mono text-[10px] text-rose-600 dark:text-rose-400">${fmtNum(t.seq_scan)}</td>
            <td class="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">${fmtNum(t.idx_scan)}</td>
            <td class="font-mono text-[10px] text-slate-500">${t.last_autovacuum || 'Never'}</td>
            <td>${healthBadge(bloatRatio)}</td>
        </tr>`;
    }).join('');
    setHtml('tbodyAllTables', tableRowHtml || '<tr><td colspan="9" class="text-center py-8 text-slate-500 text-xs">No tables found</td></tr>');

    // ── 9. Locks page ─────────────────────────────────────────────
    const lockedRows = queries.filter(q => q.locked);
    const locksEmptyEl = document.getElementById('locksEmpty');
    const locksTableEl = document.getElementById('locksTable');
    if (locksEmptyEl && locksTableEl) {
        if (lockedRows.length === 0) {
            locksEmptyEl.classList.remove('hidden');
            locksTableEl.classList.add('hidden');
        } else {
            locksEmptyEl.classList.add('hidden');
            locksTableEl.classList.remove('hidden');
            setHtml('tbodyLocks', lockedRows.map(q => {
                const b64 = btoa(encodeURIComponent(q.query || ''));
                return `
                <tr class="row-locked" onclick="window.openModal('${q.pid}','${q.user}','${q.state}','${q.duration_sec}s','${b64}')">
                    <td class="font-mono text-[10px] text-rose-600 dark:text-rose-400 font-bold">${q.pid}</td>
                    <td class="font-mono text-[10px] text-slate-600 dark:text-slate-300">${q.user}</td>
                    <td class="font-mono text-[10px] text-amber-600 dark:text-amber-400">${q.duration_sec}s</td>
                    <td class="font-mono text-[10px] text-slate-500 dark:text-slate-400">—</td>
                    <td class="font-mono text-[10px] text-rose-600 dark:text-rose-400">Lock</td>
                    <td class="font-mono text-[10px] text-slate-500 dark:text-slate-500 truncate max-w-[220px]">${(q.query||'').substring(0,60)}…</td>
                </tr>`;
            }).join(''));
        }
    }

    // ── 10. Vacuum & Bloat page ───────────────────────────────────
    const sortedByBloat = [...tables].sort((a, b) => {
        const ar = a.rows > 0 ? (a.dead / a.rows) * 100 : 0;
        const br2 = b.rows > 0 ? (b.dead / b.rows) * 100 : 0;
        return br2 - ar;
    });
    setHtml('tbodyVacuum', sortedByBloat.map(t => {
        const bloatRatio = t.rows > 0 ? (t.dead / t.rows) * 100 : 0;
        const barColor = bloatRatio > 15 ? 'bg-rose-500' : bloatRatio > 5 ? 'bg-amber-500' : 'bg-emerald-500';
        const vacuumCmd = `VACUUM ANALYZE ${t.schema_name}.${t.name};`;
        return `
        <tr>
            <td class="font-mono text-[10px] text-blue-600 dark:text-[#6cb4ee] font-bold">${t.name}</td>
            <td class="font-mono text-[10px] text-slate-600 dark:text-slate-400">${fmtNum(t.rows)}</td>
            <td class="font-mono text-[10px] ${bloatRatio > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}">${fmtNum(t.dead)}</td>
            <td class="font-mono text-[10px] ${bloatRatio > 15 ? 'text-rose-600 dark:text-rose-400 font-bold' : bloatRatio > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}">${bloatRatio.toFixed(1)}%</td>
            <td style="min-width:120px">
                <div class="progress-bar">
                    <div class="${barColor} vacuum-bar progress-fill" style="width:${Math.min(bloatRatio, 100)}%"></div>
                </div>
            </td>
            <td class="font-mono text-[10px] text-slate-500">${t.last_autovacuum || 'Never'}</td>
            <td>
                ${bloatRatio > 5 ? `<button onclick="navigator.clipboard.writeText('${vacuumCmd}')" class="text-[8px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded hover:bg-amber-500 hover:text-white transition-all font-bold">COPY VACUUM</button>` : '—'}
            </td>
        </tr>`;
    }).join(''));

    setHtml('tbodyBloatMini', sortedByBloat.slice(0, 5).map(t => {
        const bloatRatio = t.rows > 0 ? (t.dead / t.rows) * 100 : 0;
        return `
        <tr>
            <td class="font-mono text-[10px] text-blue-600 dark:text-[#6cb4ee]">${t.name}</td>
            <td class="font-mono text-[10px] text-slate-600 dark:text-slate-400">${fmtNum(t.dead)}</td>
            <td class="font-mono text-[10px] ${bloatRatio > 15 ? 'text-rose-600 dark:text-rose-400 font-bold' : bloatRatio > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-500'}">${bloatRatio.toFixed(1)}%</td>
            <td>${healthBadge(bloatRatio)}</td>
        </tr>`;
    }).join(''));

    // ── 11. Charts ────────────────────────────────────────────────
    const activeCount  = queries.filter(q => q.state === 'active').length;
    const idleTxCount  = queries.filter(q => (q.state || '').includes('idle')).length;
    updateCharts(activeCount, idleTxCount, locksCount, tables);

    // ── 12. Alerts ────────────────────────────────────────────────
    checkAlerts(kpis, queries);
    updateAlertIndicator(kpis, locksCount);

    // ── 13. CONFIG VERİLERİ ───────────────────────────────────────
    const configData = await fetchConfigData(selectedServer, selectedDb);
    if (configData && configData.status === 'success') {
        const settings = configData.settings;
        const configKeys = [
            'shared_buffers', 'effective_cache_size', 'work_mem',
            'maintenance_work_mem', 'random_page_cost', 'effective_io_concurrency',
            'idle_in_transaction_session_timeout', 'statement_timeout',
            'autovacuum_vacuum_scale_factor', 'checkpoint_completion_target',
            'log_min_duration_statement', 'max_connections'
        ];
        
        configKeys.forEach(key => {
            const el = document.getElementById(`conf_${key}`);
            if (el && settings[key] !== undefined) {
                el.innerHTML = `<span class="text-slate-500 dark:text-slate-400">${key} =</span> <span class="text-emerald-600 dark:text-emerald-400 font-bold ml-1">${settings[key]}</span>`;
            }
        });
    }

    // ── 14. EKSİK İNDEKS (MISSING INDEX ADVISOR) ────────────
    const missingIndexCandidates = tables.filter(t => t.seq_scan > 50 && t.seq_tup_read > 50000 && t.seq_tup_read > t.idx_tup_fetch);
    missingIndexCandidates.sort((a, b) => b.seq_tup_read - a.seq_tup_read);

    setHtml('tbodyMissingIndexes', missingIndexCandidates.length === 0
        ? '<tr><td colspan="7" class="text-center py-8 text-slate-500 text-xs">Tebrikler! Tespit edilen ciddi bir eksik indeks yok.</td></tr>'
        : missingIndexCandidates.map(t => {
            return `
            <tr>
                <td class="font-mono text-[10px] text-blue-600 dark:text-blue-400">${t.schema_name}</td>
                <td class="font-mono text-[10px] text-blue-600 dark:text-[#6cb4ee] font-bold">${t.name}</td>
                <td class="font-mono text-[10px] text-slate-600 dark:text-slate-400">${fmtNum(t.rows)}</td>
                <td class="font-mono text-[10px] text-rose-600 dark:text-rose-400 font-bold">${fmtNum(t.seq_scan)}</td>
                <td class="font-mono text-[10px] text-rose-600 dark:text-rose-400">${fmtNum(t.seq_tup_read)}</td>
                <td class="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">${fmtNum(t.idx_scan)}</td>
                <td>
                    <button onclick="window.fetchTableDetails('${t.db_name}','${t.schema_name}','${t.name}')" class="text-[8px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded hover:bg-indigo-500 hover:text-white transition-all font-bold">ANALYZE TABLE</button>
                </td>
            </tr>`;
        }).join('')
    );

    // ── 15. YENİ: ERROR LOGS SESSİZ OTOMATİK YENİLEME ─────────────
    const logSelectEl = document.getElementById('logFileSelect');
    const errorPage = document.getElementById('page-errors');
    
    // Eğer kullanıcı aktif olarak "Error Logs" sekmesindeyse ve bir dosya seçiliyse sessizce yenile
    if (logSelectEl && logSelectEl.value && errorPage && errorPage.classList.contains('active')) {
        window.loadLogContent(logSelectEl.value, true); // true parametresi spineri (Yükleniyor) gizler
    }

    // ── 16. Loader ──
    if (isFirstLoad) { hideLoader(); isFirstLoad = false; }
}

function updateAlertIndicator(kpis, locksCount) {
    const count = ((kpis.deadlocks || 0) > 0 ? 1 : 0) + (locksCount > 0 ? 1 : 0);
    const indicator = document.getElementById('alertIndicator');
    const countEl   = document.getElementById('alertCount');
    if (indicator && countEl) {
        if (count > 0) {
            indicator.classList.remove('hidden');
            countEl.textContent = count;
        } else {
            indicator.classList.add('hidden');
        }
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────
window.onload = async () => {
    try {
        const router = await import('./router.js');
        if (router && typeof router.loadAllViews === 'function') {
            await router.loadAllViews();
        }
    } catch (e) {}

    initUI();
    initCharts();
    
    try {
        const srvData = await fetchServersApi();
        if (srvData.status === 'success' && srvData.servers.length > 0) {
            const selectEl = document.getElementById('serverSelect');
            if (selectEl) {
                selectEl.innerHTML = srvData.servers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
            }
            selectedServer = srvData.servers[0].id;
            setActiveServer(selectedServer);
            
            // İlk sunucu seçildiğinde otomatik olarak log dosyalarını çek
            if (window.loadLogFiles) window.loadLogFiles();
        }
    } catch (e) {
        console.error("Sunucular yüklenemedi:", e);
    }

    await loadDashboard();
    window._loadDashboard = loadDashboard;
    
    const refreshEl = document.getElementById('refreshInterval');
    const interval = refreshEl ? parseInt(refreshEl.value) : 5000;
    if (interval > 0) window._refreshTimer = setInterval(loadDashboard, interval);
};