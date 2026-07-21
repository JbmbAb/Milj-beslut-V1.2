# clean_aria_input.py
import re

with open("aria2c_input.txt", "r", encoding="utf-8") as f:
    lines = f.readlines()

cleaned_lines = []
for line in lines:
    if line.startswith("  dir="):
        # Hämta sökvägen, ersätt dubbla eller enkla backslashes med framåtriktade snedstreck
        path_part = line.split("dir=", 1)[1].strip()
        # Normalisera till framåtriktade snedstreck
        normalized_path = path_part.replace("\\\\", "/").replace("\\", "/")
        cleaned_lines.append(f"  dir={normalized_path}\n")
    else:
        cleaned_lines.append(line)

with open("aria2c_input.txt", "w", encoding="utf-8") as f:
    f.writelines(cleaned_lines)

print("Aria2c input file normalized successfully with forward slashes.")
