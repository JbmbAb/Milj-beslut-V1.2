#!/usr/bin/env bash
# Provision AlphaEvolve prerequisites in GCP (Cloud Shell or Linux bastion).
# Requires: Gemini Enterprise license, billing, discoveryengine.admin on caller.
#
# Usage:
#   export PROJECT_ID=miljointelligens
#   export SYSTEM_USER_EMAIL=you@example.com
#   bash scripts/alphaevolve/provision-gcp.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-miljointelligens}"
SA_NAME="${SA_NAME:-alpha-evolve-client}"
ENGINE_ID="${ENGINE_ID:-miljobeslut-alphaevolve}"
ASSISTANT_ID="${ASSISTANT_ID:-default_assistant}"
SYSTEM_USER_EMAIL="${SYSTEM_USER_EMAIL:-}"

echo "==> Project: ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

echo "==> Enabling Discovery Engine API"
gcloud services enable discoveryengine.googleapis.com --project="${PROJECT_ID}"

if ! gcloud iam service-accounts describe "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating service account ${SA_NAME}"
  gcloud iam service-accounts create "${SA_NAME}" \
    --description="Service Account for AlphaEvolve API" \
    --display-name="AlphaEvolve Client SA" \
    --project="${PROJECT_ID}"
else
  echo "==> Service account ${SA_NAME} already exists"
fi

SERVICE_ACCOUNT_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
echo "==> Service account: ${SERVICE_ACCOUNT_EMAIL}"

echo "==> Granting roles/discoveryengine.admin to SA"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/discoveryengine.admin" \
  --quiet >/dev/null

if [[ -n "${SYSTEM_USER_EMAIL}" ]]; then
  echo "==> Granting impersonation to user:${SYSTEM_USER_EMAIL}"
  gcloud iam service-accounts add-iam-policy-binding "${SERVICE_ACCOUNT_EMAIL}" \
    --member="user:${SYSTEM_USER_EMAIL}" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --project="${PROJECT_ID}" \
    --quiet >/dev/null
else
  echo "WARN: SYSTEM_USER_EMAIL not set — skip impersonation binding"
fi

BASE="https://discoveryengine.googleapis.com/v1alpha/projects/${PROJECT_ID}/locations/global/collections/default_collection/engines"
TOKEN="$(gcloud auth print-access-token)"

echo "==> Listing existing engines"
curl -sS -X GET "${BASE}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "x-goog-user-project: ${PROJECT_ID}" | head -c 2000
echo ""

if curl -sS -o /dev/null -w "%{http_code}" -X GET \
  "${BASE}/${ENGINE_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "x-goog-user-project: ${PROJECT_ID}" | grep -q '^200$'; then
  echo "==> Engine ${ENGINE_ID} already exists"
else
  echo "==> Creating engine ${ENGINE_ID}"
  curl -sS -X POST "${BASE}?engineId=${ENGINE_ID}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "x-goog-user-project: ${PROJECT_ID}" \
    -d "{
      \"display_name\": \"${ENGINE_ID}\",
      \"data_store_ids\": [],
      \"solution_type\": \"SOLUTION_TYPE_GENERATIVE_CHAT\"
    }"
  echo ""
fi

ASSISTANT_URL="${BASE}/${ENGINE_ID}/assistants?assistantId=${ASSISTANT_ID}"
if curl -sS -o /dev/null -w "%{http_code}" -X GET \
  "${BASE}/${ENGINE_ID}/assistants/${ASSISTANT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "x-goog-user-project: ${PROJECT_ID}" 2>/dev/null | grep -q '^200$'; then
  echo "==> Assistant ${ASSISTANT_ID} already exists"
else
  echo "==> Creating assistant ${ASSISTANT_ID}"
  curl -sS -X POST "${ASSISTANT_URL}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "x-goog-user-project: ${PROJECT_ID}" \
    -d "{
      \"display_name\": \"${ASSISTANT_ID}\",
      \"description\": null,
      \"generation_config\": null,
      \"web_grounding_type\": \"WEB_GROUNDING_TYPE_UNSPECIFIED\",
      \"enabled_actions\": null,
      \"customer_policy\": null
    }"
  echo ""
fi

echo ""
echo "==> Done. Set in alphaevolve-on-googlecloud/.env:"
echo "PROJECT_ID=${PROJECT_ID}"
echo "GE_APP_ID=${ENGINE_ID}"
echo "ASSISTANT=${ASSISTANT_ID}"
echo ""
echo "Verify locally:"
echo "  pwsh scripts/alphaevolve/verify-gcp.ps1 -GeAppId ${ENGINE_ID}"
