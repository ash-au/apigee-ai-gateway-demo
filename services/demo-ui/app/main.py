"""FastAPI Side-by-Side BFF & Static Host for the Apigee X AI Economics Demo."""

import asyncio
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import google.auth
import google.auth.transport.requests
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.scenarios import PRESET_SCENARIOS, PRICING_SCHEDULE

GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "apac-cs-5g-demo5")
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

# Official Vertex AI Gemini 2.5 Pro pricing ($ per 1M tokens)
PRO_INPUT_PER_1M = 1.25
PRO_OUTPUT_PER_1M = 10.00  # applies to candidatesTokenCount + thoughtsTokenCount

app = FastAPI(
    title="Apigee X AI Gateway Economics Demo — BFF",
    version="1.0.0",
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
    system_instruction: str = ""
    rag_context: str = ""
    few_shot_examples: List[str] = Field(default_factory=list)
    conversation_history: List[TurnModel] = Field(default_factory=list)
    user_prompt: str
    toggles: TogglesModel = Field(default_factory=TogglesModel)
    compression_target_ratio: float = 0.38
    similarity_threshold: float = 0.85


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

    # Include full unpruned conversation history
    for turn in req.conversation_history:
        role = "model" if turn.role.lower() in ("model", "assistant") else "user"
        contents.append({"role": role, "parts": [{"text": turn.content}]})

    # Assemble the final user turn with full uncompressed RAG context and few-shot examples
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
async def compare_side_by_side(req: CompareRequest) -> Dict[str, Any]:
    """Executes Direct Vertex AI Gemini 2.5 Pro and Apigee X Gateway in parallel."""
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
