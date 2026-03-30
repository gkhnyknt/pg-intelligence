# PG Intelligence — Database Control Center 🚀

**PG Intelligence**, PostgreSQL veritabanlarınızı tek bir merkezden izlemenizi, analiz etmenizi ve yönetmenizi sağlayan modern, hızlı ve profesyonel bir veritabanı kontrol panelidir. 

Python (FastAPI) arka ucu ve tamamen Vanilla JS + TailwindCSS kullanılarak geliştirilmiş, modüler ve hafif bir mimariye sahiptir.

---

## ✨ Temel Özellikler

- 🌍 **Çoklu Sunucu Desteği:** Tek bir `.env` dosyası üzerinden sınırsız sayıda PostgreSQL sunucusunu bağlayın ve arayüzden anında geçiş yapın.
- ⚡ **Canlı Sorgu İzleme & Müdahale:** Veritabanındaki aktif/bekleyen sorguları anlık izleyin. Sistemi kilitleyen sorunlu sorguları tek tıkla **Terminate (Sonlandır)** edin.
- 🐢 **Yavaş Sorgu Analizi:** `pg_stat_statements` entegrasyonu ile kronik yavaş sorguları tespit edin ve maliyetlerini görün.
- 🧠 **Missing Index Advisor (Eksik İndeks Dedektörü):** Özel algoritması sayesinde, sistemin CPU'sunu boğan tam tablo taramalarını (Seq Scan) analiz eder ve indeks eklenmesi gereken tabloları size tavsiye eder.
- 📝 **CSV Error Log Okuyucu:** Sunucuya fiziksel olarak girmeden, PostgreSQL'in CSV formatındaki hata loglarını (ERROR, FATAL, PANIC) doğrudan arayüzden okuyun ve hataya sebep olan SQL'leri inceleyin.
- 🧹 **Vacuum & Bloat Analizi:** Tablolardaki "Ölü Satır (Dead Tuple)" oranını hesaplar, şişkinlik (Bloat) yaratan tablolar için anında VACUUM önerisi sunar.
- 🔒 **Lock Monitor:** Kilitlenen (Blocked) ve birbirini bekleyen işlemleri anında tespit edin.

---

## 🛠️ Kurulum Gereksinimleri

### 1. PostgreSQL Yapılandırması (Kritik)
PG Intelligence'ın tüm yeteneklerinden (Yavaş sorgular, Hata Logları ve uzun SQL analizleri) faydalanabilmek için, izlenecek olan PostgreSQL sunucusunun `postgresql.conf` dosyasında şu ayarların yapılmış olması gerekmektedir:

```ini
# 1. Yavaş Sorgu Analizi İçin:
shared_preload_libraries = 'pg_stat_statements'

# 2. Hata Loglarını (Error Logs) Arayüzden Okuyabilmek İçin:
logging_collector = on
log_destination = 'csvlog'
# (Logların kaydedildiği dizini .env dosyasında belirteceksiniz)

# 3. Uzun Sorguların Analizi (Smart Analyze) İçin Kesilmeyi Önleme:
track_activity_query_size = 4096  # veya 8192
