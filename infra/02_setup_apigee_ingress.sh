#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-apac-cs-5g-demo5}"
REGION="${REGION:-australia-southeast1}"
ENV_NAME="${ENV_NAME:-test-env}"
ENVGROUP_NAME="${ENVGROUP_NAME:-demo-group}"
PSC_ATTACHMENT="projects/cc154b66bb0bacf03p-tp/regions/australia-southeast1/serviceAttachments/apigee-australia-southeast1-2lc5"

echo "==> [1/6] Allocating global static external IP for Apigee X Northbound LB..."
if ! gcloud compute addresses describe apigee-ai-gw-ip --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute addresses create apigee-ai-gw-ip \
    --ip-version=IPV4 \
    --network-tier=PREMIUM \
    --global \
    --project="${PROJECT_ID}"
fi
LB_IP=$(gcloud compute addresses describe apigee-ai-gw-ip --global --project="${PROJECT_ID}" --format="value(address)")
NIP_DOMAIN="${LB_IP}.nip.io"
echo "    Allocated IP: ${LB_IP} -> Domain: ${NIP_DOMAIN}"

echo "==> [2/6] Configuring Apigee Environment Group (${ENVGROUP_NAME}) and attaching ${ENV_NAME}..."
PYTHONPATH=/usr/lib/google-cloud-sdk/lib:/usr/lib/google-cloud-sdk/lib/third_party \
/usr/lib/google-cloud-sdk/platform/bundledpythonunix/bin/python3 - "${PROJECT_ID}" "${ENVGROUP_NAME}" "${ENV_NAME}" "${NIP_DOMAIN}" <<'PYEOF'
import sys, time
from googlecloudsdk.core.credentials import store
from googlecloudsdk.core.credentials import requests as creds_requests

proj, eg_name, env_name, domain = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
store.LoadIfEnabled()
session = creds_requests.GetSession()
base = f"https://apigee.mtls.googleapis.com/v1/organizations/{proj}"

r = session.get(f"{base}/envgroups/{eg_name}")
if r.status_code == 404:
    print(f"    Creating envgroup {eg_name} with hostname {domain}...")
    op = session.post(f"{base}/envgroups", json={"name": eg_name, "hostnames": [domain]}).json()
    for _ in range(30):
        chk = session.get(f"{base}/envgroups/{eg_name}")
        if chk.status_code == 200 and chk.json().get("state") == "ACTIVE":
            break
        time.sleep(2)
else:
    hosts = r.json().get("hostnames", [])
    if domain not in hosts:
        hosts.append(domain)
        session.patch(f"{base}/envgroups/{eg_name}?updateMask=hostnames", json={"hostnames": hosts})

atts = session.get(f"{base}/envgroups/{eg_name}/attachments").json().get("environmentGroupAttachments", [])
if not any(a.get("environment") == env_name for a in atts):
    print(f"    Attaching environment {env_name} to envgroup {eg_name}...")
    session.post(f"{base}/envgroups/{eg_name}/attachments", json={"environment": env_name})
    time.sleep(5)
print("    Apigee Environment Group ready.")
PYEOF

echo "==> [3/6] Creating PSC Network Endpoint Group (NEG) in ${REGION}..."
if ! gcloud compute network-endpoint-groups describe apigee-psc-neg --region="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute network-endpoint-groups create apigee-psc-neg \
    --network-endpoint-type=private-service-connect \
    --psc-target-service="${PSC_ATTACHMENT}" \
    --region="${REGION}" \
    --network=default \
    --project="${PROJECT_ID}"
fi

echo "==> [4/6] Creating Global Backend Service & attaching PSC NEG..."
if ! gcloud compute backend-services describe apigee-psc-backend --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute backend-services create apigee-psc-backend \
    --load-balancing-scheme=EXTERNAL_MANAGED \
    --protocol=HTTPS \
    --global \
    --project="${PROJECT_ID}"

  gcloud compute backend-services add-backend apigee-psc-backend \
    --network-endpoint-group=apigee-psc-neg \
    --network-endpoint-group-region="${REGION}" \
    --global \
    --project="${PROJECT_ID}"
fi

echo "==> [5/6] Creating URL Map and TLS Certificates (Managed + Immediate Self-Signed Fallback)..."
if ! gcloud compute url-maps describe apigee-url-map --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute url-maps create apigee-url-map \
    --default-service=apigee-psc-backend \
    --global \
    --project="${PROJECT_ID}"
fi

if ! gcloud compute ssl-certificates describe apigee-managed-cert --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute ssl-certificates create apigee-managed-cert \
    --domains="${NIP_DOMAIN}" \
    --global \
    --project="${PROJECT_ID}"
fi

if ! gcloud compute ssl-certificates describe apigee-fallback-cert --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  TMP_DIR=$(mktemp -d)
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "${TMP_DIR}/tls.key" \
    -out "${TMP_DIR}/tls.crt" \
    -subj "/CN=${NIP_DOMAIN}" \
    -addext "subjectAltName=DNS:${NIP_DOMAIN},IP:${LB_IP}" >/dev/null 2>&1
  gcloud compute ssl-certificates create apigee-fallback-cert \
    --certificate="${TMP_DIR}/tls.crt" \
    --private-key="${TMP_DIR}/tls.key" \
    --global \
    --project="${PROJECT_ID}"
  rm -rf "${TMP_DIR}"
fi

echo "==> [6/6] Creating Target HTTPS Proxy and Global Forwarding Rule..."
if ! gcloud compute target-https-proxies describe apigee-https-proxy --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute target-https-proxies create apigee-https-proxy \
    --url-map=apigee-url-map \
    --ssl-certificates=apigee-managed-cert,apigee-fallback-cert \
    --global \
    --project="${PROJECT_ID}"
fi

if ! gcloud compute forwarding-rules describe apigee-https-fr --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute forwarding-rules create apigee-https-fr \
    --load-balancing-scheme=EXTERNAL_MANAGED \
    --network-tier=PREMIUM \
    --address=apigee-ai-gw-ip \
    --global \
    --target-https-proxy=apigee-https-proxy \
    --ports=443 \
    --project="${PROJECT_ID}"
fi

echo "==> Apigee X Northbound Ingress Ready: https://${NIP_DOMAIN}"
