import subprocess
import sys
import time

datasets = [
    "fastighetsytor",
    "fastighetslinjer",
    "byggnader",
    "marktacke",
    "ortnamn",
    "kommuner",
    "lan",
    "rike"
]

def run_dataset(ds):
    print(f"Starting {ds}...")
    cmd = [sys.executable, "-u", "scripts/data-pipeline/import_lm_stac_resume.py", ds]
    # We'll log to a specific file for this run
    log_file = f"logs/import_manager_{ds}.log"
    with open(log_file, "w") as f:
        process = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT)
        process.wait()
    return process.returncode

def main():
    for ds in datasets:
        ret = run_dataset(ds)
        if ret != 0:
            print(f"Dataset {ds} failed with code {ret}")
        else:
            print(f"Dataset {ds} completed successfully.")
        # Small delay between datasets to let things settle
        time.sleep(5)

if __name__ == "__main__":
    main()
