// ============================================================
// PostgreSQL EXPLAIN / EXPLAIN ANALYZE — Gelişmiş Analiz Motoru
// v2.0 — Derinlemesine Parse + Nokta Atışı Çözüm Önerileri
// ============================================================

// ─── Yardımcı: Tüm düğümleri (nodes) recursive parse et ───────────────────────
function parseNodes(planText) {
    const nodes = [];

    // Her satırı ayrı ayrı işle
    const lines = planText.split('\n');
    lines.forEach(line => {
        // Düğüm tipi + tablo adı + maliyet + satır tahmini + satır genişliği
        const nodeMatch = line.match(
            /->?\s*([\w\s]+?)\s+on\s+(\w+)(?:\s+(\w+))?\s+\(cost=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+width=(\d+)\)(?:\s+\(actual time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+loops=(\d+)\))?/i
        );
        if (nodeMatch) {
            nodes.push({
                type:         nodeMatch[1].trim(),
                table:        nodeMatch[2],
                alias:        nodeMatch[3] || null,
                costStart:    parseFloat(nodeMatch[4]),
                costEnd:      parseFloat(nodeMatch[5]),
                estRows:      parseInt(nodeMatch[6]),
                width:        parseInt(nodeMatch[7]),
                actualStart:  nodeMatch[8]  ? parseFloat(nodeMatch[8])  : null,
                actualEnd:    nodeMatch[9]  ? parseFloat(nodeMatch[9])  : null,
                actualRows:   nodeMatch[10] ? parseInt(nodeMatch[10])   : null,
                loops:        nodeMatch[11] ? parseInt(nodeMatch[11])   : null,
                raw:          line
            });
        }

        // JOIN düğümleri (tabloya bağlı olmayan)
        const joinMatch = line.match(
            /->?\s*(Hash Join|Merge Join|Nested Loop|Hash Full Join|Hash Semi Join|Hash Anti Join|Gather Merge|Parallel Seq Scan|Parallel Index Scan|Memoize|Result|Subquery Scan|BitmapAnd|BitmapOr)\s*(?:\(cost=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+width=(\d+)\))?(?:\s+\(actual time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+loops=(\d+)\))?/i
        );
        if (joinMatch && !nodeMatch) {
            nodes.push({
                type:       joinMatch[1].trim(),
                table:      null,
                costStart:  joinMatch[2]  ? parseFloat(joinMatch[2])  : null,
                costEnd:    joinMatch[3]  ? parseFloat(joinMatch[3])  : null,
                estRows:    joinMatch[4]  ? parseInt(joinMatch[4])    : null,
                actualStart:joinMatch[5]  ? parseFloat(joinMatch[5])  : null,
                actualEnd:  joinMatch[6]  ? parseFloat(joinMatch[6])  : null,
                actualRows: joinMatch[7]  ? parseInt(joinMatch[7])    : null,
                loops:      joinMatch[8]  ? parseInt(joinMatch[8])    : null,
                raw:        line
            });
        }
    });
    return nodes;
}

// ─── Yardımcı: Sayıyı güzel formatla ─────────────────────────────────────────
function fmt(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString('tr-TR');
}

// ─── Yardımcı: ms'yi okunabilir yap ──────────────────────────────────────────
function fmtMs(ms) {
    if (ms === null) return '—';
    if (ms >= 60_000) return (ms / 60_000).toFixed(1) + ' dk';
    if (ms >= 1_000)  return (ms / 1_000).toFixed(2) + ' s';
    return ms.toFixed(2) + ' ms';
}

// ─── Tahmin vs Gerçek sapma hesapla ──────────────────────────────────────────
function rowEstimationError(estRows, actualRows) {
    if (!estRows || !actualRows) return null;
    const ratio = actualRows / estRows;
    if (ratio > 1) return { factor: ratio, dir: 'under' };   // planner az tahmin etti
    if (ratio < 1) return { factor: 1 / ratio, dir: 'over' }; // planner çok tahmin etti
    return { factor: 1, dir: 'exact' };
}

// ─── INDEX ÖNERİSİ ÜRET ──────────────────────────────────────────────────────
function suggestIndex(tableName, context) {
    const suggestions = [];
    // Filter koşulu var mı?
    const filterMatch = context.match(/Filter:\s*\((.+?)\)/i);
    if (filterMatch) {
        const cond = filterMatch[1];
        // Kolon adlarını çıkar
        const cols = [...cond.matchAll(/(\w+)\s*(?:=|<|>|<=|>=|~~|LIKE|IN\s*\()/gi)].map(m => m[1]);
        if (cols.length > 0) {
            suggestions.push(`CREATE INDEX CONCURRENTLY idx_${tableName}_${cols.slice(0,2).join('_')} ON ${tableName} (${cols.slice(0,2).join(', ')});`);
        }
    }
    return suggestions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANA FONKSİYON
// ═══════════════════════════════════════════════════════════════════════════════
export function analyzeExplainPlan(planText) {

    // ── 0. Temel metrikleri çek ───────────────────────────────────────────────
    const execTimeMatch = planText.match(/Execution Time:\s+([\d.]+)\s+ms/i);
    const planTimeMatch = planText.match(/Planning Time:\s+([\d.]+)\s+ms/i);
    const execTime  = execTimeMatch ? parseFloat(execTimeMatch[1]) : null;
    const planTime  = planTimeMatch ? parseFloat(planTimeMatch[1]) : null;
    const totalTime = (execTime || 0) + (planTime || 0);
    const isAnalyze = planText.includes('actual time') || planText.includes('Execution Time');

    // ── 1. Düğümleri parse et ─────────────────────────────────────────────────
    const nodes = parseNodes(planText);

    // ── 2. En pahalı düğümü bul ───────────────────────────────────────────────
    let maxCostNode = null;
    nodes.forEach(n => {
        if (n.costEnd !== null && (!maxCostNode || n.costEnd > maxCostNode.costEnd)) {
            maxCostNode = n;
        }
    });

    // ── 3. Toplam maliyet ─────────────────────────────────────────────────────
    const topCostMatch = planText.match(/^\s*(?:->)?\s*\w[\w\s]*?\s+\(cost=[\d.]+\.\.([\d.]+)/m);
    const totalCost = topCostMatch ? parseFloat(topCostMatch[1]) : null;

    // Koleksiyon
    const warnings  = [];   // { level: 'critical'|'warning'|'info', title, desc, fix }
    const insights  = [];   // string (HTML)
    const sqlFixes  = [];   // hazır SQL snippet'leri

    // ════════════════════════════════════════════════════════════════
    // A. PARAMETRE / GENERIC PLAN
    // ════════════════════════════════════════════════════════════════
    if (planText.includes('parameterized') || planText.includes('Generic Plan')) {
        insights.push(`ℹ️ <b>Generic Plan:</b> Bu sorgu parametreli ($1, $2…) çalıştığı için Postgres <i>genel</i> bir yürütme planı oluşturdu. Gerçek parametre değerleriyle <code>EXPLAIN (ANALYZE, BUFFERS)</code> çalıştırırsanız çok daha isabetli bir analiz elde edersiniz.`);
    }

    // ════════════════════════════════════════════════════════════════
    // B. TAM TABLO TARAMALARI (Sequential Scan)
    // ════════════════════════════════════════════════════════════════
    const seqScanRegex = /Seq Scan on (\w+)(?:\s+(\w+))?\s+\(cost=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+width=(\d+)\)(?:\s+\(actual time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+loops=(\d+)\))?/gi;
    let seqMatch;
    while ((seqMatch = seqScanRegex.exec(planText)) !== null) {
        const tbl      = seqMatch[1];
        const alias    = seqMatch[2];
        const costEnd  = parseFloat(seqMatch[4]);
        const estRows  = parseInt(seqMatch[5]);
        const actRows  = seqMatch[9]  ? parseInt(seqMatch[9])  : null;
        const actTime  = seqMatch[8]  ? parseFloat(seqMatch[8]) : null;
        const loops    = seqMatch[10] ? parseInt(seqMatch[10]) : 1;

        // Context: o tabloya ait Filter satırı
        const contextLines = planText.split('\n').filter(l => l.includes(tbl)).join('\n');
        const idxSuggestions = suggestIndex(tbl, contextLines);

        // Rows removed by filter
        const removedMatch = planText.match(new RegExp(`Rows Removed by Filter:\\s+(\\d+)`, 'i'));
        const removedRows  = removedMatch ? parseInt(removedMatch[1]) : null;

        if (estRows < 100 && !actRows) {
            insights.push(`<b>${tbl}</b>: Tahmini satır sayısı (${fmt(estRows)}) çok düşük, Postgres indeks yerine Seq Scan yapmayı tercih etti — bu beklenilen, doğru bir karar.`);
        } else {
            const severity = costEnd > 50_000 || (actTime && actTime > 200) ? 'critical' : 'warning';
            let desc = `<b>${tbl}</b> tablosunda <b>${fmt(actRows ?? estRows)}</b> satır baştan sona okunuyor (maliyet: <code>${costEnd.toLocaleString()}</code>)`;
            if (actTime)  desc += `, işlem <b>${fmtMs(actTime * (loops || 1))}</b> sürdü`;
            if (removedRows) desc += `. <b>${fmt(removedRows)}</b> satır filtre sonrası elendi — yani satırların büyük çoğunluğu boşa okundu`;
            desc += '.';

            let fix = `WHERE / JOIN koşullarınızla eşleşen kolonlara indeks ekleyin:`;
            if (idxSuggestions.length > 0) {
                fix += `<br/><code class="sql-snippet">${idxSuggestions[0]}</code>`;
                sqlFixes.push(idxSuggestions[0]);
            } else {
                fix += `<br/><code class="sql-snippet">CREATE INDEX CONCURRENTLY idx_${tbl}_&lt;kolon&gt; ON ${tbl} (&lt;filtre_kolonu&gt;);</code>`;
            }
            if (removedRows && removedRows > (actRows || estRows) * 5) {
                fix += `<br/>Partial index de değerlendirin: <code class="sql-snippet">CREATE INDEX … WHERE aktif = true;</code>`;
            }

            warnings.push({ level: severity, title: `Seq Scan: ${tbl}`, desc, fix });
        }
    }

    // ════════════════════════════════════════════════════════════════
    // C. INDEX KULLANIMLARI
    // ════════════════════════════════════════════════════════════════
    const idxRegex = /Index(?: Only)? Scan(?:\s+Backward)? using (\w+) on (\w+)(?:\s+\w+)?\s+\(cost=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+width=(\d+)\)(?:\s+\(actual time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+loops=(\d+)\))?/gi;
    let idxMatch;
    const usedIndexes = [];
    while ((idxMatch = idxRegex.exec(planText)) !== null) {
        usedIndexes.push({
            index:    idxMatch[1],
            table:    idxMatch[2],
            estRows:  parseInt(idxMatch[5]),
            actRows:  idxMatch[9] ? parseInt(idxMatch[9]) : null,
            loops:    idxMatch[10] ? parseInt(idxMatch[10]) : 1,
            isOnly:   idxMatch[0].includes('Only')
        });
    }
    if (usedIndexes.length > 0) {
        let txt = `Aşağıdaki tablolarda indeksler aktif olarak kullanılıyor:<br/>`;
        usedIndexes.forEach(i => {
            txt += `• <b>${i.table}</b> → <code>${i.index}</code>`;
            if (i.actRows !== null) txt += ` (gerçek: ${fmt(i.actRows)} satır, ${i.loops}× döngü)`;
            if (i.isOnly)  txt += ` <span class="badge-gold">Index Only</span>`;
            txt += `<br/>`;
        });
        if (usedIndexes.some(i => i.isOnly)) {
            txt += `<br/>🌟 <b>Index Only Scan</b>: Postgres tabloya hiç gitmeden, verinin tamamını indeks üzerinden okudu. Heap I/O = 0. Bu en iyi senaryo.`;
        }
        insights.push(txt);
    }

    // ════════════════════════════════════════════════════════════════
    // D. BİTMAP INDEX SCAN (Bitmap Heap + Bitmap Index)
    // ════════════════════════════════════════════════════════════════
    if (planText.includes('Bitmap Heap Scan')) {
        const bitmapTbls = [...planText.matchAll(/Bitmap Heap Scan on (\w+)/gi)].map(m => m[1]);
        const rechecks   = (planText.match(/Recheck Cond/gi) || []).length;
        const lossy      = planText.includes('Lossy');

        let txt = `<b>Bitmap Scan</b> kullanılıyor (${bitmapTbls.join(', ')}). Bu, tek bir koşulda yüksek sayıda satırı döndürürken indeks + heap erişimini dengeleyen akıllıca bir strateji.`;
        if (lossy) {
            txt += `<br/>⚠️ <b>Lossy Bitmap:</b> <code>work_mem</code> yetersiz kaldığı için bitmap'ler sıkıştırıldı ve Recheck (yeniden kontrol) zorunlu oldu. <code>SET work_mem = '64MB'</code> ile test edin.`;
            warnings.push({
                level: 'warning',
                title: 'Lossy Bitmap — work_mem Yetersiz',
                desc: `Bitmap sayfa haritası RAM'e sığmadı. Recheck koşulu devreye girdi, bu ek CPU ve I/O demektir.`,
                fix: `<code class="sql-snippet">SET work_mem = '64MB';</code> — Sadece bu oturum için geçerli olur, global için <code>postgresql.conf</code> dosyasını düzenleyin.`
            });
        }
        insights.push(txt);
    }

    // ════════════════════════════════════════════════════════════════
    // E. ROW ESTİMATION HATASI (Planner Yanılgısı)
    // ════════════════════════════════════════════════════════════════
    nodes.forEach(n => {
        if (n.estRows && n.actualRows) {
            const err = rowEstimationError(n.estRows, n.actualRows);
            if (err && err.factor >= 10) {
                const dir = err.dir === 'under' ? 'az' : 'çok';
                warnings.push({
                    level: err.factor >= 100 ? 'critical' : 'warning',
                    title: `Planner Yanılgısı: ${n.table || n.type}`,
                    desc: `Postgres <b>${fmt(n.estRows)}</b> satır geleceğini tahmin etti, gerçekte <b>${fmt(n.actualRows)}</b> satır geldi — planner <b>${err.factor.toFixed(0)}×</b> ${dir} tahmin yaptı. Bu yüzden yanlış bir join/scan stratejisi seçmiş olabilir.`,
                    fix: `İstatistikleri güncelleyin: <code class="sql-snippet">ANALYZE ${n.table || ''} VERBOSE;</code><br/>Eğer sapma devam ederse <code>default_statistics_target</code> değerini artırın: <code class="sql-snippet">ALTER TABLE ${n.table || '&lt;tablo&gt;'} ALTER COLUMN &lt;kolon&gt; SET STATISTICS 500;</code>`
                });
            }
        }
    });

    // ════════════════════════════════════════════════════════════════
    // F. JOIN MİMARİLERİ
    // ════════════════════════════════════════════════════════════════

    // Hash Join
    const hashJoinMatches = [...planText.matchAll(/Hash Join.*?\(cost=([\d.]+)\.\.([\d.]+).*?\)(?:.*?\(actual time=([\d.]+)\.\.([\d.]+).*?rows=(\d+).*?loops=(\d+)\))?/gi)];
    hashJoinMatches.forEach(m => {
        const actTime = m[4] ? parseFloat(m[4]) : null;
        const loops   = m[6] ? parseInt(m[6])   : 1;
        if (actTime && actTime * loops > 100) {
            warnings.push({
                level: 'warning',
                title: 'Hash Join Yavaş',
                desc: `Hash Join ${fmtMs(actTime * loops)} sürdü. Hash tablosunun RAM'e sığıp sığmadığını kontrol edin.`,
                fix: `<code class="sql-snippet">EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) &lt;sorgunuz&gt;;</code> çıktısında <code>Batches</code> değeri 1'den büyükse hash tablosu diske taştı — <code>work_mem</code>'i artırın.`
            });
        }
    });

    // Nested Loop
    const nlRegex = /Nested Loop.*?\(cost=([\d.]+)\.\.([\d.]+).*?\)(?:.*?\(actual time=([\d.]+)\.\.([\d.]+).*?rows=(\d+).*?loops=(\d+)\))?/gi;
    let nlMatch;
    while ((nlMatch = nlRegex.exec(planText)) !== null) {
        const actTime  = nlMatch[4] ? parseFloat(nlMatch[4]) : null;
        const loops    = nlMatch[6] ? parseInt(nlMatch[6])   : 1;
        const estRows  = nlMatch[5] ? parseInt(nlMatch[5])   : null;
        const totalMs  = actTime ? actTime * loops : null;

        if (loops > 1000 || (totalMs && totalMs > 500)) {
            warnings.push({
                level: loops > 10_000 ? 'critical' : 'warning',
                title: `Nested Loop — ${fmt(loops)} döngü`,
                desc: `Sorgunuzda iç içe döngü (Nested Loop) <b>${fmt(loops)} kez</b> çalıştı${totalMs ? ` (toplam ~${fmtMs(totalMs)})` : ''}. Bu yapı, dış kümenin her satırı için iç tabloyu sıfırdan arar.`,
                fix: `JOIN yapılan tüm kolonlarda indeks olduğunu doğrulayın.<br/>Çok büyük veri setleri için Postgres'i Hash Join'a zorlamak mümkündür:<br/><code class="sql-snippet">SET enable_nestloop = off; -- Sadece test için!</code>`
            });
        } else if (loops > 100) {
            insights.push(`Nested Loop <b>${fmt(loops)}</b> kez döndü ama hızlı görünüyor. JOIN kolonlarında indeks var, bu iyi.`);
        }
    }

    // Merge Join
    if (planText.includes('Merge Join')) {
        insights.push(`<b>Merge Join</b> kullanılmış. Bu join tipi, her iki tarafın da sıralı (indexed veya önceden Sort edilmiş) olmasını gerektirir — Postgres'in doğru seçim yaptığı, büyük ve sıralı veri setleri için verimli bir stratejidir.`);
    }

    // Hash Full Join
    if (planText.match(/Hash Full Join/i)) {
        warnings.push({
            level: 'warning',
            title: 'Hash Full Join',
            desc: "FULL OUTER JOIN her iki taraftaki eşleşmeyen satırları da getiriyor. Bu çok ağır bir işlemdir.",
            fix: "Gerçekten her iki taraftaki NULL'lara ihtiyacınız var mı? Yoksa <code>INNER JOIN</code> veya <code>LEFT JOIN</code>'e çevirin."
        });
    }

    // Anti Join / Semi Join
    if (planText.match(/Hash Anti Join|Merge Anti Join/i)) {
        insights.push(`<b>Anti Join</b> tespit edildi. Bu genellikle <code>NOT IN</code> veya <code>NOT EXISTS</code> ifadesinin optimize edilmiş halidir — iyi bir işarettir.`);
    }

    // ════════════════════════════════════════════════════════════════
    // G. SORT / DISK SORT / INCREMENTAL SORT
    // ════════════════════════════════════════════════════════════════
    if (planText.match(/Sort Method:.*disk/i)) {
        const spaceMatch = planText.match(/Disk:\s+(\d+kB)/i);
        warnings.push({
            level: 'critical',
            title: '🚨 Disk Sort — work_mem Yetersiz',
            desc: `ORDER BY / GROUP BY işlemi sunucu RAM'ine sığmadı ve diske yazıldı${spaceMatch ? ` (${spaceMatch[1]})` : ''}. SSD olsa bile disk I/O, RAM'e kıyasla 10–100× yavaştır.`,
            fix: `<code class="sql-snippet">SET work_mem = '256MB'; -- Bu oturum için</code><br/>Kalıcı çözüm için: <code>ALTER SYSTEM SET work_mem = '64MB';</code> (dikkatli olun, bu ayar tüm bağlantılar için geçerlidir, yüksek concurrency'de OOM riski var)`
        });
    } else if (planText.match(/Sort Method:\s+quicksort/i)) {
        const memMatch = planText.match(/Memory:\s+(\d+kB)/i);
        insights.push(`Sıralama (ORDER BY) RAM'de (quicksort) tamamlandı${memMatch ? ` — ${memMatch[1]} kullandı` : ''}. Diske inmedi, sağlıklı.`);
    }

    if (planText.includes('Incremental Sort')) {
        const keysMatch = planText.match(/Presorted Key:\s+(.+)/i);
        insights.push(`🚀 <b>Incremental Sort</b> (Postgres 13+): Önceden sıralı kolonlar üzerinden sadece değişen kısım sıralandı${keysMatch ? ` (<code>${keysMatch[1]}</code> presorted)` : ''}. Büyük bir CPU tasarrufu.`);
    }

    // ════════════════════════════════════════════════════════════════
    // H. BELLEK / CACHE (Buffers)
    // ════════════════════════════════════════════════════════════════
    const bufMatch = planText.match(/Buffers:\s+shared hit=(\d+)(?:\s+read=(\d+))?(?:\s+dirtied=(\d+))?(?:\s+written=(\d+))?/i);
    if (bufMatch) {
        const hits      = parseInt(bufMatch[1]);
        const reads     = parseInt(bufMatch[2] || '0');
        const dirtied   = parseInt(bufMatch[3] || '0');
        const written   = parseInt(bufMatch[4] || '0');
        const totalBufs = hits + reads;

        if (reads === 0) {
            insights.push(`<b>Cache %100:</b> Tüm ${fmt(hits)} blok doğrudan RAM'den (shared_buffers) okundu. Disk I/O = 0. Mükemmel.`);
        } else {
            const hitRatio = ((hits / totalBufs) * 100).toFixed(1);
            const level    = parseFloat(hitRatio) < 80 ? 'critical' : parseFloat(hitRatio) < 90 ? 'warning' : null;
            if (level) {
                warnings.push({
                    level,
                    title: `Düşük Cache Hit Ratio: %${hitRatio}`,
                    desc: `${fmt(reads)} blok diskten okundu (toplam ${fmt(totalBufs)} bloktan ${fmt(hits)}'i cache'den geldi). Disk okumaları sorguyu yavaşlatıyor.`,
                    fix: `<code>shared_buffers</code> değerini artırın (önerilen: toplam RAM'in %25'i):<br/><code class="sql-snippet">ALTER SYSTEM SET shared_buffers = '4GB'; SELECT pg_reload_conf();</code>`
                });
            } else {
                insights.push(`Cache hit oranı %${hitRatio} — kabul edilebilir seviyede. ${fmt(reads)} blok diskten okundu.`);
            }
        }

        if (dirtied > 1000) {
            warnings.push({
                level: 'warning',
                title: `Yüksek Dirty Buffer: ${fmt(dirtied)} blok`,
                desc: 'Sorgu çok sayıda sayfayı kirli (modified) bıraktı. Yüksek write yükü var.',
                fix: `<code>checkpoint_completion_target</code> ve <code>bgwriter_lru_maxpages</code> ayarlarını gözden geçirin.`
            });
        }
    }

    // ════════════════════════════════════════════════════════════════
    // I. PARALLEL QUERY
    // ════════════════════════════════════════════════════════════════
    const gatherMatch = planText.match(/Gather(?:\s+Merge)?\s+\(cost[\s\S]+?Workers Planned:\s+(\d+)(?:[\s\S]+?Workers Launched:\s+(\d+))?/i);
    if (gatherMatch) {
        const planned  = parseInt(gatherMatch[1]);
        const launched = gatherMatch[2] ? parseInt(gatherMatch[2]) : null;

        if (launched !== null && launched < planned) {
            warnings.push({
                level: 'warning',
                title: `Paralel Worker Eksik: ${launched}/${planned} başlatıldı`,
                desc: `Postgres ${planned} paralel worker planladı ama sadece ${launched} tanesini başlatabildı. Büyük olasılıkla <code>max_worker_processes</code> veya <code>max_parallel_workers</code> limiti aşıldı.`,
                fix: `<code class="sql-snippet">SHOW max_parallel_workers_per_gather;\nALTER SYSTEM SET max_parallel_workers_per_gather = 4;</code>`
            });
        } else {
            insights.push(`<b>Paralel Sorgu:</b> ${planned} worker başarıyla kullanıldı. Büyük tablo taraması çok çekirdekli olarak yürütüldü.`);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // J. MEMOIZE (Postgres 14+)
    // ════════════════════════════════════════════════════════════════
    if (planText.includes('Memoize')) {
        const hitMatch  = planText.match(/Cache Hits:\s+(\d+)/i);
        const missMatch = planText.match(/Cache Misses:\s+(\d+)/i);
        const evictMatch= planText.match(/Cache Evictions:\s+(\d+)/i);

        if (hitMatch && missMatch) {
            const hits   = parseInt(hitMatch[1]);
            const misses = parseInt(missMatch[1]);
            const evicts = evictMatch ? parseInt(evictMatch[1]) : 0;
            const ratio  = ((hits / (hits + misses)) * 100).toFixed(1);

            if (parseFloat(ratio) > 80) {
                insights.push(`🎯 <b>Memoize (Postgres 14+):</b> Cache hit oranı %${ratio} — tekrarlayan parametreli alt sorgular önbellekten yanıtlanıyor, harika.`);
            } else {
                warnings.push({
                    level: 'info',
                    title: `Memoize Cache Hit Düşük: %${ratio}`,
                    desc: `${fmt(misses)} miss vs ${fmt(hits)} hit. Cache yeterince verimli değil${evicts > 0 ? `, ${fmt(evicts)} eviction da var` : ''}.`,
                    fix: `Memoize'ı devre dışı bırakmak net fayda sağlayabilir: <code class="sql-snippet">SET enable_memoize = off;</code> ve planı karşılaştırın.`
                });
            }
        }
    }

    // ════════════════════════════════════════════════════════════════
    // K. CTEs (Common Table Expressions)
    // ════════════════════════════════════════════════════════════════
    const cteMatch = planText.match(/CTE\s+(\w+)/gi);
    if (cteMatch) {
        const cteNames = [...new Set(cteMatch.map(c => c.replace(/CTE\s+/i, '')))];
        if (planText.includes('CTE Scan')) {
            warnings.push({
                level: 'warning',
                title: `CTE Optimization Fence: ${cteNames.join(', ')}`,
                desc: `Postgres 11 ve öncesinde WITH (CTE) sorguları optimization fence oluşturur — planner CTE'yi ayrı bir sorgu gibi işler ve join'lara katamaz. Postgres 12+'de bu varsayılan olarak düzeldi (inlined CTE).`,
                fix: `Postgres 12+: CTE'leriniz varsayılan olarak inline edilir.<br/>Postgres 11 ve altı için CTE'yi alt sorguya (subquery) çevirin:<br/><code class="sql-snippet">SELECT … FROM (SELECT … FROM tablo WHERE …) AS cte_alias …</code>`
            });
        } else {
            insights.push(`CTE <b>${cteNames.join(', ')}</b> tespit edildi ve inline edilmiş (Postgres 12+ davranışı) — optimizer tam kontrole sahip.`);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // L. WINDOW / AGGREGATE FONKSİYONLARI
    // ════════════════════════════════════════════════════════════════
    if (planText.includes('WindowAgg')) {
        insights.push(`<b>Pencere Fonksiyonu (WindowAgg):</b> <code>OVER (PARTITION BY…)</code> / <code>RANK()</code> / <code>LAG()</code> gibi analitik fonksiyonlar kullanılmış. Her zaman bir Sort aşaması gerektirir — PARTITION BY kolonunda indeks sorgu planını geliştirebilir.`);
    }

    if (planText.includes('HashAggregate')) {
        const batchMatch = planText.match(/Batches:\s+(\d+)/i);
        if (batchMatch && parseInt(batchMatch[1]) > 1) {
            warnings.push({
                level: 'warning',
                title: `HashAggregate Diske Taştı (${batchMatch[1]} batch)`,
                desc: `GROUP BY / aggregate işlemi için oluşturulan hash tablosu RAM'e sığmadı, ${batchMatch[1]} batch'e bölündü.`,
                fix: `<code class="sql-snippet">SET work_mem = '128MB';</code>`
            });
        }
    }

    // ════════════════════════════════════════════════════════════════
    // M. COĞRAFİ / UZAMSAL SORGULAR
    // ════════════════════════════════════════════════════════════════
    if (/gist|st_dwithin|st_intersects|st_within|geography|geometry/i.test(planText)) {
        insights.push(`📍 <b>Spatial Sorgu (PostGIS):</b> Geometri/coğrafya işlemleri tespit edildi. <code>GIST</code> indeksi olmadan <code>ST_DWithin</code>, <code>&&</code> operatörü ve benzerleri tam tarama yapar:<br/><code class="sql-snippet">CREATE INDEX CONCURRENTLY idx_tablo_geom ON tablo USING GIST (geom_kolonu);</code>`);
    }

    // ════════════════════════════════════════════════════════════════
    // N. PLANNING TIME YÜKSEK MI?
    // ════════════════════════════════════════════════════════════════
    if (planTime && execTime && planTime > execTime * 0.5 && planTime > 10) {
        warnings.push({
            level: 'info',
            title: `Planning Time Yüksek: ${fmtMs(planTime)}`,
            desc: `Sorguyu planlamak, çalıştırmaktan ${(planTime / execTime).toFixed(1)}× daha uzun sürdü. Çok fazla JOIN veya alt sorgu planner'ı zorluyor olabilir.`,
            fix: `Prepared statement kullanarak planı önbelleğe alın:<br/><code class="sql-snippet">PREPARE my_query(int) AS SELECT … WHERE id = $1;\nEXECUTE my_query(42);</code>`
        });
    }

    // ════════════════════════════════════════════════════════════════
    // O. JIT COMPILATION
    // ════════════════════════════════════════════════════════════════
    const jitMatch = planText.match(/JIT[\s\S]*?Functions:\s+(\d+)[\s\S]*?Timing:\s+([\d.]+)/i);
    if (jitMatch) {
        const jitTime = parseFloat(jitMatch[2]);
        if (jitTime > 50) {
            warnings.push({
                level: 'info',
                title: `JIT Derleme Süresi: ${fmtMs(jitTime)}`,
                desc: `Postgres JIT (Just-In-Time) derlemesi ${fmtMs(jitTime)} sürdü. Kısa süreli sorgularda JIT overhead, kazancından fazla olabilir.`,
                fix: `<code class="sql-snippet">SET jit = off; -- Bu oturum için devre dışı bırak ve karşılaştır</code>`
            });
        } else {
            insights.push(`JIT derleme aktif ve hızlı (${fmtMs(jitTime)}) — hesap yoğun (aggregate, window) sorgularda CPU tasarrufu sağlıyor.`);
        }
    }

    // ════════════════════════════════════════════════════════════════
    // P. GENEL SAĞLIK SKORU (0-100)
    // ════════════════════════════════════════════════════════════════
    let score = 100;
    warnings.forEach(w => {
        if (w.level === 'critical') score -= 25;
        else if (w.level === 'warning') score -= 10;
        else if (w.level === 'info') score -= 3;
    });
    score = Math.max(0, score);

    // ════════════════════════════════════════════════════════════════
    // HTML OLUŞTURMA
    // ════════════════════════════════════════════════════════════════

    const isAnalyzeMode = execTime !== null;

    // Renk paleti
    const scoreColor =
        score >= 80 ? 'emerald' :
        score >= 50 ? 'amber'   : 'rose';
    const timeColor =
        totalTime > 2000 ? 'rose' :
        totalTime > 500  ? 'amber' : 'emerald';

    let html = ``;

    // ── ÜST METRİK KARTLARI ────────────────────────────────────────
    html += `<div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">`;

    // Skor
    html += metricCard({
        color: scoreColor,
        icon: scoreIcon(score),
        label: 'Sağlık Skoru',
        value: `${score}/100`,
        sub: score >= 80 ? 'Optimize' : score >= 50 ? 'İyileştir' : 'Kritik'
    });

    // Toplam Süre
    if (isAnalyzeMode) {
        html += metricCard({
            color: timeColor,
            icon: clockIcon(),
            label: 'Toplam Süre',
            value: fmtMs(totalTime),
            sub: `Exec: ${fmtMs(execTime)} | Plan: ${fmtMs(planTime)}`
        });
    }

    // Maliyet
    if (totalCost) {
        html += metricCard({
            color: totalCost > 100_000 ? 'rose' : totalCost > 10_000 ? 'amber' : 'slate',
            icon: costIcon(),
            label: 'Tahmini Maliyet',
            value: fmt(totalCost),
            sub: 'Postgres planner birimi'
        });
    }

    // Uyarı sayısı
    const critCount = warnings.filter(w => w.level === 'critical').length;
    const warnCount = warnings.filter(w => w.level === 'warning').length;
    html += metricCard({
        color: critCount > 0 ? 'rose' : warnCount > 0 ? 'amber' : 'emerald',
        icon: alertIcon(),
        label: 'Bulgular',
        value: `${critCount + warnCount}`,
        sub: `${critCount} kritik, ${warnCount} uyarı`
    });

    html += `</div>`;

    // ── UYARILAR ───────────────────────────────────────────────────
    if (warnings.length > 0) {
        html += sectionHeader('Müdahale Gerektiren Noktalar', 'rose');

        warnings.forEach(w => {
            const color = w.level === 'critical' ? 'rose' : w.level === 'warning' ? 'amber' : 'sky';
            const icon  = w.level === 'critical' ? dangerIcon() : w.level === 'warning' ? warnIcon() : infoIcon();
            html += `
            <div class="mb-2 p-3 bg-${color}-50/70 dark:bg-${color}-900/10 border border-${color}-200 dark:border-${color}-800/40 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <div class="flex gap-3 items-start">
                    <span class="mt-0.5 shrink-0">${icon}</span>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-bold text-${color}-800 dark:text-${color}-300 mb-1">${w.title}</p>
                        <p class="text-[11px] leading-relaxed text-slate-700 dark:text-slate-400 mb-2">${w.desc}</p>
                        ${w.fix ? `
                        <div class="mt-2 pt-2 border-t border-${color}-200 dark:border-${color}-800/30">
                            <p class="text-[10px] font-bold text-${color}-700 dark:text-${color}-400 uppercase tracking-wider mb-1">✦ Çözüm Önerisi</p>
                            <div class="text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">${w.fix}</div>
                        </div>` : ''}
                    </div>
                </div>
            </div>`;
        });
    }

    // ── İYİ BULGULAR ──────────────────────────────────────────────
    if (insights.length > 0) {
        html += sectionHeader('Başarılı Mimariler & Detaylar', 'emerald');
        html += `<div class="grid grid-cols-1 gap-2">`;
        insights.forEach(i => {
            html += `
            <div class="p-3 bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200/70 dark:border-emerald-800/30 rounded-xl flex items-start gap-2.5 shadow-sm">
                <svg class="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                </svg>
                <p class="text-[11px] text-slate-700 dark:text-slate-400 leading-relaxed">${i}</p>
            </div>`;
        });
        html += `</div>`;
    }

    // ── SQL FIX SNIPPET'LERİ ───────────────────────────────────────
    if (sqlFixes.length > 0) {
        html += sectionHeader('Hazır SQL Düzeltme Önerileri', 'violet');
        html += `<div class="bg-slate-900 dark:bg-slate-950 rounded-xl p-3 font-mono text-[11px] text-emerald-400 leading-relaxed shadow-inner">`;
        sqlFixes.forEach(s => {
            html += `<div class="mb-1 last:mb-0">-- Önerilen<br/>${s}</div>`;
        });
        html += `</div>`;
    }

    // ── BOŞ DURUM ─────────────────────────────────────────────────
    if (warnings.length === 0 && insights.length === 0) {
        html += `
        <div class="mt-4 p-5 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl">
            <div class="text-2xl mb-2">⚡</div>
            <p class="text-sm font-semibold text-slate-600 dark:text-slate-400">Plan ayrıştırılamadı veya sorgu son derece basit.</p>
            <p class="text-[11px] text-slate-400 mt-1">Daha detaylı analiz için <code>EXPLAIN (ANALYZE, BUFFERS, VERBOSE)</code> çıktısını yapıştırın.</p>
        </div>`;
    }

    return html;
}

// ═══════════════════════════════════════════════════════════════════
// YARDIMCI HTML BİLEŞENLERİ
// ═══════════════════════════════════════════════════════════════════

function metricCard({ color, icon, label, value, sub }) {
    return `
    <div class="bg-${color}-50/50 dark:bg-${color}-900/10 border border-${color}-200 dark:border-${color}-800/40 rounded-xl p-3 flex items-center gap-3 shadow-sm">
        <div class="p-2 bg-${color}-100 dark:bg-${color}-900/50 rounded-lg text-${color}-600 dark:text-${color}-400 shrink-0">${icon}</div>
        <div class="min-w-0">
            <p class="text-[9px] text-slate-500 uppercase font-bold tracking-wider truncate">${label}</p>
            <p class="text-base font-mono font-bold text-${color}-700 dark:text-${color}-400 leading-tight">${value}</p>
            ${sub ? `<p class="text-[9px] text-slate-400 font-mono truncate">${sub}</p>` : ''}
        </div>
    </div>`;
}

function sectionHeader(title, color = 'slate') {
    const dot = color === 'rose' ? 'bg-rose-500 animate-pulse' :
                color === 'emerald' ? 'bg-emerald-500' :
                color === 'violet' ? 'bg-violet-500' : 'bg-slate-400';
    return `
    <h4 class="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest mb-2 mt-5 flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-700 pb-1.5">
        <span class="w-2 h-2 rounded-full ${dot} shrink-0"></span>
        ${title}
    </h4>`;
}

// ─── İkon setleri (inline SVG) ────────────────────────────────────
const _icon = (path, cls='w-5 h-5') => `<svg class="${cls}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${path}"/></svg>`;

function scoreIcon(s) {
    return s >= 80
        ? _icon('M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z')
        : s >= 50
        ? _icon('M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z')
        : _icon('M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z');
}
function clockIcon()  { return _icon('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'); }
function costIcon()   { return _icon('M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'); }
function alertIcon()  { return _icon('M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9'); }
function dangerIcon() { return `<svg class="w-5 h-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`; }
function warnIcon()   { return `<svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`; }
function infoIcon()   { return `<svg class="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`; }