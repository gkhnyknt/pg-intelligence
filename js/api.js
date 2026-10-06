// Akıllı API URL Seçici:
// Eğer arayüz VS Code Live Server (5500) veya Python test sunucusu (3000) üzerinden açıldıysa
// API isteklerini otomatik olarak Python arka ucuna (8000) yönlendir.
// Aksi halde (yani .exe olarak çalıştırıldığında) kök dizini ('/api') kullan.
let API_URL = '/api';
if (window.location.port === '5500' || window.location.port === '3000') {
    API_URL = `http://${window.location.hostname}:8000/api`;
}

// Oturum çerezini her istekte gönderir; oturum yoksa (401) giriş sayfasına yönlendirir.
async function apiFetch(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, { credentials: 'include', ...options });
    if (response.status === 401) {
        window.location.href = 'login.html';
        throw new Error('Oturum açılmamış.');
    }
    return await response.json();
}

function postJson(body) {
    return {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

export async function loginApi(username, password) {
    const response = await fetch(`${API_URL}/login`, { credentials: 'include', ...postJson({ username, password }) });
    return response.ok;
}

export async function logoutApi() {
    await fetch(`${API_URL}/logout`, { credentials: 'include', method: 'POST' });
}

export async function fetchMeApi() {
    return await apiFetch('/me');
}

export async function fetchServersApi() {
    return await apiFetch('/servers');
}

export async function fetchMonitoringData(serverId, dbName = null) {
    let path = `/monitoring?server=${encodeURIComponent(serverId || '')}`;
    if (dbName) path += `&db=${encodeURIComponent(dbName)}`;
    return await apiFetch(path);
}

export async function fetchTableDetailsApi(serverId, db, schema, table) {
    return await apiFetch(`/table_details?server=${encodeURIComponent(serverId)}&db=${encodeURIComponent(db)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`);
}

function sanitizeParameterizedQuery(query) {
    return query.replace(/\$\d+/g, 'NULL');
}

export async function explainQueryApi(serverId, db, query) {
    const cleanQuery = sanitizeParameterizedQuery(query);
    return await apiFetch('/explain', postJson({ server: serverId, db, query: cleanQuery }));
}

export async function fetchConfigData(serverId, dbName = null) {
    let path = `/config?server=${encodeURIComponent(serverId || '')}`;
    if (dbName) path += `&db=${encodeURIComponent(dbName)}`;
    return await apiFetch(path);
}

export async function terminateQueryApi(serverId, db, pid) {
    return await apiFetch('/terminate', postJson({ server: serverId, db, pid }));
}

export async function fetchLogFilesApi(serverId) {
    return await apiFetch(`/logs/files?server=${encodeURIComponent(serverId || '')}`);
}

export async function fetchLogContentApi(serverId, filename) {
    return await apiFetch(`/logs/content?server=${encodeURIComponent(serverId || '')}&filename=${encodeURIComponent(filename)}`);
}
