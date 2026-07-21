
import os
import psycopg2

db_url = "postgresql://miljobeslut:password@localhost:5432/miljobeslut"

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM env.sgu_soil_type")
    count = cur.fetchone()[0]
    print(f"Count: {count}")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Error: {e}")
