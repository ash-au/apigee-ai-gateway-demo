#!/usr/bin/env bash
# ==============================================================================
# 05_deploy_xlb_bridge_proxy.sh
# Packages, imports, and deploys the public XLB bridge proxy (`ai-gateway-v1`)
# and API Product / Developer App (`ai-economics-gateway-product` /
# `ai-economics-cli-app`) to a public-XLB-enabled Apigee X org (default:
# `jw-apigeex-0` / env: `eval`), fronting `apigee-ai-economics-bff` in
# `apac-cs-5g-demo5` via OIDC `<GoogleIDToken>`.
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROXY_DIR="${REPO_ROOT}/apigee/proxies/ai-gateway-xlb-bridge"
BUNDLE_ZIP="${PROXY_DIR}/ai-gateway-v1.zip"

XLB_APIGEE_ORG="${XLB_APIGEE_ORG:-jw-apigeex-0}"
XLB_APIGEE_ENV="${XLB_APIGEE_ENV:-eval}"
XLB_APIGEE_SA="${XLB_APIGEE_SA:-ai-gateway-sa@${XLB_APIGEE_ORG}.iam.gserviceaccount.com}"
XLB_PUBLIC_HOST="${XLB_PUBLIC_HOST:-https://eval-group.34-120-155-152.nip.io/v1/ai-economics}"
DEV_EMAIL="${DEV_EMAIL:-ashishau@google.com}"

echo "==> [1/3] Ensuring runtime SA (${XLB_APIGEE_SA}) has Cloud Run Invoker on apigee-ai-economics-bff..."
if ! gcloud iam service-accounts describe "${XLB_APIGEE_SA}" --project="${XLB_APIGEE_ORG}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "ai-gateway-sa" \
    --display-name="ai-gateway-sa" \
    --project="${XLB_APIGEE_ORG}"
fi

gcloud run services add-iam-policy-binding apigee-ai-economics-bff \
  --project=apac-cs-5g-demo5 \
  --region=australia-southeast1 \
  --member="serviceAccount:${XLB_APIGEE_SA}" \
  --role="roles/run.invoker" \
  --quiet >/dev/null

echo "==> [2/3] Packaging XLB bridge proxy bundle: ${BUNDLE_ZIP}"
rm -f "${BUNDLE_ZIP}"
(cd "${PROXY_DIR}" && zip -qr "${BUNDLE_ZIP}" apiproxy)

echo "==> [3/3] Importing & deploying ai-gateway-v1 + API Product/App to ${XLB_APIGEE_ORG}/${XLB_APIGEE_ENV}..."
PYTHONPATH=/usr/lib/google-cloud-sdk/lib:/usr/lib/google-cloud-sdk/lib/third_party \
  /usr/lib/google-cloud-sdk/platform/bundledpythonunix/bin/python3 - \
  "${BUNDLE_ZIP}" "${XLB_APIGEE_ORG}" "${XLB_APIGEE_ENV}" "${XLB_APIGEE_SA}" "${XLB_PUBLIC_HOST}" "${DEV_EMAIL}" <<'PY'
import sys
import time
from googlecloudsdk.core.credentials import store
from googlecloudsdk.core.credentials import requests as creds_requests

bundle_path, org, env, sa, public_url, dev_email = sys.argv[1:7]
store.LoadIfEnabled()
session = creds_requests.GetSession()
base = f"https://apigee.mtls.googleapis.com/v1/organizations/{org}"

# 1. Import & deploy proxy bundle
with open(bundle_path, "rb") as f:
    r = session.post(
        f"{base}/apis?name=ai-gateway-v1&action=import",
        files={"file": ("ai-gateway-v1.zip", f, "application/octet-stream")},
        timeout=30,
    )
if r.status_code != 200:
    print(f"ERROR importing bundle to {org}: {r.status_code} {r.text}")
    sys.exit(1)
rev = r.json()["revision"]
print(f"Imported revision {rev} to {org}.")

r_dep = session.post(
    f"{base}/environments/{env}/apis/ai-gateway-v1/revisions/{rev}/deployments?override=true&serviceAccount={sa}",
    timeout=30,
)
if r_dep.status_code != 200:
    print(f"ERROR deploying revision {rev}: {r_dep.status_code} {r_dep.text}")
    sys.exit(1)

status_url = f"{base}/environments/{env}/apis/ai-gateway-v1/revisions/{rev}/deployments"
for _ in range(40):
    st = session.get(status_url, timeout=15).json().get("state", "UNKNOWN")
    print(f"  [{org}/{env} rev {rev}] state = {st}")
    if st == "READY":
        break
    if st == "ERROR":
        print("ERROR:", session.get(status_url, timeout=15).json().get("errors"))
        sys.exit(1)
    time.sleep(3)

# 2. Ensure API Product, Developer, and Developer App exist
if session.get(f"{base}/apiproducts/ai-economics-gateway-product").status_code == 404:
    session.post(f"{base}/apiproducts", json={
        "name": "ai-economics-gateway-product",
        "displayName": "AI Economics & System 1-2 Gateway Product",
        "approvalType": "auto",
        "description": "Grants access to /v1/ai-economics",
        "environments": [env],
        "proxies": ["ai-gateway-v1"],
        "apiResources": ["/", "/**"],
    })
if session.get(f"{base}/developers/{dev_email}").status_code == 404:
    session.post(f"{base}/developers", json={
        "email": dev_email,
        "firstName": "Ashish",
        "lastName": "A",
        "userName": dev_email.split("@")[0],
    })
r_app = session.get(f"{base}/developers/{dev_email}/apps/ai-economics-cli-app")
if r_app.status_code == 404:
    r_app = session.post(f"{base}/developers/{dev_email}/apps", json={
        "name": "ai-economics-cli-app",
        "apiProducts": ["ai-economics-gateway-product"],
        "attributes": [{"name": "tier", "value": "gold"}],
    })
creds = r_app.json().get("credentials", [])
key_prefix = (creds[0].get("consumerKey", "")[:8] + "...") if creds else "none"
print(f"SUCCESS: {org}/{env} rev {rev} READY at {public_url} (App key prefix: {key_prefix})")
PY
