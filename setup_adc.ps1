# ================================================================
#   Google Cloud Model API & Gemini: ADC setup script (PowerShell)
# ================================================================

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   Google Cloud Model API & Gemini: ADC setup script" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

# --- Step 1: Check if gcloud is in path ---
$gcloudPath = Get-Command gcloud -ErrorAction SilentlyContinue

if ($gcloudPath) {
    Write-Host "✅ gcloud CLI detected at: $($gcloudPath.Source)" -ForegroundColor Green
} else {
    Write-Host "❌ Critical Error: gcloud CLI not found on your system PATH." -ForegroundColor Red
    Write-Host "Please install Google Cloud SDK: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    exit 1
}

# --- Step 2: Project Configuration ---
# Get current project from gcloud configuration to offer as a default
$defaultProject = & gcloud config get-value project 2>$null
if ([string]::IsNullOrWhiteSpace($defaultProject)) {
    $defaultProject = "miljointelligens"
}

Write-Host ""
Write-Host "--- Project Setup ---" -ForegroundColor Blue
Write-Host "Enter your Google Cloud Project ID (NOT the name)."
$PROJECT_ID = Read-Host -Prompt "Project ID (Press Enter for '$defaultProject')"

if ([string]::IsNullOrWhiteSpace($PROJECT_ID)) {
    $PROJECT_ID = $defaultProject
}

# --- Step 3: Authentication ---
Write-Host ""
Write-Host "--- Authenticating ---" -ForegroundColor Blue
Write-Host "Authorizing Application Default Credentials (ADC)..." -ForegroundColor Yellow
& gcloud auth application-default login

Write-Host ""
Write-Host "Setting active gcloud account..." -ForegroundColor Yellow
$ACCOUNT = & gcloud auth list --filter=status:ACTIVE --format="value(account)"
if (![string]::IsNullOrWhiteSpace($ACCOUNT)) {
    & gcloud config set account "$ACCOUNT"
    Write-Host "✅ Active account set to $ACCOUNT" -ForegroundColor Green
} else {
    Write-Host "⚠️ Could not determine active account from ADC login. You might be prompted to login again." -ForegroundColor Yellow
    Write-Host "Logging in to CLI..." -ForegroundColor Yellow
    & gcloud auth login --quiet
}

# --- Step 4: Final Configuration ---
Write-Host ""
Write-Host "--- Finalizing Configuration ---" -ForegroundColor Blue
& gcloud config set project "$PROJECT_ID"
& gcloud auth application-default set-quota-project "$PROJECT_ID"

# Try to enable the API
Write-Host ""
Write-Host "🔌 Ensuring Google Cloud Model API is enabled..." -ForegroundColor Yellow
try {
    & gcloud services enable aiplatform.googleapis.com
    Write-Host "✅ aiplatform.googleapis.com service is enabled" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Could not enable API (you might need an admin to do this or billing is not set up). Proceeding..." -ForegroundColor Yellow
}

# --- Step 5: Instant Verification ---
Write-Host ""
Write-Host "--- Verifying Access ---" -ForegroundColor Blue
$ACCESS_TOKEN = & gcloud auth print-access-token

if ([string]::IsNullOrWhiteSpace($ACCESS_TOKEN)) {
    Write-Host "❌ Authentication failed. No token received." -ForegroundColor Red
    exit 1
}

# Use Invoke-RestMethod to test the connection immediately
Write-Host "Sending verification request to Vertex AI Publisher Model API..." -ForegroundColor Yellow
$headers = @{
    "Authorization" = "Bearer $ACCESS_TOKEN"
    "Content-Type"  = "application/json"
}

$body = @{
    "contents" = @(
        @{
            "role"  = "user"
            "parts" = @(
                @{ "text" = "Reply ONLY with the word SUCCESS" }
            )
        }
    )
} | ConvertTo-Json -Depth 5

try {
    $response = Invoke-RestMethod -Method Post `
        -Uri "https://aiplatform.googleapis.com/v1/projects/$PROJECT_ID/locations/global/publishers/google/models/gemini-2.5-flash:generateContent" `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop

    $responseText = $response | ConvertTo-Json -Depth 10
    if ($responseText -like "*SUCCESS*") {
        Write-Host ""
        Write-Host "🎉 SUCCESS! Your Model API access is fully working." -ForegroundColor Green
        $storedPath = Join-Path $env:USERPROFILE ".config\gcloud\application_default_credentials.json"
        Write-Host "ADC Credentials stored at: $storedPath" -ForegroundColor Cyan
    } else {
        Write-Host "⚠️ Authentication worked, but the API call returned an unexpected response." -ForegroundColor Yellow
        Write-Host "Response: $responseText"
    }
} catch {
    Write-Host "❌ API Verification request failed." -ForegroundColor Red
    Write-Host "Error Details: $_" -ForegroundColor DarkRed
}
