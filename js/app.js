// js/app.js - Arayüz ve Global Etkileşim Yöneticisi

export function toggleTheme() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
}

// js/app.js içindeki showPage fonksiyonunu bununla değiştir:

export function showPage(name) {
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
        // BUG FIX: Sadece name'i değil, tam fonksiyon çağrısını arıyoruz 
        // Böylece 'queries', 'slowqueries' ile karışmıyor.
        if (onclickAttr && onclickAttr.includes(`('${name}')`)) {
            item.classList.add('active'); 
        }
    });
}

export function closeModal(id) { 
    const modal = document.getElementById(id);
    if(modal) modal.classList.add('hidden'); 
}

export function initModals() {
    // Modal dışına tıklandığında kapanmasını sağlar. 
    // Bu işlem HTML yüklendikten (router çalıştıktan) sonra çağrılmalıdır.
    document.querySelectorAll('[id$="Modal"]').forEach(m => {
        m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
    });
}

export function filterTable(tbodyId, val) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const q = val.toLowerCase();
    tbody.querySelectorAll('tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
}

export let currentFilter = 'all';
window._allQueryRows = []; // Main.js bunu dolduruyor

export function setQueryFilter(type) {
    currentFilter = type;
    document.querySelectorAll('[id^="qf"]').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('qf' + type.charAt(0).toUpperCase() + type.slice(1));
    if(btn) btn.classList.add('active');
    renderQueryRows();
}

export function renderQueryRows() {
    const tbody = document.getElementById('tbodyQueries');
    if (!tbody) return;
    let rows = window._allQueryRows;
    
    if (currentFilter === 'active') rows = rows.filter(r => r.dataset.state === 'active');
    if (currentFilter === 'locked') rows = rows.filter(r => r.dataset.locked === 'true');
    
    tbody.innerHTML = '';
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-500 text-xs">No matching queries</td></tr>';
    } else {
        rows.forEach(r => tbody.appendChild(r.cloneNode(true)));
        // Re-attach onclick
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
}

export function updateGauge(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    const circumference = 2 * Math.PI * 16;
    const filled = (pct / 100) * circumference;
    el.setAttribute('stroke-dasharray', `${filled} ${circumference - filled}`);
}

let refreshTimer = null;
export function changeRefreshInterval() {
    const val = parseInt(document.getElementById('refreshInterval').value);
    if (window._refreshTimer) clearInterval(window._refreshTimer);
    if (val > 0) window._refreshTimer = setInterval(window._loadDashboard, val);
}

// Global olarak HTML'den (onclick="") çağrılabilmesi için window objesine aktarıyoruz:
window.toggleTheme = toggleTheme;
window.showPage = showPage;
window.closeModal = closeModal;
window.filterTable = filterTable;
window.setQueryFilter = setQueryFilter;
window.changeRefreshInterval = changeRefreshInterval;