#!/usr/bin/env bash
# ==============================================================================
# Toggle Vertex AI Vector Search Node (SHARD_SIZE_MEDIUM) for Apigee Semantic Cache
# Usage:
#   ./infra/toggle_vector_search.sh status [--json]
#   ./infra/toggle_vector_search.sh on [--wait-create]
#   ./infra/toggle_vector_search.sh off
# ==============================================================================
set -euo pipefail

ACTION="${1:-status}"
FLAG="${2:-}"

export PROJECT_ID="${PROJECT_ID:-apac-cs-5g-demo5}"
export PROJECT_NUMBER="${PROJECT_NUMBER:-1019413155504}"
export REGION="${REGION:-australia-southeast1}"
export DEPLOYED_INDEX_ID="apigee_semantic_cache_deployed"

/usr/lib/google-cloud-sdk/platform/bundledpythonunix/bin/python3 - "${ACTION}" "${FLAG}" <<'PYEOF'
import sys
import os
import json
import time

sys.path.insert(0, "/usr/lib/google-cloud-sdk/lib/third_party")
sys.path.insert(0, "/usr/lib/google-cloud-sdk/lib")
from googlecloudsdk.core import properties
from googlecloudsdk.core.credentials import requests as creds_requests

properties.VALUES.context_aware.use_client_certificate.Set(True)
session = creds_requests.GetSession()

action = sys.argv[1].lower()
flag = sys.argv[2] if len(sys.argv) > 2 else ""

project_id = os.environ.get("PROJECT_ID", "apac-cs-5g-demo5")
project_num = os.environ.get("PROJECT_NUMBER", "1019413155504")
region = os.environ.get("REGION", "australia-southeast1")
deployed_index_id = os.environ.get("DEPLOYED_INDEX_ID", "apigee_semantic_cache_deployed")

ai_base = f"https://{region}-aiplatform.mtls.googleapis.com/v1/projects/{project_id}/locations/{region}"
ai_root = f"https://{region}-aiplatform.mtls.googleapis.com/v1"

KNOWN_INDEX_ID = "8419013310438965248"
KNOWN_ENDPOINT_ID = "3216599276826132480"

def get_state():
    idxs = session.get(f"{ai_base}/indexes").json().get("indexes", [])
    eps = session.get(f"{ai_base}/indexEndpoints").json().get("indexEndpoints", [])

    idx_obj = idxs[0] if idxs else None
    ep_obj = eps[0] if eps else None

    idx_name = idx_obj["name"] if idx_obj else f"projects/{project_num}/locations/{region}/indexes/{KNOWN_INDEX_ID}"
    ep_name = ep_obj["name"] if ep_obj else f"projects/{project_num}/locations/{region}/indexEndpoints/{KNOWN_ENDPOINT_ID}"

    public_domain = ep_obj.get("publicEndpointDomainName", "") if ep_obj else ""
    deployed_indexes = ep_obj.get("deployedIndexes", []) if ep_obj else []
    is_deployed = any(d.get("id") == deployed_index_id for d in deployed_indexes)

    # Check active operations if not yet visible or deploying
    ops_resp = session.get(f"{ai_base}/operations").json().get("operations", [])
    active_ops = [op for op in ops_resp if not op.get("done", False)]
    op_types = [op.get("metadata", {}).get("@type", "").split(".")[-1] for op in active_ops]

    if not idx_obj or not ep_obj:
        node_state = "PROVISIONING_INDEX"
        hourly_cost_usd = 0.0
    elif is_deployed:
        if "UndeployIndexOperationMetadata" in op_types:
            node_state = "SUSPENDING"
            hourly_cost_usd = 0.0
        else:
            node_state = "ACTIVE"
            hourly_cost_usd = 1.08
    else:
        if "DeployIndexOperationMetadata" in op_types:
            node_state = "DEPLOYING"
            hourly_cost_usd = 1.08
        else:
            node_state = "SUSPENDED"
            hourly_cost_usd = 0.0

    find_neighbors_url = (
        f"https://{public_domain}/v1/{ep_name}:findNeighbors"
        if public_domain else
        f"https://{region}-aiplatform.googleapis.com/v1/{ep_name}:findNeighbors"
    )
    upsert_url = f"https://{region}-aiplatform.googleapis.com/v1/{idx_name}:upsertDatapoints"

    return {
        "node_state": node_state,
        "shard_size": "SHARD_SIZE_MEDIUM",
        "machine_type": "e2-standard-16",
        "hourly_cost_usd": hourly_cost_usd,
        "index_exists": bool(idx_obj),
        "endpoint_exists": bool(ep_obj),
        "is_deployed": is_deployed,
        "deployed_index_id": deployed_index_id,
        "index_resource": idx_name,
        "endpoint_resource": ep_name,
        "public_endpoint_domain": public_domain,
        "find_neighbors_url": find_neighbors_url,
        "upsert_datapoints_url": upsert_url,
        "active_operations": op_types,
    }

state = get_state()

if action == "status":
    if flag == "--json":
        print(json.dumps(state, indent=2))
    else:
        print(f"=== Vertex AI Vector Search Status ({project_id} / {region}) ===")
        print(f"  State:              {state['node_state']}")
        print(f"  Shard / Machine:    {state['shard_size']} ({state['machine_type']})")
        print(f"  Est. Hourly Cost:   ${state['hourly_cost_usd']:.2f}/hr")
        print(f"  Index Resource:     {state['index_resource']} (Ready: {state['index_exists']})")
        print(f"  Endpoint Resource:  {state['endpoint_resource']} (Ready: {state['endpoint_exists']})")
        print(f"  Public Domain:      {state['public_endpoint_domain'] or '(pending)'}")
        print(f"  Deployed Index ID:  {state['deployed_index_id']} (Deployed: {state['is_deployed']})")
    sys.exit(0)

elif action in ("on", "deploy", "start", "wake"):
    if flag == "--wait-create":
        while not (state["index_exists"] and state["endpoint_exists"]):
            print(f"[wait-create] Waiting for Index (ready={state['index_exists']}) and IndexEndpoint (ready={state['endpoint_exists']}) creation to finish...")
            time.sleep(20)
            state = get_state()

    if not (state["index_exists"] and state["endpoint_exists"]):
        print(json.dumps({
            "status": "PROVISIONING_INDEX",
            "message": "Index or IndexEndpoint is still finishing initial creation in GCP. Run with --wait-create or retry in a few minutes.",
            "state": state
        }, indent=2))
        sys.exit(0)

    if state["is_deployed"] or state["node_state"] == "DEPLOYING":
        print(json.dumps({
            "status": state["node_state"],
            "message": f"Index '{deployed_index_id}' is already {state['node_state']}.",
            "state": state
        }, indent=2))
        sys.exit(0)

    deploy_payload = {
        "deployedIndex": {
            "id": deployed_index_id,
            "index": state["index_resource"],
            "displayName": deployed_index_id,
            "dedicatedResources": {
                "machineSpec": {
                    "machineType": "e2-standard-16"
                },
                "minReplicaCount": 1,
                "maxReplicaCount": 1
            }
        }
    }
    ep_name = state["endpoint_resource"]
    r = session.post(f"{ai_root}/{ep_name}:deployIndex", json=deploy_payload)
    print(json.dumps({
        "status": "DEPLOY_STARTED" if r.status_code == 200 else "ERROR",
        "http_status": r.status_code,
        "operation": r.json(),
        "state": get_state()
    }, indent=2))

elif action in ("off", "undeploy", "stop", "suspend"):
    if not state["endpoint_exists"] or not state["is_deployed"]:
        print(json.dumps({
            "status": "SUSPENDED",
            "message": "Vector Search node is already suspended ($0.00/hr).",
            "state": state
        }, indent=2))
        sys.exit(0)

    ep_name = state["endpoint_resource"]
    r = session.post(
        f"{ai_root}/{ep_name}:undeployIndex",
        json={"deployedIndexId": deployed_index_id}
    )
    print(json.dumps({
        "status": "SUSPEND_STARTED" if r.status_code == 200 else "ERROR",
        "http_status": r.status_code,
        "operation": r.json(),
        "state": get_state()
    }, indent=2))
else:
    print(f"Unknown action '{action}'. Use: status | on | off")
    sys.exit(1)
PYEOF
