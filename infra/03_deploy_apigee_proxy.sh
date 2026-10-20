#!/usr/bin/env bash
# ==============================================================================
# 03_deploy_apigee_proxy.sh
# Packages, uploads, and deploys the `ai-gateway-v1` API proxy to Apigee X:
#   - Primary Org: apac-cs-5g-demo5 (Region: australia-southeast1)
#   - Primary Env: demo (COMPREHENSIVE tier)
#   - Service Account: apigee-ai-gw-sa@apac-cs-5g-demo5.iam.gserviceaccount.com
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROXY_DIR="${REPO_ROOT}/apigee/proxies/ai-gateway-v1"
BUNDLE_ZIP="${PROXY_DIR}/ai-gateway-v1.zip"

APIGEE_ORG="${APIGEE_ORG:-apac-cs-5g-demo5}"
APIGEE_ENV="${APIGEE_ENV:-demo}"
APIGEE_SA="${APIGEE_SA:-apigee-ai-gw-sa@apac-cs-5g-demo5.iam.gserviceaccount.com}"
APIGEE_HOST="${APIGEE_HOST:-https://10.106.240.2.nip.io/v1/ai-economics}"

echo "==> [1/2] Packaging Apigee proxy bundle: ${BUNDLE_ZIP}"
rm -f "${BUNDLE_ZIP}"
(cd "${PROXY_DIR}" && zip -qr "${BUNDLE_ZIP}" apiproxy)
ls -lh "${BUNDLE_ZIP}"

echo "==> [2/2] Importing & deploying ai-gateway-v1 to Apigee X (${APIGEE_ORG}/${APIGEE_ENV})..."
PYTHONPATH=/usr/lib/google-cloud-sdk/lib:/usr/lib/google-cloud-sdk/lib/third_party \
  /usr/lib/google-cloud-sdk/platform/bundledpythonunix/bin/python3 - \
  "${BUNDLE_ZIP}" "${APIGEE_ORG}" "${APIGEE_ENV}" "${APIGEE_SA}" "${APIGEE_HOST}" <<'PY'
import sys
import time
from googlecloudsdk.core.credentials import store
from googlecloudsdk.core.credentials import requests as creds_requests

bundle_path, org, env, sa, public_url = sys.argv[1:6]
store.LoadIfEnabled()
session = creds_requests.GetSession()

# Ensure demo-group has 10.106.240.2.nip.io and 107.178.247.6.nip.io
if org == "apac-cs-5g-demo5":
    eg_url = f"https://apigee.mtls.googleapis.com/v1/organizations/{org}/envgroups/demo-group"
    eg = session.get(eg_url).json()
    desired_hosts = ["10.106.240.2.nip.io", "107.178.247.6.nip.io"]
    current_hosts = eg.get("hostnames", [])
    if set(desired_hosts) - set(current_hosts):
        eg["hostnames"] = list(dict.fromkeys(current_hosts + desired_hosts))
        session.patch(f"{eg_url}?updateMask=hostnames", json=eg)
        print(f"Updated demo-group hostnames: {eg['hostnames']}")

print(f"--- Deploying to Org: {org} (Env: {env}, SA: {sa}) ---")

# 1. Import bundle
import_url = f"https://apigee.mtls.googleapis.com/v1/organizations/{org}/apis?name=ai-gateway-v1&action=import"
with open(bundle_path, "rb") as f:
    files = {"file": ("ai-gateway-v1.zip", f, "application/octet-stream")}
    r = session.post(import_url, files=files, timeout=30)
if r.status_code != 200:
    print(f"ERROR importing bundle to {org}: {r.status_code} {r.text}")
    sys.exit(1)
rev = r.json()["revision"]
print(f"Imported revision {rev} to {org}.")

# 2. Deploy revision
deploy_url = (
    f"https://apigee.mtls.googleapis.com/v1/organizations/{org}/environments/{env}"
    f"/apis/ai-gateway-v1/revisions/{rev}/deployments?override=true&serviceAccount={sa}"
)
r_dep = session.post(deploy_url, timeout=30)
if r_dep.status_code != 200:
    print(f"ERROR deploying revision {rev} to {org}/{env}: {r_dep.status_code} {r_dep.text}")
    sys.exit(1)
print(f"Triggered deployment of revision {rev} on {org}/{env} with SA {sa}.")

# 3. Poll deployment state until READY
status_url = (
    f"https://apigee.mtls.googleapis.com/v1/organizations/{org}/environments/{env}"
    f"/apis/ai-gateway-v1/revisions/{rev}/deployments"
)
for attempt in range(40):
    r_stat = session.get(status_url, timeout=15)
    state = r_stat.json().get("state", "UNKNOWN")
    print(f"  [{org}/{env} rev {rev}] state = {state}")
    if state == "READY":
        print(f"SUCCESS: {org}/{env} revision {rev} is READY at {public_url}")
        break
    elif state == "ERROR":
        print(f"ERROR deploying {org}/{env} rev {rev}: {r_stat.json().get('errors')}")
        sys.exit(1)
    time.sleep(3)
else:
    print(f"WARNING: Timed out waiting for READY state on {org}/{env} (last state: {state})")
    sys.exit(1)
PY
