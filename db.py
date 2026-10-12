import mysql.connector
import os
from dotenv import load_dotenv

load_dotenv()


DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASSWORD"),
    "database": os.getenv("DB_NAME", "netmon"),
}


def get_conn():
    return mysql.connector.connect(**DB_CONFIG)

def _write(sql, rows):
    if not rows:
        return
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.executemany(sql, rows)
        conn.commit()
    finally:
        conn.close()

def _read(sql, params=()):
    conn = get_conn()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(sql, params)
        return cur.fetchall()
    finally:
        conn.close()

def init_db():
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""CREATE TABLE IF NOT EXISTS events (
            id INT AUTO_INCREMENT PRIMARY KEY,
            device VARCHAR(20) NOT NULL,
            old_status VARCHAR(20) NOT NULL,
            new_status VARCHAR(20) NOT NULL,
            ts DOUBLE NOT NULL
        ) ENGINE=InnoDB""")
        cur.execute("""CREATE TABLE IF NOT EXISTS checks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            device VARCHAR(20) NOT NULL,
            status VARCHAR(20) NOT NULL,
            latency INT NULL,
            ts DOUBLE NOT NULL,
            INDEX idx_device (device, id)
        ) ENGINE=InnoDB""")
        conn.commit()
    finally:
        conn.close()

def save_events(events):
    _write("INSERT INTO events (device, old_status, new_status, ts) VALUES (%s, %s, %s, %s)",
           [(e["device"], e["old"], e["new"], e["time"]) for e in events])

def save_checks(devices, now):
    _write("INSERT INTO checks (device, status, latency, ts) VALUES (%s, %s, %s, %s)",
           [(d["id"], d["status"], d["latency"], now) for d in devices])

def get_events(limit=50):
    rows = _read("SELECT device, old_status, new_status, ts FROM events "
                 "ORDER BY id DESC LIMIT %s", (limit,))
    return [{"device": r["device"], "old": r["old_status"],
             "new": r["new_status"], "time": r["ts"]} for r in rows]

def get_history(device, limit=30):
    rows = _read("SELECT latency, status, ts AS time FROM checks "
                 "WHERE device = %s ORDER BY id DESC LIMIT %s", (device, limit))
    return list(reversed(rows))          # oldest first, for the graph

def get_uptime(device):
    row = _read("""SELECT COUNT(*) AS total,
                          SUM(status IN ('UP','DEGRADED')) AS good
                   FROM checks WHERE device = %s""", (device,))[0]
    if not row["total"]:
        return 100.0
    return round(100 * float(row["good"]) / row["total"], 1)