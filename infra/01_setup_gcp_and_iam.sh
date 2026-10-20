#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-apac-cs-5g-demo5}"
REGION="${REGION:-australia-southeast1}"

echo "==> [1/4] Enabling required Google Cloud APIs on ${PROJECT_ID}..."
gcloud services enable \
  aiplatform.googleapis.com \
  apigee.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  compute.googleapis.com \
  run.googleapis.com \
  --project="${PROJECT_ID}"

PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
APIGEE_SERVICE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-apigee.iam.gserviceaccount.com"

echo "==> [2/4] Creating least-privilege Service Accounts..."
for SA_NAME in apigee-ai-gw-sa gw-optimizer-sa demo-bff-sa; do
  if ! gcloud iam service-accounts describe "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud iam service-accounts create "${SA_NAME}" \
      --display-name="AI Gateway Demo - ${SA_NAME}" \
      --project="${PROJECT_ID}"
  else
    echo "    Service account ${SA_NAME} already exists."
  fi
done

echo "==> [3/4] Binding IAM roles for Vertex AI and Cloud Run..."
for SA_NAME in apigee-ai-gw-sa gw-optimizer-sa demo-bff-sa; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user" \
    --condition=None \
    --quiet >/dev/null
done

for SA_NAME in apigee-ai-gw-sa demo-bff-sa; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/run.invoker" \
    --condition=None \
    --quiet >/dev/null
done

# Ensure Cloud Build can deploy & build using default compute SA in project
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/storage.admin" \
  --condition=None \
  --quiet >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/artifactregistry.writer" \
  --condition=None \
  --quiet >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/logging.logWriter" \
  --condition=None \
  --quiet >/dev/null

echo "==> [4/4] Granting Apigee Service Agent (${APIGEE_SERVICE_AGENT}) token creator rights on apigee-ai-gw-sa..."
gcloud iam service-accounts add-iam-policy-binding \
  "apigee-ai-gw-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:${APIGEE_SERVICE_AGENT}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="${PROJECT_ID}" \
  --quiet >/dev/null

gcloud iam service-accounts add-iam-policy-binding \
  "apigee-ai-gw-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:${APIGEE_SERVICE_AGENT}" \
  --role="roles/iam.serviceAccountUser" \
  --project="${PROJECT_ID}" \
  --quiet >/dev/null

echo "==> IAM & Service Account setup complete on ${PROJECT_ID}."
