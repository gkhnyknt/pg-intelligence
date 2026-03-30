import os
import sys
import csv
import glob
import datetime
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Optional
from dotenv import load_dotenv

# ── YENİ EKLENDİ: CSV HÜCRE LİMİTİNİ MAKSİMUMA ÇIKARMA ──
# Varsayılan 131,072 karakter sınırını sistemin izin verdiği en üst düzeye (yaklaşık 2GB) çekiyoruz.
# Bu sayede sayfalarca uzunluktaki hatalı dev SQL sorguları bile hatasız okunabilecek.
csv.field_size_limit(min(2147483647, sys.maxsize))

# .env dosyasını .exe'nin çalıştığı ana dizinden okur
load_dotenv(".env")

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

app = FastAPI(title="PostgreSQL Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=False, 
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── FRONTEND (ARAYÜZ) SUNUCU AYARLARI ───
def get_base_path():
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

base_path = get_base_path()

app.mount("/js", StaticFiles(directory=os.path.join(base_path, "js")), name="js")
app.mount("/css", StaticFiles(directory=os.path.join(base_path, "css")), name="css")
app.mount("/views", StaticFiles(directory=os.path.join(base_path, "views")), name="views")

@app.get("/")
def serve_root():
    return FileResponse(os.path.join(base_path, "login.html"))

@app.get("/{filename}.html")
def serve_html(filename: str):
    file_path = os.path.join(base_path, f"{filename}.html")
    if os.path.exists(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(base_path, "login.html"))
# ──────────────────────────────────────────

def get_servers():
    servers = {}
    legacy_found = False
    
    for key, value in os.environ.items():
        if key.startswith("DB") and key.endswith("_HOST"):
            prefix = key.replace("_HOST", "")
            if prefix == "DB":
                legacy_found = True
                continue
            
            servers[prefix] = {
                "id": prefix,
                "name": os.getenv(f"{prefix}_NAME", prefix),
                "host": value,
                "port": int(os.getenv(f"{prefix}_PORT", 5432)),
                "user": os.getenv(f"{prefix}_USER", "postgres"),
                "password": os.getenv(f"{prefix}_PASSWORD", ""),
                "default_db": os.getenv(f"{prefix}_DBNAME", "postgres"),
                "log_path": os.getenv(f"{prefix}_LOG_PATH", "")
            }
    
    if not servers and legacy_found:
        servers["DB1"] = {
            "id": "DB1",
            "name": "Default Server",
            "host": os.getenv("DB_HOST", "localhost"),
            "port": int(os.getenv("DB_PORT", 5432)),
            "user": os.getenv("DB_USER", "postgres"),
            "password": os.getenv("DB_PASSWORD", ""),
            "default_db": os.getenv("DB_NAME", "postgres"),
            "log_path": os.getenv("DB_LOG_PATH", "")
        }
    
    return dict(sorted(servers.items()))

def get_db_config(server_id: str = None, db_name_override: str = None):
    servers = get_servers()
    if not server_id or server_id not in servers:
        if servers:
            server_id = list(servers.keys())[0]
        else:
            raise Exception("Hiçbir veritabanı sunucusu yapılandırılmamış!")
            
    srv = servers[server_id]
    return {
        "dbname": db_name_override if db_name_override else srv["default_db"],
        "user": srv["user"],
        "password": srv["password"],
        "host": srv["host"],
        "port": srv["port"]
    }

class ExplainRequest(BaseModel):
    server: str
    db: str
    query: str

class TerminateRequest(BaseModel):
    server: str
    db: str
    pid: int

@app.get("/api/servers")
def api_get_servers():
    servers = get_servers()
    server_list = [{"id": s["id"], "name": s["name"]} for s in servers.values()]
    return {"status": "success", "servers": server_list}

@app.get("/api/monitoring")
def get_monitoring_data(server: Optional[str] = None, db: Optional[str] = None):
    try:
        config = get_db_config(server, db)
        conn = psycopg2.connect(**config)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT 
                pid, usename AS user, state, TO_CHAR(query_start, 'HH24:MI:SS') AS start_time,
                CASE WHEN state = 'active' THEN COALESCE(ROUND(EXTRACT(EPOCH FROM (now() - query_start))::numeric, 2), 0)
                     ELSE COALESCE(ROUND(EXTRACT(EPOCH FROM (state_change - query_start))::numeric, 2), 0) END AS duration_sec,
                query, (state = 'active' AND wait_event_type = 'Lock') AS locked
            FROM pg_stat_activity
            WHERE query_start >= now() - interval '5 minutes' AND query IS NOT NULL AND query != ''
              AND pid != pg_backend_pid() AND datname = current_database()
            ORDER BY query_start DESC LIMIT 50;
        """)
        queries = cur.fetchall()

        cur.execute("""
            SELECT current_database() AS db_name, psut.schemaname AS schema_name, psut.relname AS name, 
                pg_total_relation_size(psut.relid) AS size_bytes, COALESCE(NULLIF(psut.n_live_tup, 0), GREATEST(pc.reltuples::bigint, 0), 0) AS rows, 
                COALESCE(psut.n_dead_tup, 0) AS dead, COALESCE(psut.seq_scan, 0) AS seq_scan, COALESCE(psut.idx_scan, 0) AS idx_scan,
                COALESCE(psut.seq_tup_read, 0) AS seq_tup_read, COALESCE(psut.idx_tup_fetch, 0) AS idx_tup_fetch,
                TO_CHAR(psut.last_autovacuum, 'YYYY-MM-DD HH24:MI') AS last_autovacuum
            FROM pg_stat_user_tables psut JOIN pg_class pc ON psut.relid = pc.oid
            ORDER BY pg_total_relation_size(psut.relid) DESC LIMIT 500;
        """)
        tables = cur.fetchall()

        try:
            cur.execute("""
                SELECT query, calls, ROUND(mean_exec_time::numeric, 2) AS mean_time_ms, ROUND(max_exec_time::numeric, 2) AS max_time_ms
                FROM pg_stat_statements JOIN pg_database ON pg_database.oid = pg_stat_statements.dbid
                WHERE datname = current_database() ORDER BY mean_exec_time DESC LIMIT 10;
            """)
            slow_queries = cur.fetchall()
        except:
            conn.rollback()
            slow_queries = []

        cur.execute("""
            SELECT sum(xact_commit) AS commits, sum(xact_rollback) AS rollbacks, sum(deadlocks) AS deadlocks,
                sum(temp_files) AS temp_files, sum(temp_bytes) AS temp_bytes,
                sum(blks_hit) * 100.0 / nullif(sum(blks_hit + blks_read), 0) AS cache_ratio
            FROM pg_stat_database WHERE datname = current_database();
        """)
        db_stats = cur.fetchone()

        cur.execute("SELECT sum(idx_tup_fetch) * 100.0 / nullif(sum(seq_tup_read + idx_tup_fetch), 0) AS index_hit_rate FROM pg_stat_user_tables;")
        idx_stats = cur.fetchone()

        cur.execute("SELECT pg_database_size(current_database()) AS total_size_bytes;")
        total_size = cur.fetchone()['total_size_bytes']

        cur.execute("SELECT count(*) AS total_conns FROM pg_stat_activity WHERE datname = current_database();")
        total_conns = cur.fetchone()['total_conns']

        cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;")
        databases = [row['datname'] for row in cur.fetchall()]

        cur.execute("SELECT current_database();")
        current_db = cur.fetchone()['current_database']

        cur.close()
        conn.close()

        commits = db_stats['commits'] if db_stats else 0
        rollbacks = db_stats['rollbacks'] if db_stats else 0
        rollback_rate = (rollbacks / (commits + rollbacks) * 100) if (commits + rollbacks) > 0 else 0

        server_metrics = {"cpu": 0, "ram": 0, "disk": 0}
        if HAS_PSUTIL:
            server_metrics["cpu"] = psutil.cpu_percent(interval=None)
            server_metrics["ram"] = psutil.virtual_memory().percent
            server_metrics["disk"] = psutil.disk_usage('/').percent

        return {
            "status": "success", "queries": queries, "slow_queries": slow_queries, "tables": tables,
            "databases": databases, "current_db": current_db,
            "kpis": {
                "active_connections": total_conns, "cache_hit_ratio": float(db_stats['cache_ratio']) if db_stats and db_stats['cache_ratio'] else 0,
                "total_size_bytes": total_size, "rollback_rate": float(rollback_rate), "deadlocks": db_stats['deadlocks'] if db_stats else 0,
                "temp_files": db_stats['temp_files'] if db_stats else 0, "temp_bytes": db_stats['temp_bytes'] if db_stats else 0,
                "index_hit_rate": float(idx_stats['index_hit_rate']) if idx_stats and idx_stats['index_hit_rate'] else 0
            },
            "server_metrics": server_metrics
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/table_details")
def get_table_details(server: str, db: str, schema: str, table: str):
    try:
        config = get_db_config(server, db)
        conn = psycopg2.connect(**config)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("SELECT column_name, data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position;", (schema, table))
        columns = cur.fetchall()

        cur.execute("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = %s AND tablename = %s;", (schema, table))
        indexes = cur.fetchall()

        cur.close()
        conn.close()
        return {"status": "success", "table_name": table, "columns": columns, "indexes": indexes}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/explain")
def explain_query(req: ExplainRequest):
    try:
        config = get_db_config(req.server, req.db)
        conn = psycopg2.connect(**config)
        conn.autocommit = True 
        cur = conn.cursor() 
        cur.execute(f"EXPLAIN {req.query}")
        plan_rows = cur.fetchall()
        cur.close()
        conn.close()
        return {"status": "success", "plan": "\n".join([row[0] for row in plan_rows])}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/terminate")
def terminate_query(req: TerminateRequest):
    try:
        config = get_db_config(req.server, req.db)
        conn = psycopg2.connect(**config)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT pg_terminate_backend(%s) WHERE %s != pg_backend_pid();", (req.pid, req.pid))
        result = cur.fetchone()
        success = result[0] if result else False
        cur.close()
        conn.close()
        
        if success:
            return {"status": "success", "message": f"Sorgu (PID: {req.pid}) başarıyla sonlandırıldı."}
        else:
            return {"status": "error", "message": f"PID {req.pid} sonlandırılamadı."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/config")
def get_config(server: Optional[str] = None, db: Optional[str] = None):
    try:
        config_db = get_db_config(server, db)
        conn = psycopg2.connect(**config_db)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT name, current_setting(name) AS setting FROM pg_settings;")
        settings = cur.fetchall()
        cur.close()
        conn.close()
        settings_dict = {row['name']: row['setting'] for row in settings}
        return {"status": "success", "settings": settings_dict}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/logs/files")
def get_log_files(server: str):
    try:
        config = get_servers().get(server)
        if not config: return {"status": "error", "message": "Sunucu bulunamadı."}
            
        log_path = config.get("log_path", "")
        if not log_path or not os.path.exists(log_path):
            return {"status": "error", "message": f"Log klasörü (.env) bulunamadı veya hatalı: {log_path}"}
        
        files = glob.glob(os.path.join(log_path, "*.csv"))
        valid_files = []
        thirty_days_ago = datetime.datetime.now() - datetime.timedelta(days=30)
        
        for f in files:
            mtime = datetime.datetime.fromtimestamp(os.path.getmtime(f))
            if mtime >= thirty_days_ago:
                valid_files.append({"filename": os.path.basename(f), "mtime": mtime.strftime("%Y-%m-%d %H:%M:%S")})
        
        valid_files.sort(key=lambda x: x["mtime"], reverse=True)
        return {"status": "success", "files": valid_files}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/logs/content")
def get_log_content(server: str, filename: str):
    try:
        config = get_servers().get(server)
        log_path = config.get("log_path", "")
        if not log_path: return {"status": "error", "message": "Log path ayarlanmamış."}
            
        file_path = os.path.join(log_path, filename)
        if not os.path.abspath(file_path).startswith(os.path.abspath(log_path)):
             return {"status": "error", "message": "Geçersiz dosya yolu isteği."}
             
        if not os.path.exists(file_path):
             return {"status": "error", "message": "Dosya bulunamadı."}
             
        errors = []
        with open(file_path, "r", encoding="utf-8", errors="replace", newline="") as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) > 13:
                    severity = row[11]
                    if severity in ["ERROR", "FATAL", "PANIC"]:
                        query_text = row[19] if len(row) > 19 else ""
                        if not query_text and "statement:" in row[13]:
                            parts = row[13].split("statement:", 1)
                            if len(parts) > 1: query_text = parts[1].strip()
                                
                        errors.append({
                            "time": row[0].split(".")[0] if "." in row[0] else row[0],
                            "user": row[1] or "Bilinmiyor",
                            "db": row[2] or "-",
                            "severity": severity,
                            "message": row[13] or "Mesaj yok",
                            "query": query_text
                        })
                        
        errors.reverse() 
        return {"status": "success", "errors": errors}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ─── UYGULAMAYI BAŞLAT ───
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("API_PORT", 8000)), reload=False)