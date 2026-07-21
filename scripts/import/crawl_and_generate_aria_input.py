# crawl_and_generate_aria_input.py
# Mimers Brunn — Crawl Naturvårdsverket and generate aria2c input file

import os
import re
import urllib.parse
import urllib.request
import time
from datetime import datetime

base_url = "https://geodata.naturvardsverket.se/nedladdning/"
today = datetime.now().strftime("%Y-%m-%d")

# Load MASTER_ARCHIVE_ROOT from env
master_archive_root = os.getenv("MASTER_ARCHIVE_ROOT")
if not master_archive_root:
    if os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            for line in f:
                if "MASTER_ARCHIVE_ROOT" in line:
                    parts = line.split("=", 1)
                    if len(parts) == 2:
                        val = parts[1].strip().strip('"').strip("'")
                        master_archive_root = val
                        break

if not master_archive_root:
    master_archive_root = r"H:\Delade enheter\Miljöbeslut\GEO_Master_Archive"

dest_root = os.path.join(master_archive_root, "Data", "Naturvardsverket")
print(f"Destination root: {dest_root}")
print(f"Base URL: {base_url}")

visited = set()
queue = [base_url]
file_count = 0

aria_input_file = "aria2c_input.txt"

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

with open(aria_input_file, "w", encoding="utf-8") as writer:
    while queue:
        current_url = queue.pop(0)
        if current_url in visited:
            continue
        visited.add(current_url)

        print(f"Crawling: {current_url}")
        time.sleep(0.3)  # Polite crawling delay

        req = urllib.request.Request(current_url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                html = response.read().decode('utf-8', errors='ignore')
        except Exception as e:
            print(f"Failed to fetch {current_url}: {e}")
            continue

        # Regex to find links: href="name"
        links = re.findall(r'href="([^"\?]+)"', html)
        for link in links:
            # Skip parent directory, query parameters, or absolute links
            if not link or link.startswith('/') or link.startswith('?') or link.startswith('http'):
                continue
            if "Parent Directory" in link or "Name" in link or "Last modified" in link or "Size" in link or "Description" in link:
                continue

            absolute_url = urllib.parse.urljoin(current_url, link)

            if link.endswith('/'):
                # Directory -> queue for crawl
                if absolute_url not in visited:
                    queue.append(absolute_url)
            else:
                # File -> parse relative dataset path
                rel_path = absolute_url.replace(base_url, "")
                parts = rel_path.split('/')
                
                if len(parts) >= 2:
                    dataset_rel = "\\".join(parts[:-1])
                    filename = parts[-1]
                else:
                    dataset_rel = ""
                    filename = parts[0]

                # Target directory according to Mimers Brunn policy
                local_dir = os.path.join(dest_root, dataset_rel, today, "raw")

                # Write to aria2c input file format
                writer.write(f"{absolute_url}\n")
                writer.write(f"  dir={local_dir}\n")
                writer.write(f"  out={filename}\n")
                writer.write("  continue=true\n")
                file_count += 1

print(f"Crawling complete! Found {file_count} files.")
print(f"Input file generated: {aria_input_file}")
