"""FastAPI entrypoint for the Apigee X AI Gateway Optimizer service."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException

from app.cache import SemanticCacheEngine
from app.cascade import FrugalGPTCascadeEngine
from app.compressor import LLMLinguaCompressorEngine
from app.config import MODEL_PRO, PROJECT_ID, REGION
from app.models import (
    CascadeEvaluateRequest,
    CascadeEvaluateResponse,
    ChatMessage,
    PreOptimizeRequest,
    PreOptimizeResponse,
)
from app.pruner import ContextPrunerEngine
from app.vertex_client import VertexAIClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("gateway-optimizer")

vertex_client = VertexAIClient(project_id=PROJECT_ID, region=REGION)
cache_engine = SemanticCacheEngine(vertex_client=vertex_client)
pruner_engine = ContextPrunerEngine(vertex_client=vertex_client)
compressor_engine = LLMLinguaCompressorEngine(vertex_client=vertex_client)
cascade_engine = FrugalGPTCascadeEngine(vertex_client=vertex_client)

# Keep recent query embeddings by (namespace_key, user_query) to avoid re-embedding on post-call cache store
_recent_embeddings: dict[tuple[str, str], list[float]] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Warm up the LLMLingua model on startup so live demo requests have zero cold-load latency."""
    backend = compressor_engine.warmup()
    logger.info("Gateway Optimizer startup complete. Compression backend: %s", backend)
    yield


app = FastAPI(
    title="Apigee X AI Gateway Optimizer Engine",
    description="Operationalizes FrugalGPT (arXiv:2305.05176) and LLMLingua (arXiv:2310.05736) for Apigee X.",
    version="1.0.0",
    lifespan=lifespan,
)


def _build_vertex_payload(
    system_instruction: str,
    rag_context: str,
    few_shots: list[str],
    messages: list[ChatMessage],
    thinking_budget: int = 0,
) -> dict[str, Any]:
    """Construct a valid Vertex AI Gemini 2.5 generateContent JSON payload."""
    sys_parts: list[str] = []
    if system_instruction.strip():
        sys_parts.append(system_instruction.strip())
    if rag_context.strip():
        sys_parts.append(f"REFERENCE CONTEXT:\n{rag_context.strip()}")
    if few_shots:
        formatted_shots = "\n\n".join(f"Example {i + 1}:\n{s.strip()}" for i, s in enumerate(few_shots) if s.strip())
        if formatted_shots:
            sys_parts.append(f"DEMONSTRATION EXAMPLES:\n{formatted_shots}")

    contents: list[dict[str, Any]] = []
    for msg in messages:
        role = "model" if msg.role == "model" else "user"
        contents.append({"role": role, "parts": [{"text": msg.content}]})

    gen_config: dict[str, Any] = {
        "temperature": 0.1,
        "maxOutputTokens": 2048,
    }
    if thinking_budget >= 0:
        gen_config["thinkingConfig"] = {"thinkingBudget": thinking_budget}
    else:
        # Cap baseline Pro thinking budget at 256 tokens so live projector demos return in ~3s while still showing real thinking tokens
        gen_config["thinkingConfig"] = {"thinkingBudget": 256}

    payload: dict[str, Any] = {
        "contents": contents,
        "generationConfig": gen_config,
    }
    if sys_parts:
        payload["systemInstruction"] = {
            "parts": [{"text": "\n\n".join(sys_parts)}]
        }
    return payload


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    """Health check and engine status endpoint."""
    return {
        "status": "ok",
        "project_id": PROJECT_ID,
        "region": REGION,
        "compressor_backend": compressor_engine.warmup(),
        "semantic_cache": cache_engine.stats(),
    }


@app.post("/v1/state/reset")
def reset_state() -> dict[str, Any]:
    """Clear semantic cache and multi-turn session summary state."""
    removed_cache = cache_engine.clear()
    removed_summaries = pruner_engine.clear()
    _recent_embeddings.clear()
    return {
        "status": "reset",
        "semantic_cache_entries_cleared": removed_cache,
        "session_summaries_cleared": removed_summaries,
    }


@app.post("/v1/optimize/pre", response_model=PreOptimizeResponse)
def optimize_pre(req: PreOptimizeRequest) -> PreOptimizeResponse:
    """Execute Pre-LLM Gateway Optimizations:
    1. Semantic Cache Lookup (FrugalGPT Completion Cache)
    2. Multi-Turn Context Pruning & Session Dedup
    3. LLMLingua Coarse-to-Fine Prompt Compression
    4. FrugalGPT Initial Model Routing
    """
    try:
        user_query = req.messages[-1].content.strip()
        namespace_key = SemanticCacheEngine.build_namespace_key(
            scenario_id=req.scenario_id,
            system_instruction=req.system_instruction,
            rag_context=req.rag_context,
        )

        resp = PreOptimizeResponse(
            cache_namespace_key=namespace_key,
            extracted_user_query=user_query,
        )

        # ------------------------------------------------------------------
        # 1. Semantic Cache Lookup (only for single-turn or latest query in namespace)
        # ------------------------------------------------------------------
        if req.toggles.semantic_cache:
            lookup_res = cache_engine.lookup(
                namespace_key=namespace_key,
                user_query=user_query,
                threshold=req.similarity_threshold,
            )
            resp.embedding_tokens_used = lookup_res.embedding_tokens
            resp.embedding_cost_usd = lookup_res.embedding_cost_usd
            resp.embedding_latency_ms = lookup_res.latency_ms
            resp.cache_similarity = lookup_res.similarity
            resp.cached_matched_query = lookup_res.matched_query
            _recent_embeddings[(namespace_key, user_query)] = lookup_res.embedding_vector

            if lookup_res.hit and lookup_res.response_text is not None:
                resp.cache_hit = True
                resp.cached_response_text = lookup_res.response_text
                resp.cached_model_used = lookup_res.model_used
                resp.routing_decision = "CACHE_SHORT_CIRCUIT"
                resp.target_model = "semantic-cache (0 LLM tokens)"
                resp.routing_reason = (
                    f"Semantic Cache Hit (cosine similarity {lookup_res.similarity:.4f} >= "
                    f"threshold {req.similarity_threshold:.2f}). Short-circuiting Vertex AI call."
                )
                return resp

        # ------------------------------------------------------------------
        # 2. Multi-Turn Context Pruning / Session Deduplication
        # ------------------------------------------------------------------
        working_messages = list(req.messages)
        working_rag = req.rag_context

        if req.toggles.context_pruning:
            prune_res = pruner_engine.prune(
                session_id=req.session_id,
                messages=working_messages,
                rag_context=working_rag,
            )
            resp.pruning_applied = prune_res.applied
            resp.turns_before_pruning = prune_res.turns_before
            resp.turns_after_pruning = prune_res.turns_after
            resp.tokens_before_pruning = prune_res.tokens_before
            resp.tokens_after_pruning = prune_res.tokens_after
            resp.pruning_summary_text = prune_res.summary_text
            resp.pruning_flash_input_tokens = prune_res.flash_input_tokens
            resp.pruning_flash_output_tokens = prune_res.flash_output_tokens
            resp.pruning_flash_thinking_tokens = prune_res.flash_thinking_tokens
            resp.pruning_overhead_cost_usd = prune_res.overhead_cost_usd
            resp.pruning_latency_ms = prune_res.latency_ms
            working_messages = prune_res.pruned_messages
            working_rag = prune_res.deduplicated_rag_context
        else:
            resp.turns_before_pruning = len(working_messages)
            resp.turns_after_pruning = len(working_messages)

        # ------------------------------------------------------------------
        # 3. LLMLingua Coarse-to-Fine Prompt Compression
        # ------------------------------------------------------------------
        working_sys = req.system_instruction
        working_shots = list(req.few_shot_examples)

        if req.toggles.prompt_compression:
            comp_res = compressor_engine.compress(
                system_instruction=working_sys,
                rag_context=working_rag,
                few_shot_examples=working_shots,
                messages=working_messages,
                target_ratio=req.compression_target_ratio,
            )
            resp.compression_applied = comp_res.applied
            resp.compression_method = comp_res.method
            resp.tokens_before_compression = comp_res.tokens_before
            resp.tokens_after_compression = comp_res.tokens_after
            resp.compression_ratio_achieved = comp_res.ratio_achieved
            resp.budget_allocation = comp_res.budget_allocation
            resp.original_assembled_prompt = comp_res.original_prompt
            resp.compressed_assembled_prompt = comp_res.compressed_prompt
            resp.compression_latency_ms = comp_res.latency_ms
            if comp_res.applied:
                working_sys = comp_res.compressed_system_instruction
                working_rag = comp_res.compressed_rag_context
                working_shots = comp_res.compressed_few_shots
        else:
            raw_assembled = LLMLinguaCompressorEngine._assemble_full_prompt(
                system_instruction=working_sys,
                rag_context=working_rag,
                few_shots=working_shots,
                messages=working_messages,
            )
            tok_cnt = vertex_client.count_tokens(raw_assembled)
            resp.tokens_before_compression = tok_cnt
            resp.tokens_after_compression = tok_cnt
            resp.original_assembled_prompt = raw_assembled
            resp.compressed_assembled_prompt = raw_assembled

        # ------------------------------------------------------------------
        # 4. FrugalGPT Model Routing (L1 Selection)
        # ------------------------------------------------------------------
        route_res = cascade_engine.select_initial_model(
            user_query=user_query,
            rag_context=working_rag,
            routing_enabled=req.toggles.model_routing,
        )
        resp.routing_decision = route_res.decision
        resp.target_model = route_res.target_model
        resp.routing_reason = route_res.reason
        resp.complexity_score = route_res.complexity_score
        resp.complexity_signals = route_res.complexity_signals

        target_host, target_path = vertex_client.get_target_coordinates(route_res.target_model)
        resp.vertex_target_host = target_host
        resp.vertex_target_path = target_path
        resp.vertex_payload = _build_vertex_payload(
            system_instruction=working_sys,
            rag_context=working_rag,
            few_shots=working_shots,
            messages=working_messages,
            thinking_budget=route_res.thinking_budget,
        )
        return resp
    except Exception as exc:
        logger.exception("Pre-optimization error")
        raise HTTPException(status_code=500, detail=f"Pre-optimization failed: {exc}") from exc


@app.post("/v1/optimize/cascade", response_model=CascadeEvaluateResponse)
def optimize_cascade(req: CascadeEvaluateRequest) -> CascadeEvaluateResponse:
    """Evaluate L1 response reliability using FrugalGPT scorer g(q, f_L1(q)) and escalate to L2 Pro if needed."""
    try:
        complexity_score = float(req.pre_telemetry.get("complexity_score", 0.2))
        eval_res = cascade_engine.evaluate_and_cascade(
            user_query=req.user_query,
            initial_model=req.target_model_initial,
            vertex_response_raw=req.vertex_response_raw,
            vertex_payload_sent=req.vertex_payload_sent,
            routing_enabled=req.toggles.model_routing,
            confidence_threshold=req.confidence_threshold,
            complexity_score=complexity_score,
        )

        # Store final response in semantic cache so subsequent similar queries hit the cache
        cached_for_future = False
        if req.cache_namespace_key and eval_res.final_response_text:
            pre_emb = _recent_embeddings.get((req.cache_namespace_key, req.user_query.strip()))
            cache_engine.store(
                namespace_key=req.cache_namespace_key,
                user_query=req.user_query.strip(),
                response_text=eval_res.final_response_text,
                model_used=eval_res.final_model_used,
                precomputed_embedding=pre_emb,
            )
            cached_for_future = True

        return CascadeEvaluateResponse(
            final_response_text=eval_res.final_response_text,
            final_model_used=eval_res.final_model_used,
            cascade_evaluated=eval_res.cascade_evaluated,
            escalated_to_pro=eval_res.escalated_to_pro,
            reliability_score=eval_res.reliability_score,
            reliability_threshold=eval_res.reliability_threshold,
            reliability_signals=eval_res.reliability_signals,
            escalation_reason=eval_res.escalation_reason,
            l1_response_preview=eval_res.l1_response_preview,
            l1_usage=eval_res.l1_usage,
            l2_usage=eval_res.l2_usage,
            l2_latency_ms=eval_res.l2_latency_ms,
            cached_for_future=cached_for_future,
        )
    except Exception as exc:
        logger.exception("Cascade evaluation error")
        raise HTTPException(status_code=500, detail=f"Cascade evaluation failed: {exc}") from exc
