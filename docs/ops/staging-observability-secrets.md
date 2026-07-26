# Staging — observability secrets (Week 3)

Kör **efter merge och deploy** till staging. Kräver `gcloud auth login`.

## Snabbkommandon (PowerShell)

```powershell
$PROJECT = "miljointelligens"
$REGION = "europe-west1"
$SERVICE = "miljobeslut"

gcloud config set project $PROJECT

# 1. Skapa QUERY_HASH_SALT i Secret Manager (engångs — spara värdet säkert)
# Ersätt med ett slumpmässigt 32+ tecken värde:
$SALT = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
Write-Host "Generated salt (store securely): $SALT"
echo $SALT | gcloud secrets create QUERY_HASH_SALT --data-file=- 2>$null
if ($LASTEXITCODE -ne 0) {
  echo $SALT | gcloud secrets versions add QUERY_HASH_SALT --data-file=-
}

# 2. Ge Cloud Run SA åtkomst till secret
$SA = "miljobeslut-sa@${PROJECT}.iam.gserviceaccount.com"
gcloud secrets add-iam-policy-binding QUERY_HASH_SALT `
  --member="serviceAccount:$SA" `
  --role="roles/secretmanager.secretAccessor"

# 3. Uppdatera Cloud Run med secrets + env (Vertex OAuth2 — ingen GEMINI_API_KEY för rerank)
gcloud run services update $SERVICE `
  --region=$REGION `
  --update-secrets=QUERY_HASH_SALT=QUERY_HASH_SALT:latest `
  --update-env-vars="QUERY_HASH_SALT_VERSION=v1,LEGAL_RERANKER=on,LEGAL_RERANKER_RELATIVE_GAP=0.15,VERTEX_PROJECT_ID=miljointelligens,VERTEX_LOCATION=europe-west1"

Write-Host "Done. Verify with: gcloud run services describe $SERVICE --region=$REGION --format='yaml(spec.template.spec.containers[0].env)'"
```

## Verifiering

1. Kör staging smoke:
   ```powershell
   $env:STAGING_BASE_URL = "https://your-staging-url"
   $env:ADMIN_CONSOLE_USERNAME = "admin"
   $env:ADMIN_CONSOLE_PASSWORD = "..."
   npx vitest run tests/smoke/legal_rerank_staging.test.ts
   ```

2. I Cloud Logging, sök `jsonPayload.event="search.completed"` och bekräfta:
   - `requestId`, `queryHash`, `queryHashSaltVersion`
   - `exactLatencyMs`, `ftsLatencyMs`, `vectorLatencyMs`, `totalLatencyMs`
   - `shadowChangedTop1`, `kendallTau`

## Rollback

```powershell
gcloud run services update miljobeslut --region=europe-west1 --update-env-vars="LEGAL_RERANKER=off"
```
