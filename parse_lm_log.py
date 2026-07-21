import json, re, pathlib

log_path = pathlib.Path("logs/lm_stac_import.log")
out_path = pathlib.Path("logs/lm_resume_byggnader.json")

completed = set()
if log_path.exists():
    with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
    matches = re.findall(r"\[\d+/\d+\]\s+(\w+):\s+OK", content)
    for m in matches:
        completed.add(m)

print(f"Parsed {len(completed)} completed items from log.")
out_path.write_text(json.dumps(list(completed)))
