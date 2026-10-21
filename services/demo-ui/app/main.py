"""FastAPI Side-by-Side BFF & Static Host for the Apigee X AI Economics & Governance Demo."""

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import google.auth
import google.auth.transport.requests
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.policies_scenarios import (
    APIGEE_AI_POLICIES_CATALOG,
    POLICY_SCENARIOS,
    SYSTEM1_JEV_SCENARIOS,
)
from app.scenarios import PRESET_SCENARIOS, PRICING_SCHEDULE

GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "apac-cs-5g-demo5")
GCP_PROJECT_NUMBER = os.environ.get("GCP_PROJECT_NUMBER", "1019413155504")
GCP_REGION = os.environ.get("GCP_REGION", "australia-southeast1")
APIGEE_ORG = os.environ.get("APIGEE_ORG", "apac-cs-5g-demo5")
APIGEE_ENV = os.environ.get("APIGEE_ENV", "demo")
APIGEE_GATEWAY_URL = os.environ.get(
    "APIGEE_GATEWAY_URL",
    "https://10.106.240.2.nip.io/v1/ai-economics",
)
OPTIMIZER_SERVICE_URL = os.environ.get(
    "OPTIMIZER_SERVICE_URL",
    "https://gateway-optimizer-1019413155504.australia-southeast1.run.app",
)

# Valid Apigee Developer App Consumer Keys (x-api-key) provisioned in Apigee X
VALID_APIGEE_API_KEYS = {
    "bONZ6sXjJRnAyS5iUFxZIgSbySkl2mPqFNxOxy6ZN5kSMnwL",  # jw-apigeex-0 / eval (XLB)
    "PpSlCnhSuyVuLKDg2EA6VeQOddVLLPZjQ0doe1RW1BPt8n6E",  # apac-cs-5g-demo5 / demo
    "demo-gold-key",
    "demo-silver-key",
}

VECTOR_SEARCH_INDEX_ID = "8419013310438965248"
VECTOR_SEARCH_ENDPOINT_ID = "3216599276826132480"
VECTOR_SEARCH_DEPLOYED_ID = "apigee_semantic_cache_deployed"

# Official Vertex AI Gemini 2.5 Pro & Flash pricing ($ per 1M tokens)
PRO_INPUT_PER_1M = 1.25
PRO_OUTPUT_PER_1M = 10.00  # applies to candidatesTokenCount + thoughtsTokenCount
FLASH_INPUT_PER_1M = 0.30
FLASH_OUTPUT_PER_1M = 2.50

app = FastAPI(
    title="Apigee X AI Gateway Economics & Governance Demo — BFF",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TogglesModel(BaseModel):
    semantic_cache: bool = True
    prompt_compression: bool = True
    model_routing: bool = True
    context_pruning: bool = True


class TurnModel(BaseModel):
    role: str = "user"
    content: str


class CompareRequest(BaseModel):
    session_id: str = "demo-session"
    scenario_id: Optional[str] = None
    tier: Optional[str] = None
    system_instruction: str = ""
    rag_context: str = ""
    few_shot_examples: List[str] = Field(default_factory=list)
    conversation_history: List[TurnModel] = Field(default_factory=list)
    user_prompt: str = ""
    toggles: Optional[TogglesModel] = None
    compression_target_ratio: float = 0.55
    similarity_threshold: float = 0.85


class PolicyExecuteRequest(BaseModel):
    flow_group: str = Field(
        ...,
        description="One of: token-governance | model-armor | semantic-governance | native-cache",
    )
    prompt: str = ""
    scenario_id: Optional[str] = None
    prompt_token_limit: str = "250pm"
    quota_limit: int = 500
    quota_id: str = "tier-standard-app"
    enable_prompt_limit: bool = True
    enable_token_quota: bool = True
    enable_sanitize_prompt: bool = True
    enable_sanitize_response: bool = True
    enable_semantic_governance: bool = True
    enable_native_cache: bool = True


class VectorSearchToggleRequest(BaseModel):
    action: str = Field(..., description="on | off")


class System1ExecuteRequest(BaseModel):
    session_id: str = "jev-demo-session"
    scenario_id: str = "jev-custom"
    system_instruction: str = ""
    rag_context: str = ""
    user_query: str = ""
    prompt: str = ""
    confidence_threshold: Optional[float] = None
    fire_threshold: Optional[float] = None
    enable_direct_pro_fast_track: Optional[bool] = None
    enable_post_verifier: Optional[bool] = None
    simulate_l1_defect: Optional[bool] = None


def _require_apigee_api_key(request: Request) -> str:
    """Validates x-api-key header (or apikey query param) on direct gateway pass-through endpoints."""
    key = (
        request.headers.get("x-api-key")
        or request.headers.get("apikey")
        or request.query_params.get("apikey")
        or ""
    ).strip()
    if not key or key not in VALID_APIGEE_API_KEYS:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "invalid_api_key",
                "message": "Missing or invalid 'x-api-key' header for Apigee X AI Gateway.",
                "hint": "Pass header: -H 'x-api-key: <YOUR_APIGEE_CONSUMER_KEY>'",
            },
        )
    return key


def _hydrate_system1_request(req: System1ExecuteRequest) -> System1ExecuteRequest:
    """Hydrates preset fields from SYSTEM1_JEV_SCENARIOS when caller passes only scenario_id."""
    preset = next(
        (s for s in SYSTEM1_JEV_SCENARIOS if s["id"] == req.scenario_id),
        None,
    )
    query = (req.user_query or req.prompt or (preset["user_query"] if preset else "")).strip()
    if not query:
        query = "According to policy SEC-2026-09, what is the rotation period for Cloud KMS symmetric keys and production service account keys?"
    return System1ExecuteRequest(
        session_id=req.session_id,
        scenario_id=req.scenario_id,
        system_instruction=req.system_instruction or (preset.get("system_instruction", "") if preset else ""),
        rag_context=req.rag_context or (preset.get("rag_context", "") if preset else ""),
        user_query=query,
        confidence_threshold=req.confidence_threshold if req.confidence_threshold is not None else (preset.get("confidence_threshold", 0.75) if preset else 0.75),
        fire_threshold=req.fire_threshold if req.fire_threshold is not None else (preset.get("fire_threshold", 0.70) if preset else 0.70),
        enable_direct_pro_fast_track=req.enable_direct_pro_fast_track if req.enable_direct_pro_fast_track is not None else (preset.get("enable_direct_pro_fast_track", True) if preset else True),
        enable_post_verifier=req.enable_post_verifier if req.enable_post_verifier is not None else (preset.get("enable_post_verifier", True) if preset else True),
        simulate_l1_defect=req.simulate_l1_defect if req.simulate_l1_defect is not None else (preset.get("simulate_l1_defect", False) if preset else False),
    )


def _hydrate_compare_request(req: CompareRequest) -> CompareRequest:
    """Hydrates preset fields from PRESET_SCENARIOS when caller passes only scenario_id."""
    alias_map = {
        "s1_cache_burst": "scenario-1-faq-miss",
        "s1_cache_hit": "scenario-2-faq-hit",
        "s2_rag_compression": "scenario-3-rag-compress",
        "s3_cascade": "scenario-4-cascade-pro",
        "s4_agent_prune": "scenario-5-multi-turn-prune",
    }
    lookup_id = alias_map.get(req.scenario_id or "", req.scenario_id or "")
    preset = next(
        (
            s
            for s in PRESET_SCENARIOS
            if s["id"] == lookup_id or s.get("scenario_id") == lookup_id
        ),
        PRESET_SCENARIOS[0] if not req.user_prompt else None,
    )
    toggles = req.toggles or (
        TogglesModel(**preset["recommended_toggles"])
        if preset and "recommended_toggles" in preset
        else TogglesModel()
    )
    history = req.conversation_history or (
        [TurnModel(**t) for t in preset.get("conversation_history", [])]
        if preset
        else []
    )
    return CompareRequest(
        session_id=req.session_id if req.session_id != "demo-session" or not preset else preset.get("session_id", req.session_id),
        scenario_id=(preset.get("scenario_id") if preset else req.scenario_id) or "custom",
        system_instruction=req.system_instruction or (preset.get("system_instruction", "") if preset else ""),
        rag_context=req.rag_context or (preset.get("rag_context", "") if preset else ""),
        few_shot_examples=req.few_shot_examples or (preset.get("few_shot_examples", []) if preset else []),
        conversation_history=history,
        user_prompt=req.user_prompt or (preset.get("user_prompt", "") if preset else "How do I enroll a replacement iPhone in Okta FastPass MFA?"),
        toggles=toggles,
        compression_target_ratio=req.compression_target_ratio,
        similarity_threshold=req.similarity_threshold,
    )



_creds = None
_auth_req = None


def _get_gcp_access_token() -> str:
    global _creds, _auth_req
    if _creds is None:
        _creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        _auth_req = google.auth.transport.requests.Request()
    if not _creds.valid or _creds.expired or not _creds.token:
        _creds.refresh(_auth_req)
    return _creds.token


def _build_unoptimized_vertex_payload(req: CompareRequest) -> Dict[str, Any]:
    """Builds the unoptimized baseline payload sent directly to Vertex AI Gemini 2.5 Pro."""
    contents: List[Dict[str, Any]] = []

    for turn in req.conversation_history:
        role = "model" if turn.role.lower() in ("model", "assistant") else "user"
        contents.append({"role": role, "parts": [{"text": turn.content}]})

    user_sections: List[str] = []
    if req.rag_context and req.rag_context.strip():
        user_sections.append(f"### RETRIEVED CONTEXT\n{req.rag_context.strip()}")
    if req.few_shot_examples:
        joined_demos = "\n\n".join(
            f"Example {i + 1}:\n{ex.strip()}"
            for i, ex in enumerate(req.few_shot_examples)
            if ex.strip()
        )
        if joined_demos:
            user_sections.append(f"### FEW-SHOT EXAMPLES\n{joined_demos}")
    user_sections.append(f"### USER QUERY\n{req.user_prompt.strip()}")

    contents.append({"role": "user", "parts": [{"text": "\n\n".join(user_sections)}]})

    payload: Dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048,
            "thinkingConfig": {"thinkingBudget": 256},
        },
    }
    if req.system_instruction and req.system_instruction.strip():
        payload["systemInstruction"] = {
            "parts": [{"text": req.system_instruction.strip()}]
        }
    return payload


async def _call_direct_vertex_pro(req: CompareRequest) -> Dict[str, Any]:
    """Calls Vertex AI Gemini 2.5 Pro directly without Apigee X or any gateway optimizations."""
    t0 = time.perf_counter()
    token = await asyncio.to_thread(_get_gcp_access_token)
    url = (
        f"https://aiplatform.googleapis.com/v1/projects/{GCP_PROJECT_ID}"
        f"/locations/global/publishers/google/models/gemini-2.5-pro:generateContent"
    )
    payload = _build_unoptimized_vertex_payload(req)

    async with httpx.AsyncClient(timeout=95.0) as client:
        resp = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    latency_ms = round((time.perf_counter() - t0) * 1000.0)
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Direct Vertex AI Gemini 2.5 Pro call failed ({resp.status_code}): {resp.text[:500]}",
        )

    data = resp.json()
    candidates = data.get("candidates") or []
    response_text = ""
    finish_reason = "UNKNOWN"
    if candidates:
        finish_reason = candidates[0].get("finishReason", "STOP")
        parts = (candidates[0].get("content") or {}).get("parts") or []
        response_text = "".join(p.get("text", "") for p in parts if "text" in p)

    usage = data.get("usageMetadata") or {}
    prompt_tokens = int(usage.get("promptTokenCount", 0))
    candidate_tokens = int(usage.get("candidatesTokenCount", 0))
    thinking_tokens = int(usage.get("thoughtsTokenCount", 0))
    total_tokens = int(
        usage.get("totalTokenCount", prompt_tokens + candidate_tokens + thinking_tokens)
    )

    input_cost_usd = (prompt_tokens / 1_000_000.0) * PRO_INPUT_PER_1M
    output_cost_usd = (candidate_tokens / 1_000_000.0) * PRO_OUTPUT_PER_1M
    thinking_cost_usd = (thinking_tokens / 1_000_000.0) * PRO_OUTPUT_PER_1M
    total_cost_usd = round(input_cost_usd + output_cost_usd + thinking_cost_usd, 8)

    return {
        "mode": "Direct to Vertex AI (No Gateway)",
        "endpoint": "aiplatform.googleapis.com (gemini-2.5-pro)",
        "model_used": "gemini-2.5-pro",
        "finish_reason": finish_reason,
        "latency_ms": latency_ms,
        "response_text": response_text,
        "token_accounting": {
            "prompt_tokens": prompt_tokens,
            "candidate_tokens": candidate_tokens,
            "thinking_tokens": thinking_tokens,
            "total_llm_tokens": total_tokens,
            "grand_total_billed_tokens": total_tokens,
        },
        "cost_accounting": {
            "input_cost_usd": round(input_cost_usd, 8),
            "output_cost_usd": round(output_cost_usd, 8),
            "thinking_cost_usd": round(thinking_cost_usd, 8),
            "total_cost_usd": total_cost_usd,
        },
        "raw_usage_metadata": usage,
    }


async def _call_apigee_gateway(req: CompareRequest) -> Dict[str, Any]:
    """Calls the live Apigee X AI Economics proxy (`POST /v1/ai-economics/chat`)."""
    t0 = time.perf_counter()
    req_headers = {
        "Content-Type": "application/json",
        "X-Opt-Cache": str(req.toggles.semantic_cache).lower(),
        "X-Opt-Compress": str(req.toggles.prompt_compression).lower(),
        "X-Opt-Route": str(req.toggles.model_routing).lower(),
        "X-Opt-Prune": str(req.toggles.context_pruning).lower(),
        "X-Session-Id": req.session_id,
    }
    if req.scenario_id:
        req_headers["X-Scenario-Id"] = req.scenario_id

    body = {
        "session_id": req.session_id,
        "scenario_id": req.scenario_id,
        "system_instruction": req.system_instruction,
        "rag_context": req.rag_context,
        "few_shot_examples": req.few_shot_examples,
        "conversation_history": [t.model_dump() for t in req.conversation_history],
        "user_prompt": req.user_prompt,
        "toggles": req.toggles.model_dump(),
        "compression_target_ratio": req.compression_target_ratio,
        "similarity_threshold": req.similarity_threshold,
    }

    async with httpx.AsyncClient(timeout=95.0, verify=False) as client:
        resp = await client.post(
            f"{APIGEE_GATEWAY_URL}/chat",
            headers=req_headers,
            json=body,
        )

    client_observed_latency_ms = round((time.perf_counter() - t0) * 1000.0)
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Apigee X proxy call failed ({resp.status_code}): {resp.text[:500]}",
        )

    envelope = resp.json()
    apigee_headers = {
        k: v
        for k, v in resp.headers.items()
        if k.lower().startswith("x-ai-gateway-")
        or k.lower() in ("x-request-id", "via", "date")
    }
    envelope["client_observed_latency_ms"] = client_observed_latency_ms
    envelope["request_headers_sent"] = req_headers
    envelope["response_headers_received"] = apigee_headers
    envelope["apigee_proxy_url"] = f"{APIGEE_GATEWAY_URL}/chat ({APIGEE_ORG} / env: {APIGEE_ENV})"
    envelope["apigee_org"] = APIGEE_ORG
    envelope["apigee_env"] = APIGEE_ENV
    return envelope


async def _call_direct_vertex_flash_raw(prompt: str) -> Dict[str, Any]:
    """Calls Vertex AI Gemini 2.5 Flash directly with zero gateway policies for baseline comparison."""
    t0 = time.perf_counter()
    token = await asyncio.to_thread(_get_gcp_access_token)
    url = (
        f"https://{GCP_REGION}-aiplatform.googleapis.com/v1/projects/{GCP_PROJECT_ID}"
        f"/locations/{GCP_REGION}/publishers/google/models/gemini-2.5-flash:generateContent"
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 512},
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    latency_ms = round((time.perf_counter() - t0) * 1000.0)
    if resp.status_code != 200:
        return {
            "status": "ERROR",
            "http_status_code": resp.status_code,
            "latency_ms": latency_ms,
            "response_text": resp.text[:400],
            "token_usage": {"prompt_tokens": 0, "candidate_tokens": 0, "thinking_tokens": 0, "total_tokens": 0},
            "cost_usd": 0.0,
        }

    data = resp.json()
    candidates = data.get("candidates") or []
    response_text = ""
    if candidates:
        parts = (candidates[0].get("content") or {}).get("parts") or []
        response_text = "".join(p.get("text", "") for p in parts if "text" in p)
    usage = data.get("usageMetadata") or {}
    prompt_tokens = int(usage.get("promptTokenCount", 0))
    candidate_tokens = int(usage.get("candidatesTokenCount", 0))
    thinking_tokens = int(usage.get("thoughtsTokenCount", 0))
    total_tokens = int(usage.get("totalTokenCount", prompt_tokens + candidate_tokens + thinking_tokens))
    cost_usd = round(
        (prompt_tokens / 1_000_000.0) * FLASH_INPUT_PER_1M
        + ((candidate_tokens + thinking_tokens) / 1_000_000.0) * FLASH_OUTPUT_PER_1M,
        8,
    )
    return {
        "status": "UNPROTECTED_EXECUTED",
        "http_status_code": 200,
        "mode": "Direct to Vertex AI (No Apigee Policies)",
        "model_used": "gemini-2.5-flash",
        "latency_ms": latency_ms,
        "response_text": response_text,
        "token_usage": {
            "prompt_tokens": prompt_tokens,
            "candidate_tokens": candidate_tokens,
            "thinking_tokens": thinking_tokens,
            "total_tokens": total_tokens,
        },
        "cost_usd": cost_usd,
    }


async def _call_apigee_native_policy_flow(req: PolicyExecuteRequest) -> Dict[str, Any]:
    """Calls the live Apigee X native AI policy flow (`/v1/ai-economics/policies/{req.flow_group}`)."""
    t0 = time.perf_counter()
    req_headers = {
        "Content-Type": "application/json",
        "X-Prompt-Token-Limit": req.prompt_token_limit,
        "X-Quota-Limit": str(req.quota_limit),
        "X-Quota-Interval": "1",
        "X-Quota-TimeUnit": "minute",
        "X-Quota-Id": req.quota_id,
        "X-Enable-Prompt-Limit": str(req.enable_prompt_limit).lower(),
        "X-Enable-Token-Quota": str(req.enable_token_quota).lower(),
        "X-Enable-Sanitize-Prompt": str(req.enable_sanitize_prompt).lower(),
        "X-Enable-Sanitize-Response": str(req.enable_sanitize_response).lower(),
        "X-Enable-Semantic-Governance": str(req.enable_semantic_governance).lower(),
        "X-Enable-Native-Cache": str(req.enable_native_cache).lower(),
    }
    vertex_payload = {
        "contents": [{"role": "user", "parts": [{"text": req.prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 512},
    }
    target_url = f"{APIGEE_GATEWAY_URL}/policies/{req.flow_group}"

    async with httpx.AsyncClient(timeout=65.0, verify=False) as client:
        resp = await client.post(
            target_url,
            headers=req_headers,
            json=vertex_payload,
        )

    client_latency_ms = round((time.perf_counter() - t0) * 1000.0)
    try:
        data = resp.json()
    except Exception:
        data = {
            "status": "BLOCKED_BY_APIGEE_POLICY" if resp.status_code >= 400 else "UNKNOWN",
            "blocked": resp.status_code >= 400,
            "http_status_code": resp.status_code,
            "raw_body": resp.text[:1000],
        }

    apigee_headers = {
        k: v
        for k, v in resp.headers.items()
        if k.lower().startswith("x-apigee-")
        or k.lower().startswith("x-ratelimit-")
        or k.lower() in ("x-request-id", "date")
    }
    token_usage = data.get("token_usage") or {
        "prompt_tokens": 0,
        "candidate_tokens": 0,
        "thinking_tokens": 0,
        "total_tokens": 0,
    }
    prompt_t = int(token_usage.get("prompt_tokens", 0))
    cand_t = int(token_usage.get("candidate_tokens", 0))
    think_t = int(token_usage.get("thinking_tokens", 0))
    cost_usd = round(
        (prompt_t / 1_000_000.0) * FLASH_INPUT_PER_1M
        + ((cand_t + think_t) / 1_000_000.0) * FLASH_OUTPUT_PER_1M,
        8,
    )
    data["http_status_code"] = resp.status_code
    data["client_observed_latency_ms"] = client_latency_ms
    data["cost_usd"] = cost_usd
    data["apigee_endpoint_called"] = f"{target_url} ({APIGEE_ORG} / env: {APIGEE_ENV})"
    data["request_headers_sent"] = req_headers
    data["response_headers_received"] = apigee_headers
    return data


async def _get_vector_search_state() -> Dict[str, Any]:
    """Queries Vertex AI in australia-southeast1 for live Vector Search Index & Endpoint state."""
    token = await asyncio.to_thread(_get_gcp_access_token)
    ai_base = (
        f"https://{GCP_REGION}-aiplatform.googleapis.com/v1/projects/{GCP_PROJECT_ID}"
        f"/locations/{GCP_REGION}"
    )
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=20.0) as client:
        r_idx, r_ep, r_ops = await asyncio.gather(
            client.get(f"{ai_base}/indexes", headers=headers),
            client.get(f"{ai_base}/indexEndpoints", headers=headers),
            client.get(f"{ai_base}/operations", headers=headers),
        )

    idxs = r_idx.json().get("indexes", []) if r_idx.status_code == 200 else []
    eps = r_ep.json().get("indexEndpoints", []) if r_ep.status_code == 200 else []
    ops = r_ops.json().get("operations", []) if r_ops.status_code == 200 else []

    idx_obj = idxs[0] if idxs else None
    ep_obj = eps[0] if eps else None

    idx_name = (
        idx_obj["name"]
        if idx_obj
        else f"projects/{GCP_PROJECT_NUMBER}/locations/{GCP_REGION}/indexes/{VECTOR_SEARCH_INDEX_ID}"
    )
    ep_name = (
        ep_obj["name"]
        if ep_obj
        else f"projects/{GCP_PROJECT_NUMBER}/locations/{GCP_REGION}/indexEndpoints/{VECTOR_SEARCH_ENDPOINT_ID}"
    )
    public_domain = ep_obj.get("publicEndpointDomainName", "") if ep_obj else ""
    deployed_indexes = ep_obj.get("deployedIndexes", []) if ep_obj else []
    is_deployed = any(d.get("id") == VECTOR_SEARCH_DEPLOYED_ID for d in deployed_indexes)

    active_ops = [op for op in ops if not op.get("done", False)]
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

    return {
        "node_state": node_state,
        "shard_size": "SHARD_SIZE_MEDIUM",
        "machine_type": "e2-standard-16",
        "hourly_cost_usd": hourly_cost_usd,
        "index_exists": bool(idx_obj),
        "endpoint_exists": bool(ep_obj),
        "is_deployed": is_deployed,
        "deployed_index_id": VECTOR_SEARCH_DEPLOYED_ID,
        "index_resource": idx_name,
        "endpoint_resource": ep_name,
        "public_endpoint_domain": public_domain,
        "active_operations": op_types,
        "cli_command_on": "./infra/toggle_vector_search.sh on",
        "cli_command_off": "./infra/toggle_vector_search.sh off",
        "cli_command_status": "./infra/toggle_vector_search.sh status",
    }


@app.get("/api/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "project_id": GCP_PROJECT_ID,
        "region": GCP_REGION,
        "apigee_org": APIGEE_ORG,
        "apigee_env": APIGEE_ENV,
        "apigee_gateway_url": APIGEE_GATEWAY_URL,
        "optimizer_service_url": OPTIMIZER_SERVICE_URL,
    }


@app.get("/api/scenarios")
async def get_scenarios() -> Dict[str, Any]:
    return {
        "apigee_org": APIGEE_ORG,
        "apigee_env": APIGEE_ENV,
        "apigee_gateway_url": f"{APIGEE_GATEWAY_URL} ({APIGEE_ORG} / env: {APIGEE_ENV})",
        "optimizer_service_url": OPTIMIZER_SERVICE_URL,
        "project_id": GCP_PROJECT_ID,
        "region": GCP_REGION,
        "pricing_schedule": PRICING_SCHEDULE,
        "scenarios": PRESET_SCENARIOS,
    }


@app.get("/api/policies/presets")
async def get_policies_presets() -> Dict[str, Any]:
    return {
        "apigee_org": APIGEE_ORG,
        "apigee_env": APIGEE_ENV,
        "apigee_gateway_url": APIGEE_GATEWAY_URL,
        "policies_catalog": APIGEE_AI_POLICIES_CATALOG,
        "policy_scenarios": POLICY_SCENARIOS,
        "system1_scenarios": SYSTEM1_JEV_SCENARIOS,
    }


@app.post("/api/policies/execute")
async def execute_policy_comparison(req: PolicyExecuteRequest) -> Dict[str, Any]:
    """Executes Direct Vertex AI (unprotected) and Apigee X Native AI Policy Flow in parallel."""
    direct_res, apigee_res = await asyncio.gather(
        _call_direct_vertex_flash_raw(req.prompt),
        _call_apigee_native_policy_flow(req),
    )
    return {
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "flow_group": req.flow_group,
        "direct_baseline": direct_res,
        "apigee_gateway": apigee_res,
    }


async def _call_apigee_system1_routing(req: System1ExecuteRequest) -> Dict[str, Any]:
    """Calls Apigee X System 1 (TypeSafe Jev) & System 2 Dynamic Routing flow (`POST /v1/ai-economics/system1-routing`)."""
    t0 = time.perf_counter()
    body = {
        "session_id": req.session_id,
        "scenario_id": req.scenario_id,
        "system_instruction": req.system_instruction,
        "rag_context": req.rag_context,
        "user_query": req.user_query,
        "confidence_threshold": req.confidence_threshold,
        "fire_threshold": req.fire_threshold,
        "enable_direct_pro_fast_track": req.enable_direct_pro_fast_track,
        "enable_post_verifier": req.enable_post_verifier,
        "simulate_l1_defect": req.simulate_l1_defect,
    }
    async with httpx.AsyncClient(timeout=110.0, verify=False) as client:
        resp = await client.post(
            f"{APIGEE_GATEWAY_URL}/system1-routing",
            headers={"Content-Type": "application/json"},
            json=body,
        )
    wall_ms = round((time.perf_counter() - t0) * 1000.0)
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Apigee X /system1-routing call failed ({resp.status_code}): {resp.text[:500]}",
        )
    data = resp.json()
    data["client_wall_latency_ms"] = wall_ms
    return data


@app.post("/api/system1/execute")
async def execute_system1_comparison(req: System1ExecuteRequest) -> Dict[str, Any]:
    """Executes Unoptimized Direct System 2 (`gemini-2.5-pro`) vs. Apigee X + System 1 (`Jev`) & System 2 (`Flash`/`Pro`) in parallel."""
    req = _hydrate_system1_request(req)
    compare_req = CompareRequest(
        session_id=req.session_id,
        scenario_id=req.scenario_id,
        system_instruction=req.system_instruction,
        rag_context=req.rag_context,
        user_prompt=req.user_query,
    )
    direct_res, apigee_res = await asyncio.gather(
        _call_direct_vertex_pro(compare_req),
        _call_apigee_system1_routing(req),
    )

    direct_cost = float(direct_res["cost_accounting"]["total_cost_usd"])
    gateway_cost = float(apigee_res["cost_accounting"]["total_cost_usd"])
    cost_saved_usd = round(direct_cost - gateway_cost, 8)
    cost_reduction_pct = (
        round((cost_saved_usd / direct_cost) * 100.0, 2) if direct_cost > 0 else 0.0
    )

    direct_tokens = int(direct_res["token_accounting"]["grand_total_billed_tokens"])
    gateway_llm_tokens = int(apigee_res["token_accounting"]["total_llm_tokens"])
    gateway_jev_tokens = int(apigee_res["token_accounting"]["total_jev_input_tokens"])

    return {
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "direct_baseline": direct_res,
        "apigee_gateway": apigee_res,
        "comparison": {
            "direct_cost_usd": direct_cost,
            "gateway_cost_usd": gateway_cost,
            "cost_saved_usd": cost_saved_usd,
            "cost_reduction_pct": cost_reduction_pct,
            "direct_total_tokens": direct_tokens,
            "gateway_llm_tokens": gateway_llm_tokens,
            "gateway_jev_input_tokens": gateway_jev_tokens,
            "direct_latency_ms": int(direct_res["latency_ms"]),
            "gateway_latency_ms": int(apigee_res.get("latency_ms", 0)),
        },
    }


@app.get("/api/vector-search/status")
async def vector_search_status() -> Dict[str, Any]:
    return await _get_vector_search_state()


@app.post("/api/vector-search/toggle")
async def vector_search_toggle(req: VectorSearchToggleRequest) -> Dict[str, Any]:
    state = await _get_vector_search_state()
    action = req.action.lower().strip()
    token = await asyncio.to_thread(_get_gcp_access_token)
    ai_root = f"https://{GCP_REGION}-aiplatform.googleapis.com/v1"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    if action in ("on", "deploy", "wake"):
        if not (state["index_exists"] and state["endpoint_exists"]):
            return {
                "status": "PROVISIONING_INDEX",
                "message": "Index or Endpoint is still finishing initial creation in GCP.",
                "state": state,
            }
        if state["is_deployed"] or state["node_state"] == "DEPLOYING":
            return {
                "status": state["node_state"],
                "message": f"Vector Search node is already {state['node_state']}.",
                "state": state,
            }
        deploy_payload = {
            "deployedIndex": {
                "id": VECTOR_SEARCH_DEPLOYED_ID,
                "index": state["index_resource"],
                "displayName": VECTOR_SEARCH_DEPLOYED_ID,
                "dedicatedResources": {
                    "machineSpec": {"machineType": "e2-standard-16"},
                    "minReplicaCount": 1,
                    "maxReplicaCount": 1,
                },
            }
        }
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(
                f"{ai_root}/{state['endpoint_resource']}:deployIndex",
                headers=headers,
                json=deploy_payload,
            )
        new_state = await _get_vector_search_state()
        return {
            "status": "DEPLOY_STARTED" if resp.status_code == 200 else "ERROR",
            "http_status": resp.status_code,
            "state": new_state,
        }

    elif action in ("off", "undeploy", "suspend"):
        if not state["is_deployed"]:
            return {
                "status": "SUSPENDED",
                "message": "Vector Search node is already suspended ($0.00/hr).",
                "state": state,
            }
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(
                f"{ai_root}/{state['endpoint_resource']}:undeployIndex",
                headers=headers,
                json={"deployedIndexId": VECTOR_SEARCH_DEPLOYED_ID},
            )
        new_state = await _get_vector_search_state()
        return {
            "status": "SUSPEND_STARTED" if resp.status_code == 200 else "ERROR",
            "http_status": resp.status_code,
            "state": new_state,
        }

    raise HTTPException(status_code=400, detail="Invalid action. Use 'on' or 'off'.")


@app.post("/api/reset")
async def reset_gateway() -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0, verify=False) as client:
        resp = await client.post(
            f"{APIGEE_GATEWAY_URL}/reset",
            headers={"Content-Type": "application/json"},
            json={},
        )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to reset Apigee gateway state: {resp.status_code} {resp.text}",
        )
    return resp.json()


@app.post("/api/compare")
@app.post("/api/demo/run")
async def compare_side_by_side(req: CompareRequest) -> Dict[str, Any]:
    """Executes Direct Vertex AI Gemini 2.5 Pro and Apigee X Gateway in parallel."""
    req = _hydrate_compare_request(req)
    direct_res, gateway_res = await asyncio.gather(
        _call_direct_vertex_pro(req),
        _call_apigee_gateway(req),
    )

    direct_tokens = int(direct_res["token_accounting"]["grand_total_billed_tokens"])
    gateway_tokens = int(gateway_res["token_accounting"]["grand_total_billed_tokens"])
    gateway_llm_only_tokens = int(gateway_res["token_accounting"]["total_llm_tokens"])

    direct_cost = float(direct_res["cost_accounting"]["total_cost_usd"])
    gateway_cost = float(gateway_res["cost_accounting"]["total_cost_usd"])

    tokens_saved = direct_tokens - gateway_tokens
    token_reduction_pct = (
        round((tokens_saved / direct_tokens) * 100.0, 2) if direct_tokens > 0 else 0.0
    )

    cost_saved_usd = round(direct_cost - gateway_cost, 8)
    cost_reduction_pct = (
        round((cost_saved_usd / direct_cost) * 100.0, 2) if direct_cost > 0 else 0.0
    )

    direct_latency = int(direct_res["latency_ms"])
    gateway_latency = int(gateway_res.get("latency_ms", 0))

    return {
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "direct_baseline": direct_res,
        "apigee_gateway": gateway_res,
        "comparison": {
            "direct_total_tokens": direct_tokens,
            "gateway_grand_total_tokens": gateway_tokens,
            "gateway_llm_tokens": gateway_llm_only_tokens,
            "tokens_saved": tokens_saved,
            "token_reduction_pct": token_reduction_pct,
            "direct_cost_usd": direct_cost,
            "gateway_cost_usd": gateway_cost,
            "cost_saved_usd": cost_saved_usd,
            "cost_reduction_pct": cost_reduction_pct,
            "direct_latency_ms": direct_latency,
            "gateway_latency_ms": gateway_latency,
            "latency_delta_ms": gateway_latency - direct_latency,
        },
    }


# ==============================================================================
# Direct Apigee X Gateway Pass-Through Endpoints (Protected by x-api-key)
# Allows external CLI / curl clients hitting the Public XLB to invoke the raw
# Apigee X Comprehensive runtime (`10.106.240.2.nip.io`) directly.
# ==============================================================================


@app.post("/system1-routing")
@app.post("/v1/ai-economics/system1-routing")
async def passthrough_system1_routing(
    req: System1ExecuteRequest, request: Request
) -> Dict[str, Any]:
    api_key = _require_apigee_api_key(request)
    hydrated = _hydrate_system1_request(req)
    res = await _call_apigee_system1_routing(hydrated)
    res["authenticated_via"] = "Apigee X Developer App Consumer Key (x-api-key)"
    res["consumer_key_prefix"] = f"{api_key[:8]}..."
    return res


@app.post("/policies/{flow_group}")
@app.post("/v1/ai-economics/policies/{flow_group}")
async def passthrough_native_policies(
    flow_group: str, request: Request
) -> JSONResponse:
    api_key = _require_apigee_api_key(request)
    raw_body = await request.json()
    # Accept either raw Vertex generateContent body (`contents`) or `{ "prompt": "..." }`
    if "contents" in raw_body:
        vertex_payload = raw_body
    else:
        prompt_text = raw_body.get("prompt") or "Explain our cloud key rotation policy."
        vertex_payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt_text}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 512},
        }
    forward_headers = {"Content-Type": "application/json", "x-api-key": api_key}
    for h in (
        "X-Prompt-Token-Limit",
        "X-Quota-Limit",
        "X-Quota-Interval",
        "X-Quota-TimeUnit",
        "X-Quota-Id",
        "X-Enable-Prompt-Limit",
        "X-Enable-Token-Quota",
        "X-Enable-Sanitize-Prompt",
        "X-Enable-Sanitize-Response",
        "X-Enable-Semantic-Governance",
        "X-Enable-Native-Cache",
    ):
        if h in request.headers:
            forward_headers[h] = request.headers[h]

    target_url = f"{APIGEE_GATEWAY_URL}/policies/{flow_group}"
    async with httpx.AsyncClient(timeout=65.0, verify=False) as client:
        resp = await client.post(target_url, headers=forward_headers, json=vertex_payload)
    try:
        data = resp.json()
    except Exception:
        data = {"status_code": resp.status_code, "raw_body": resp.text[:1000]}
    return JSONResponse(status_code=resp.status_code, content=data)


@app.post("/gateway/chat")
@app.post("/v1/ai-economics/chat")
async def passthrough_gateway_chat(
    req: CompareRequest, request: Request
) -> Dict[str, Any]:
    api_key = _require_apigee_api_key(request)
    hydrated = _hydrate_compare_request(req)
    res = await _call_apigee_gateway(hydrated)
    res["authenticated_via"] = "Apigee X Developer App Consumer Key (x-api-key)"
    res["consumer_key_prefix"] = f"{api_key[:8]}..."
    return res


STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets"), check_dir=False), name="assets")
    app.mount("/v1/ai-economics/assets", StaticFiles(directory=str(STATIC_DIR / "assets"), check_dir=False), name="apigee_assets")


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    target = STATIC_DIR / full_path
    if full_path and target.exists() and target.is_file():
        return FileResponse(str(target))
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse({"message": "Apigee X AI Economics BFF running."})
