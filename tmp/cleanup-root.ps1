$root = $PSScriptRoot | Split-Path -Parent
Set-Location $root

# === Skapa destinationsmappar ===
$dirs = @("scripts\diag", "logs\root", "tmp")
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$moved = 0
$removed = 0
$errors = 0

function Move-Safe {
    param($src, $dst)
    if (Test-Path $src) {
        try {
            $dest = Join-Path $dst (Split-Path $src -Leaf)
            if (Test-Path $dest) { Remove-Item $dest -Force }
            Move-Item $src $dst -Force
            Write-Host "  MOVED: $src -> $dst" -ForegroundColor Green
            $script:moved++
        } catch {
            Write-Host "  ERROR: $src -> $($_.Exception.Message)" -ForegroundColor Red
            $script:errors++
        }
    }
}

function Remove-Safe {
    param($src)
    if (Test-Path $src) {
        try {
            Remove-Item $src -Force
            Write-Host "  DEL:   $src" -ForegroundColor Yellow
            $script:removed++
        } catch {
            Write-Host "  ERROR: del $src -> $($_.Exception.Message)" -ForegroundColor Red
            $script:errors++
        }
    }
}

# =======================================
# GRUPP A – check_*.ts och andra diag-skript -> scripts/diag/
# =======================================
Write-Host "`n=== GRUPP A: Diagnostikskript -> scripts/diag/ ===" -ForegroundColor Cyan
$diagScripts = @(
    "check_attachments.ts", "check_content_count.ts", "check_content_sample.ts",
    "check_current_db.ts", "check_dbs.ts", "check_diarie_count.ts",
    "check_doc_and_content.ts", "check_env_schema.ts", "check_env_seqs.ts",
    "check_env_tables.ts", "check_extraction.ts", "check_extraction_test.ts",
    "check_flash_models.ts", "check_gemini_models.ts", "check_ground_names.ts",
    "check_health.ts", "check_ingest.ts", "check_keywords.ts",
    "check_kransmunis.ts", "check_live_doc_reqs.ts", "check_mariestad_keywords.ts",
    "check_mariestad_text.ts", "check_meta_samples.ts", "check_muni_counts.ts",
    "check_ocr_queue.ts", "check_parsed_counts.ts", "check_pdf_reqs.ts",
    "check_postgis.ts", "check_progress.ts", "check_project_ids.ts",
    "check_schemas.ts", "check_schemas_full.ts", "check_seqs_full.ts",
    "check_sgu_tables.ts", "check_sgu_tables_v2.ts", "check_ska.ts",
    "check_status_counts.ts", "check_status_counts_full.ts", "check_test_doc_reqs.ts",
    "check_today.ts",
    "count_krans_reqs.ts", "count_requirements.ts", "count_sgu.ts",
    "diag_gemini.ts",
    "dump_doc_ids.ts", "dump_models.ts", "dump_projects.ts",
    "final_data_summary.ts",
    "investigate_queue.ts",
    "mariestad_stats.ts",
    "raw_test.ts",
    "repair_spatial.ts",
    "reset_all_parsed.ts", "reset_extraction_queue.ts",
    "sample_mariestad.ts",
    "search_mariestad.ts", "search_mariestad_pdf.ts",
    "test_gemini.ts", "test_gemini_2_0.ts", "test_gemini_pdf.ts",
    "test_gemini_prefix.ts", "test_gemini_v2.ts", "test_live_ocr.ts",
    "test-models.ts",
    "hardware-check.ts",
    "get_project_id.ts",
    "fix-document-status-drift.ts",
    "dataFetcher.ts",
    "hardware-check.ps1",
    "list_all.js", "list_formatted.js", "list_tables.js",
    "list_tables.sql", "inspect-audit.sql", "database_env_spatial.sql",
    "generate_ddl.js", "prisma_debug.js", "extract_coverage.js",
    "cleanup.js"
)
foreach ($f in $diagScripts) { Move-Safe $f "scripts\diag" }

# =======================================
# GRUPP B+C – Loggar och output-filer -> logs/root/
# =======================================
Write-Host "`n=== GRUPP B+C: Loggar och output -> logs/root/ ===" -ForegroundColor Cyan
$logFiles = @(
    "backend.admin.err.log", "backend.admin.out.log",
    "backend.dev.err.log", "backend.dev.out.log",
    "frontend.dev.err.log", "frontend.dev.out.log",
    "batch_run.log", "batch_run_100.log", "batch_run_40.log",
    "import.log", "import_v2.log",
    "lantmateriet-test.log", "lantmateriet_import.log",
    "last_3.log", "last_imported.log",
    "orsa_3.log", "output.log", "search_health.log",
    "stackmora_3_12.log", "stage_list.log", "stage_samples.log",
    "structure.log", "sync_test.log", "verify_orsa.log",
    "debug_server.log",
    "extract_error.txt", "hits.log", "log.txt", "log-utf8.txt",
    "output.txt", "output2.txt", "output_gemini.json",
    "notification_error.txt", "public_ui_error.txt",
    "test_output.txt", "test_output_prisma.txt", "test_output_rag.txt",
    "test_output_rag_debug.txt", "test_output_rag_debug_2.txt",
    "test_output_rag_debug_3.txt", "test_output_rag_debug_4.txt",
    "test_output_rag_debug_test1.txt", "test_output_rag_debug_test2.txt",
    "test_output_rag_final.txt", "test_output_utf8.txt", "test_output_verbose.txt",
    "token-test-results.txt", "tsc_error.txt", "tsc_output.txt",
    "uncovered_search.txt", "vitest-output.txt",
    "lantmateriet_fail_detail.txt"
)
foreach ($f in $logFiles) { Move-Safe $f "logs\root" }

# =======================================
# GRUPP D – temp_ filer och ad-hoc data -> tmp/
# =======================================
Write-Host "`n=== GRUPP D: Temp-filer -> tmp/ ===" -ForegroundColor Cyan
$tmpFiles = @(
    "collections.txt", "indexes_output.txt", "core_list.log",
    "db-full-inventory.json", "db-list.json", "db-size-results.json",
    "models_output.json", "temp_all_apis.json", "temp_apps.json", "temp_b.json",
    "slu-test-results-utf8.json", "slu-test-results.json",
    "lost-data-results-clean.json", "lost-data-results.json",
    "lost-data-staging-results.json",
    "lantmateriet-test.log"
)
foreach ($f in $tmpFiles) { Move-Safe $f "tmp" }

# temp_* filer (fånga alla)
Get-ChildItem -File -Filter "temp_*" | ForEach-Object { Move-Safe $_.Name "tmp" }

# =======================================
# GRUPP E – Ta bort redundanta coverage/batch-rapporter
# =======================================
Write-Host "`n=== GRUPP E: Ta bort redundanta rapportfiler ===" -ForegroundColor Cyan
$deleteFiles = @(
    "batch5_partial_coverage.txt", "batch5_partial_coverage_v2.txt", "batch5_v3_results.txt",
    "FINAL_BRANCH_COVERAGE_75_PERCENT.txt", "FINAL_BRANCH_COVERAGE_SUCCESS.txt",
    "FINAL_CLEAN_REPORT_75.txt", "FINAL_GLOBAL_VERIFICATION_75.txt",
    "FINAL_REPORT_GLOBAL.txt", "FINAL_REPORT_UTF8.txt",
    "FINAL_THROTTLE_CHECK.txt", "FINAL_UNCONSTRAINED_REPORT.txt",
    "coverage_report.json", "coverage_summary.txt",
    "final_coverage.txt", "final_coverage_batch3.txt",
    "final_coverage_batch4.txt", "final_coverage_batch5_check.txt",
    "final_coverage_batch5_report.txt",
    "qa_full.pid"
)
foreach ($f in $deleteFiles) { Remove-Safe $f }

# =======================================
# GRUPP F – Excel/CSV till Sammanställning/
# =======================================
Write-Host "`n=== GRUPP F: Excel/CSV -> Sammanställning/ ===" -ForegroundColor Cyan
if (-not (Test-Path "Sammanställning")) { New-Item -ItemType Directory "Sammanställning" -Force | Out-Null }
$examFiles = @(
    "Examensmatris_Sammanst%C3%A4llning_2026-03-05.xlsx",
    "kravmatris_mellanlagring_autofylld.csv",
    "kravmatris_mellanlagring_guide.md",
    "kravmatris_mellanlagring_template.csv",
    "examensarbete_kpi_guide.md",
    "examensarbete_kpi_template.csv",
    "examensarbete_mellanlagring_upplagg.md",
    "mall_c_anmalan_mellanlagringsplatta_v2.md",
    "Examensunderlag_NotebookLM_2026-03-05.txt"
)
foreach ($f in $examFiles) { Move-Safe $f "Sammanställning" }
# Flytta Excel-filer med glob
Get-ChildItem -File -Filter "*.xlsx" | ForEach-Object { Move-Safe $_.Name "Sammanstallning" }

Write-Host "`n=============================" -ForegroundColor White
Write-Host "Klart! Moved: $moved | Removed: $removed | Errors: $errors" -ForegroundColor White
Write-Host "=============================" -ForegroundColor White
