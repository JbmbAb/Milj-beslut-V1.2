import sqlite3
import os

path = 'C:/Users/jimmy/Desktop/MiljoBeslut_Produktdata/Miljobeslut_Ops_Pipeline/storage/extracted/jordarter25k-100k/jordarter25k_100k.gpkg'

if not os.path.exists(path):
    print(f"File not found: {path}")
    exit(1)

try:
    conn = sqlite3.connect(path)
    cursor = conn.cursor()
    cursor.execute("SELECT table_name FROM gpkg_contents WHERE data_type='features'")
    rows = cursor.fetchall()
    print("--- LAYERS ---")
    for row in rows:
        print(row[0])
    conn.close()
except Exception as e:
    print(f"Error: {e}")
