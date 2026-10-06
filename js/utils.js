// js/utils.js - innerHTML'e basılan veritabanı kaynaklı değerler için kaçış yardımcıları

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Metni HTML içeriği veya attribute değeri olarak güvenle basılabilir hale getirir.
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

// Değeri, onclick="..." gibi inline handler içinde kullanılabilecek bir JS string sabitine çevirir.
export function jsArg(value) {
    return escapeHtml(JSON.stringify(String(value ?? '')));
}
