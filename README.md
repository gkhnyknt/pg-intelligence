![PG Intelligence Ana Ekran](https://github.com/gkhnyknt/pg-intelligence/blob/main/images/Ekran%20g%C3%B6r%C3%BCnt%C3%BCs%C3%BC%202026-03-31%20005648.png)



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

![PG Intelligence Ana Ekran](https://github.com/gkhnyknt/pg-intelligence/blob/main/images/Ekran%20g%C3%B6r%C3%BCnt%C3%BCs%C3%BC%202026-03-31%20005901.png)

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
```

![PG Intelligence Ana Ekran](https://github.com/gkhnyknt/pg-intelligence/blob/main/images/Ekran%20g%C3%B6r%C3%BCnt%C3%BCs%C3%BC%202026-03-31%20010030.png)

##  🚀 Başlangıç ve Kurulum
### Adım 1: Projeyi Klonlayın

git clone [https://github.com/kullaniciadi/pg-intelligence.git](https://github.com/kullaniciadi/pg-intelligence.git)
cd pg-intelligence

### Adım 2: Bağımlılıkları Yükleyin
Proje dizininde terminali açın ve gerekli Python kütüphanelerini kurun:

pip install -r requirements.txt

### Adım 3: Ortam Değişkenlerini Ayarlayın (.env)

Projenin ana dizininde bir .env dosyası oluşturun. Sistem, DB1_, DB2_ gibi önekler (prefix) kullanarak çoklu sunucu yapısını otomatik tanır.

```ini
# --- SUNUCU 1 (Örn: Canlı Ortam) ---
DB1_NAME=Production Server
DB1_HOST=192.168.1.50
DB1_PORT=5432
DB1_USER=postgres
DB1_PASSWORD=supersecret
DB1_DBNAME=postgres
DB1_LOG_PATH=/var/log/postgresql  # CSV Logların bulunduğu klasör

# --- SUNUCU 2 (Örn: Local Ortam) ---
DB2_NAME=Local Server
DB2_HOST=localhost
DB2_PORT=5432
DB2_USER=postgres
DB2_PASSWORD=localpass
DB2_DBNAME=postgres
DB2_LOG_PATH=C:/Program Files/PostgreSQL/14/data/log

```
![PG Intelligence Ana Ekran](https://raw.githubusercontent.com/gkhnyknt/pg-intelligence/refs/heads/main/images/Ekran%20g%C3%B6r%C3%BCnt%C3%BCs%C3%BC%202026-03-31%20005611.png)


Tarayıcınızda şu adrese gidin:

http://localhost:3000

## Varsayılan Giriş Bilgileri:

```ini
Kullanıcı Adı: admin
Şifre: 123456
```

## 🛡️ Mimari ve Güvenlik

Ajan (Agent) Gerektirmez: Uzak sunuculara ajan kurmanıza gerek yoktur, standart PostgreSQL portu üzerinden çalışır. Sadece Error Logs okuma özelliği dosya sistemi erişimi gerektirir (Bu nedenle uygulamanın bulunduğu makinedeki logları okur veya network share üzerinden log dizinine erişir).

Salt Okunur / Müdahale: Temel metrikler için sistem salt okunur sorgular kullanır. Sadece Kill Query ve Smart Analyze gibi özellikler veritabanına aktif istek gönderir.
