// js/router.js
const views = ['overview', 'queries', 'slowqueries', 'tables', 'locks', 'vacuum', 'config', 'missingindexes', 'help', 'errors'];

export async function loadAllViews() {
    const container = document.getElementById('main-content');
    if (!container) return; 
    
    for (const view of views) {
        try {
            const response = await fetch(`views/${view}.html`);
            if (!response.ok) throw new Error(`${view} bulunamadı.`);
            const html = await response.text();
            
            const section = document.createElement('div');
            section.id = `page-${view}`;
            section.className = `page-section ${view === 'overview' ? 'active fade-up' : ''}`;
            section.innerHTML = html;
            
            container.appendChild(section);
        } catch (error) {
            console.error(`Görünüm yüklenirken hata oluştu: ${view}`, error);
        }
    }
}