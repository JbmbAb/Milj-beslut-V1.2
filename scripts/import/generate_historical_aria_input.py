# scripts/import/generate_historical_aria_input.py
#
# Mimer Librarian — Historical Maps FTP Crawler.
# Crawlar Lantmäteriets öppna FTP anonymt och genererar en inputfil för aria2c.
#
# Körs via:
#   python scripts/import/generate_historical_aria_input.py

import os
from ftplib import FTP
import sys

FTP_HOST = "download-opendata.lantmateriet.se"
TARGET_FOLDERS = [
    "Generalstabskartan",
    "Haradsekonomiska_kartan",
    "Karta_1_10000_raster",
    "Ekonomiska_kartan"
]

# Kanonisk målkatalog på H-disken
MASTER_ARCHIVE = os.environ.get("GEO_MASTER_ARCHIVE", "H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive")
DEST_ROOT = os.path.join(MASTER_ARCHIVE, "Data", "LM", "Historiska")

OUTPUT_FILE = os.path.join("storage", "aria2c_historical_input.txt")

def crawl_ftp_dir(ftp, remote_path, file_list):
    """Rekursiv sökning efter filer på FTP-servern."""
    print(f"Crawlar: {remote_path} ...")
    try:
        items = []
        ftp.dir(remote_path, items.append)
    except Exception as e:
        print(f"⚠️ Kunde inte lista {remote_path}: {e}", file=sys.stderr)
        return

    for item in items:
        # Exempel på ftp.dir-utdata:
        # dr-xr-xr-x    2 ftp      ftp          8192 Sep 06  2019 folder_name
        # -r-xr-xr-x    1 ftp      ftp       1234567 Sep 06  2019 file.zip
        parts = item.split(None, 8)
        if len(parts) < 9:
            continue
        
        info = parts[0]
        name = parts[8]
        
        # Undvik parent/current dir referenser
        if name in [".", ".."]:
            continue
            
        full_remote_path = f"{remote_path}/{name}" if remote_path != "/" else f"/{name}"
        
        if info.startswith("d"):
            # Rekursivt anrop för undermappar
            crawl_ftp_dir(ftp, full_remote_path, file_list)
        else:
            # Spara filens sökväg och storlek
            size = 0
            try:
                size = int(parts[4])
            except:
                pass
            file_list.append((full_remote_path, size))

def main():
    print("=== Mimers Brunn — Historical Maps Crawler ===")
    print(f"Ansluter anonymt till ftp://{FTP_HOST} ...")
    
    os.makedirs("storage", exist_ok=True)
    
    try:
        ftp = FTP(FTP_HOST)
        ftp.login() # Anonym login
        print("OK: Connected successfully!")
    except Exception as e:
        print(f"[ERROR] Connection to FTP failed: {e}", file=sys.stderr)
        sys.exit(1)

    all_files = []
    
    for folder in TARGET_FOLDERS:
        print(f"\nScanning: {folder} ...")
        folder_files = []
        crawl_ftp_dir(ftp, f"/{folder}", folder_files)
        print(f"OK: Found {len(folder_files)} files under {folder}.")
        all_files.extend(folder_files)

    ftp.quit()
    
    print(f"\nTotal files found: {len(all_files)}")
    
    # Skriv till aria2c input-fil
    written_count = 0
    total_size_bytes = 0
    
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for remote_path, size in all_files:
            # Skapa den lokala katalogen baserat på FTP-strukturen
            # remote_path: /Ekonomiska_kartan/01_Stockholm/file.zip
            # local_sub_dir: dest_root + Ekonomiska_kartan/01_Stockholm
            parts = [p for p in remote_path.split("/") if p]
            if not parts:
                continue
                
            sub_folder = os.path.dirname(os.path.join(*parts))
            local_dir = os.path.join(DEST_ROOT, sub_folder)
            
            # Använd forward-slashes i aria2c för Windows-kompatibilitet
            local_dir_normalized = local_dir.replace("\\", "/")
            
            # Skriv URL och mål-katalog till input-filen
            f.write(f"ftp://{FTP_HOST}{remote_path}\n")
            f.write(f"  dir={local_dir_normalized}\n")
            written_count += 1
            total_size_bytes += size

    print(f"\nDONE: Wrote {written_count} downloads to {OUTPUT_FILE}!")
    print(f"Total size estimate: {total_size_bytes / 1024 / 1024 / 1024:.2f} GB")

if __name__ == "__main__":
    main()
