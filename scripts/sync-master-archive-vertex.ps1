# PowerShell script to synchronize local Master Archive documents directly to Google Cloud Storage (GCS)
# for ingestion into Vertex AI Search (Discovery Engine).
#
# This script respects the "Mimers Brunn" offline-first rule:
# 1. Documents are first fully secured and verified in the local canonical path (H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Documents\)
# 2. They are then incrementally replicated to a secure, private GCS bucket in GCP
# 3. Vertex AI Search (Discovery Engine) continuously ingests and indexes directly from that GCS bucket.

$ErrorActionPreference = "Stop"

# 1. Load local environment variables from .env.local or .env
$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$EnvFiles = @("$ProjectRoot\.env.local", "$ProjectRoot\.env")
$EnvMap = @{}

foreach ($File in $EnvFiles) {
    if (Test-Path $File) {
        Write-Host "[INFO] Loading environment from: $File" -ForegroundColor Cyan
        Get-Content $File | Where-Object { $_ -match "^[^#\s]+=" } | ForEach-Object {
            $Parts = $_.Split('=', 2)
            $Key = $Parts[0].Trim()
            $Val = $Parts[1].Trim()
            # Strip quotes if present
            if ($Val -match "^`"(.*)`"$") { $Val = $Matches[1] }
            if ($Val -match "^'(.*)'$") { $Val = $Matches[1] }
            if (-not $EnvMap.ContainsKey($Key)) {
                $EnvMap[$Key] = $Val
            }
        }
    }
}

# Resolve GCP Project & Location
$GcpProject = $EnvMap["VERTEX_PROJECT_ID"]
if ([string]::IsNullOrEmpty($GcpProject)) {
    $GcpProject = "miljointelligens"
}
$GcpLocation = $EnvMap["VERTEX_LOCATION"]
if ([string]::IsNullOrEmpty($GcpLocation)) {
    $GcpLocation = "europe-north1"
}

# Resolve GCS Bucket Name (Must be globally unique)
$BucketName = "miljobeslut-master-archive-documents-$GcpProject"
$LocalDocPath = "H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Documents"

Write-Host "──────────────────────────────────────────────────────────" -ForegroundColor Yellow
Write-Host " Mimers Brunn ──► Vertex AI Search Sync Pipeline" -ForegroundColor Yellow
Write-Host "──────────────────────────────────────────────────────────" -ForegroundColor Yellow
Write-Host " Local Archive:  $LocalDocPath" -ForegroundColor White
Write-Host " Target GCS:     gs://$BucketName" -ForegroundColor White
Write-Host " GCP Project:    $GcpProject" -ForegroundColor White
Write-Host " Location:       $GcpLocation" -ForegroundColor White
Write-Host "──────────────────────────────────────────────────────────" -ForegroundColor Yellow

# 2. Check if local master archive exists
if (-not (Test-Path $LocalDocPath)) {
    Write-Error "Local master archive path not found: $LocalDocPath. Make sure the H: drive is mounted!"
}

# 3. Verify gcloud credentials
Write-Host "[INFO] Verifying Google Cloud SDK..." -ForegroundColor Cyan
$GcloudCheck = Get-Command gcloud -ErrorAction SilentlyContinue
if (-not $GcloudCheck) {
    Write-Error "Google Cloud SDK (gcloud) is not installed or not in PATH. Please install it first."
}

Write-Host "[INFO] Active GCP Account: " -NoNewline -ForegroundColor Cyan
gcloud auth list --filter="status:ACTIVE" --format="value(account)"

# Ensure we are pointing to the correct project
Write-Host "[INFO] Setting active project to $GcpProject..." -ForegroundColor Cyan
gcloud config set project $GcpProject

# 4. Ensure GCS bucket exists
Write-Host "[INFO] Checking if GCS bucket gs://$BucketName exists..." -ForegroundColor Cyan
$BucketExists = $false
try {
    # Silence output for check
    gcloud storage buckets describe gs://$BucketName --format="value(name)" > $null 2>&1
    $BucketExists = $true
    Write-Host "[SUCCESS] Bucket gs://$BucketName already exists." -ForegroundColor Green
} catch {
    Write-Host "[INFO] Bucket gs://$BucketName does not exist. Creating it in $GcpLocation..." -ForegroundColor Yellow
    # Create private bucket with Uniform Bucket-Level Access
    gcloud storage buckets create gs://$BucketName --project=$GcpProject --location=$GcpLocation --uniform-bucket-level-access
    Write-Host "[SUCCESS] Bucket gs://$BucketName created successfully!" -ForegroundColor Green
}

# 5. Perform the incremental synchronization (rsync)
Write-Host "[INFO] Starting incremental sync of Documents to GCS..." -ForegroundColor Cyan
Write-Host "[INFO] Running: gcloud storage rsync `"$LocalDocPath`" `"gs://$BucketName`" --recursive" -ForegroundColor Gray

# We use gcloud storage rsync for multi-threaded fast synchronization.
# It matches file sizes and MD5/SHA hashes to only upload new or modified files.
gcloud storage rsync $LocalDocPath gs://$BucketName --recursive

Write-Host "──────────────────────────────────────────────────────────" -ForegroundColor Green
Write-Host "[SUCCESS] Master Archive documents are fully synced to GCS!" -ForegroundColor Green
Write-Host "──────────────────────────────────────────────────────────" -ForegroundColor Green
Write-Host ""
Write-Host "Next, connect your Vertex AI Search Data Store (sewage-knowledge-store) to sync from this GCS bucket:" -ForegroundColor Yellow
Write-Host ""
Write-Host "👉 In Google Cloud Console:" -ForegroundColor White
Write-Host "   1. Navigate to Vertex AI Agent Builder -> Data Stores." -ForegroundColor White
Write-Host "   2. Click on 'sewage-knowledge-store' (or create a new Document Data Store)." -ForegroundColor White
Write-Host "   3. Click 'Import Data' or 'Add Data'." -ForegroundColor White
Write-Host "   4. Select 'Cloud Storage' as the source." -ForegroundColor White
Write-Host "   5. Enter path: gs://$BucketName/**" -ForegroundColor White
Write-Host "   6. Select import format: 'Unstructured documents (PDF, HTML, etc.)'." -ForegroundColor White
Write-Host "   7. Enable 'Auto-sync' so Vertex AI automatically indexes new files as they land in GCS." -ForegroundColor White
Write-Host ""
Write-Host "👉 Or programmatically trigger an import using gcloud:" -ForegroundColor White
Write-Host "   gcloud beta discoveryengine data-stores import-documents sewage-knowledge-store `" --gcs-source-uri=`"gs://$BucketName/**`"" -ForegroundColor Cyan
Write-Host ""
