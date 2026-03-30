// Akıllı API URL Seçici:
// Eğer arayüz VS Code Live Server (5500) veya Python test sunucusu (3000) üzerinden açıldıysa
// API isteklerini otomatik olarak Python arka ucuna (8000) yönlendir.
// Aksi halde (yani .exe olarak çalıştırıldığında) kök dizini ('/api') kullan.
let API_URL = '/api';
if (window.location.port === '5500' || window.location.port === '3000') {
    API_URL = 'http://localhost:8000/api';
}

export async function fetchServersApi() {
    const response = await fetch(`${API_URL}/servers`);
    return await response.json();
}

export async function fetchMonitoringData(serverId, dbName = null) {
    let url = `${API_URL}/monitoring?server=${encodeURIComponent(serverId || '')}`;
    if (dbName) url += `&db=${encodeURIComponent(dbName)}`;
    const response = await fetch(url);
    return await response.json();
}

export async function fetchTableDetailsApi(serverId, db, schema, table) {
    const url = `${API_URL}/table_details?server=${encodeURIComponent(serverId)}&db=${encodeURIComponent(db)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`;
    const response = await fetch(url);
    return await response.json();
}

function sanitizeParameterizedQuery(query) {
    return query.replace(/\$\d+/g, 'NULL');
}

export async function explainQueryApi(serverId, db, query) {
    const cleanQuery = sanitizeParameterizedQuery(query); 
    const response = await fetch(`${API_URL}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: serverId, db, query: cleanQuery })
    });
    return await response.json();
}

export async function fetchConfigData(serverId, dbName = null) {
    let url = `${API_URL}/config?server=${encodeURIComponent(serverId || '')}`;
    if (dbName) url += `&db=${encodeURIComponent(dbName)}`;
    const response = await fetch(url);
    return await response.json();
}

export async function terminateQueryApi(serverId, db, pid) {
    const response = await fetch(`${API_URL}/terminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: serverId, db, pid })
    });
    return await response.json();
}

export async function fetchLogFilesApi(serverId) {
    const response = await fetch(`${API_URL}/logs/files?server=${encodeURIComponent(serverId || '')}`);
    return await response.json();
}

export async function fetchLogContentApi(serverId, filename) {
    const response = await fetch(`${API_URL}/logs/content?server=${encodeURIComponent(serverId || '')}&filename=${encodeURIComponent(filename)}`);
    return await response.json();
}