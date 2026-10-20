#!/usr/bin/env bash
# ==============================================================================
# 04_deploy_demo_ui.sh
# Builds and deploys the Google-themed Frontend + Side-by-Side FastAPI BFF:
#   1. `apigee-ai-economics-demo`: Direct IAP (--iap) enabled for @google.com browser login
#   2. `apigee-ai-economics-bff`: OIDC backend target for Apigee X (`demo-ui-bff`)
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="${REPO_ROOT}/services/demo-ui"

PROJECT_ID="${GCP_PROJECT_ID:-apac-cs-5g-demo5}"
REGION="${GCP_REGION:-australia-southeast1}"
APIGEE_ORG="${APIGEE_ORG:-apac-cs-5g-demo5}"
APIGEE_ENV="${APIGEE_ENV:-demo}"
SERVICE_NAME="apigee-ai-economics-demo"
BFF_SERVICE_NAME="apigee-ai-economics-bff"
SERVICE_ACCOUNT="demo-bff-sa@${PROJECT_ID}.iam.gserviceaccount.com"
APIGEE_GATEWAY_URL="${APIGEE_GATEWAY_URL:-https://10.106.240.2.nip.io/v1/ai-economics}"
OPTIMIZER_SERVICE_URL="${OPTIMIZER_SERVICE_URL:-https://gateway-optimizer-1019413155504.australia-southeast1.run.app}"

echo "==> [1/2] Building and deploying ${SERVICE_NAME} in ${PROJECT_ID} (Direct VPC Egress -> Apigee ${APIGEE_ORG}/${APIGEE_ENV})..."
gcloud beta run deploy "${SERVICE_NAME}" \
  --source="${UI_DIR}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${SERVICE_ACCOUNT}" \
  --no-allow-unauthenticated \
  --iap \
  --network=default \
  --subnet=default \
  --vpc-egress=private-ranges-only \
  --cpu=1 \
  --memory=1Gi \
  --min-instances=1 \
  --max-instances=5 \
  --timeout=120 \
  --set-env-vars="GCP_PROJECT_ID=${PROJECT_ID},GCP_REGION=${REGION},APIGEE_ORG=${APIGEE_ORG},APIGEE_ENV=${APIGEE_ENV},APIGEE_GATEWAY_URL=${APIGEE_GATEWAY_URL},OPTIMIZER_SERVICE_URL=${OPTIMIZER_SERVICE_URL}" \
  --quiet

gcloud iap web add-iam-policy-binding \
  --project="${PROJECT_ID}" \
  --resource-type=cloud-run \
  --service="${SERVICE_NAME}" \
  --region="${REGION}" \
  --member="domain:google.com" \
  --role="roles/iap.httpsResourceAccessor" \
  --quiet >/dev/null

gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="domain:google.com" \
  --role="roles/run.invoker" \
  --quiet >/dev/null

IMG="$(gcloud run services describe "${SERVICE_NAME}" --project="${PROJECT_ID}" --region="${REGION}" --format='value(spec.template.spec.containers[0].image)')"

echo "==> [2/2] Deploying ${BFF_SERVICE_NAME} in ${PROJECT_ID} (Direct VPC Egress -> Apigee ${APIGEE_ORG}/${APIGEE_ENV})..."
gcloud run deploy "${BFF_SERVICE_NAME}" \
  --image="${IMG}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="${SERVICE_ACCOUNT}" \
  --no-allow-unauthenticated \
  --network=default \
  --subnet=default \
  --vpc-egress=private-ranges-only \
  --cpu=1 \
  --memory=1Gi \
  --min-instances=1 \
  --max-instances=5 \
  --timeout=120 \
  --set-env-vars="GCP_PROJECT_ID=${PROJECT_ID},GCP_REGION=${REGION},APIGEE_ORG=${APIGEE_ORG},APIGEE_ENV=${APIGEE_ENV},APIGEE_GATEWAY_URL=${APIGEE_GATEWAY_URL},OPTIMIZER_SERVICE_URL=${OPTIMIZER_SERVICE_URL}" \
  --quiet

for SA in "apigee-ai-gw-sa@${PROJECT_ID}.iam.gserviceaccount.com" "ai-gateway-sa@jw-apigeex-0.iam.gserviceaccount.com"; do
  gcloud run services add-iam-policy-binding "${BFF_SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --member="serviceAccount:${SA}" \
    --role="roles/run.invoker" \
    --quiet >/dev/null
done

echo "==> Deployed in ${PROJECT_ID} targeting Apigee X (${APIGEE_ORG} / env: ${APIGEE_ENV}):"
echo "    1. Cloud Run (IAP @google.com): https://apigee-ai-economics-demo-1019413155504.australia-southeast1.run.app"
echo "    2. Apigee X Target URL:         ${APIGEE_GATEWAY_URL}"
