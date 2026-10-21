"""Tab 5: System 1 (TypeSafe Jev) & System 2 (Vertex AI Gemini) Dynamic Routing & SDE Cascade Engine."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

from app.config import MODEL_FLASH, MODEL_PRO, PRICING
from app.models import ChatMessage, TokenUsageBreakdown
from app.vertex_client import VertexAIClient

logger = logging.getLogger("gateway-optimizer.jev")

TYPESAFE_API_URL = "https://api.typesafe.ai/v1/systemone"
JEV_MODEL_DEFAULT = "jev-latest"
# Published Jev pricing: $0.042 per 1M input tokens ($42 / Btok), $0.00 output tokens
JEV_INPUT_PER_MILLION_USD = 0.042


class JevPreRouteRequest(BaseModel):
    """Request payload from Apigee X (SC-JevPreRoute) for Stage 1 System 1 Pre-Flight Routing."""

    session_id: str = "jev-demo-session"
    scenario_id: str = "jev-custom"
    system_instruction: str = ""
    rag_context: str = ""
    user_query: str
    confidence_threshold: float = Field(default=0.75, ge=0.0, le=1.0)
    fire_threshold: float = Field(default=0.70, ge=0.0, le=1.0)
    enable_direct_pro_fast_track: bool = True
    enable_post_verifier: bool = True
    simulate_l1_defect: bool = False


class JevVerifyCascadeRequest(BaseModel):
    """Request payload from Apigee X (SC-JevPostVerify) for Stage 2 System 1 Noul Battery Verification."""

    user_query: str
    system_instruction: str = ""
    rag_context: str = ""
    initial_model: str
    routing_decision: str
    vertex_response_raw: dict[str, Any]
    vertex_payload_sent: dict[str, Any]
    pre_route_telemetry: dict[str, Any] = Field(default_factory=dict)
    fire_threshold: float = Field(default=0.70, ge=0.0, le=1.0)
    enable_post_verifier: bool = True
    simulate_l1_defect: bool = False


class JevSystemOneEngine:
    """Executes TypeSafe Jev (System 1) primitives for confidence-gated routing and Noul battery verification."""

    def __init__(self, vertex_client: VertexAIClient) -> None:
        self._vertex = vertex_client
        self._http = httpx.Client(timeout=25.0)

    @staticmethod
    def _get_api_key() -> str:
        key = os.environ.get("TYPESAFE_API_KEY", "").strip()
        if not key:
            raise RuntimeError("TYPESAFE_API_KEY environment variable is not set on gateway-optimizer.")
        return key

    @staticmethod
    def compute_jev_cost(input_tokens: int) -> float:
        """Compute Jev USD cost ($0.042 / 1M input tokens, $0.00 output tokens)."""
        return round((input_tokens / 1_000_000.0) * JEV_INPUT_PER_MILLION_USD, 8)

    def _call_typesafe_system_one(
        self,
        state: dict[str, Any] | str,
        questions: dict[str, Any],
        model: str = JEV_MODEL_DEFAULT,
    ) -> tuple[dict[str, Any], float]:
        """Invoke POST https://api.typesafe.ai/v1/systemone and return (json_response, latency_ms)."""
        api_key = self._get_api_key()
        payload = {
            "model": model,
            "state": state,
            "questions": questions,
        }
        t0 = time.perf_counter()
        resp = self._http.post(
            TYPESAFE_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        if resp.status_code != 200:
            raise RuntimeError(f"TypeSafe Jev API returned HTTP {resp.status_code}: {resp.text[:400]}")
        return resp.json(), latency_ms

    def pre_route(self, req: JevPreRouteRequest) -> dict[str, Any]:
        """Stage 1: Evaluate incoming request with Jev Choice + Score + Noul primitives to select initial tier."""
        state_obj: dict[str, Any] = {
            "user_query": req.user_query,
        }
        if req.system_instruction.strip():
            state_obj["system_instruction"] = req.system_instruction.strip()
        if req.rag_context.strip():
            state_obj["rag_context_preview"] = req.rag_context.strip()[:2500]

        questions = {
            "target_tier": {
                "type": "choice",
                "instructions": "Which model tier is required to answer `user_query` accurately?",
                "criteria": {
                    "flash_fast": "Simple factual lookup, policy check, or straightforward single-hop question",
                    "flash_with_verifier": "Moderate multi-step synthesis, RAG extraction, or incident summarization",
                    "pro_system2_direct": "Formal distributed systems proof, deep mathematical/theoretical trade-off derivation, or complex multi-invariant reasoning",
                },
            },
            "complexity": {
                "type": "score",
                "instructions": "How intellectually demanding is `user_query` to answer accurately without errors?",
                "criteria": [
                    "Simple lookup, policy question, or standard procedure",
                    "Moderate multi-step synthesis, RAG extraction, or incident summarization",
                    "Deep formal proof, distributed consensus theory, or complex edge-case trade-off analysis",
                ],
            },
            "requires_formal_proof": {
                "type": "noul",
                "instructions": "Does `user_query` ask for a formal proof, theoretical trade-off derivation, or distributed consensus invariant analysis?",
            },
            "has_strict_multi_constraints": {
                "type": "noul",
                "instructions": "Does `user_query` contain multiple distinct constraints, fields, or sub-questions that must all be verified?",
            },
        }

        jev_raw, jev_latency_ms = self._call_typesafe_system_one(state=state_obj, questions=questions)
        answers = jev_raw.get("answers", {})
        usage = jev_raw.get("usage", {})
        input_tokens = int(usage.get("input_tokens", 0))
        output_tokens = int(usage.get("output_tokens", 0))
        jev_cost_usd = self.compute_jev_cost(input_tokens)

        tier_ans = answers.get("target_tier", {})
        tier_choice = str(tier_ans.get("choice", "flash_with_verifier"))
        tier_conf = float(tier_ans.get("confidence", 0.5))
        tier_probs = tier_ans.get("probabilities", {})

        comp_ans = answers.get("complexity", {})
        comp_score = float(comp_ans.get("score", 1.0))
        comp_conf = float(comp_ans.get("confidence", 0.5))
        comp_probs = comp_ans.get("probabilities", {})

        proof_noul = float((answers.get("requires_formal_proof") or {}).get("noul", 0.0))
        multi_noul = float((answers.get("has_strict_multi_constraints") or {}).get("noul", 0.0))

        # Two-Axis Confidence-Gated Routing Decision
        direct_to_pro = False
        if req.enable_direct_pro_fast_track and not req.simulate_l1_defect:
            if (tier_choice == "pro_system2_direct" and tier_conf >= req.confidence_threshold) or (
                comp_score >= 1.65 and comp_conf >= req.confidence_threshold
            ) or (proof_noul >= 0.82):
                direct_to_pro = True

        if direct_to_pro:
            routing_decision = "GEMINI_2_5_PRO"
            target_model = MODEL_PRO
            thinking_budget = 256
            routing_reason = (
                f"Jev System 1 Pre-Router selected Direct System 2 Fast-Track (choice='{tier_choice}' "
                f"with confidence={tier_conf:.2f} >= {req.confidence_threshold:.2f}, complexity={comp_score:.2f}/2.0, "
                f"requires_formal_proof={proof_noul:.2f}). Skipping L1 Flash to avoid wasted L1 latency & tokens."
            )
        else:
            routing_decision = "GEMINI_2_5_FLASH"
            target_model = MODEL_FLASH
            thinking_budget = 0 if (tier_choice == "flash_fast" and comp_score < 0.75) else 64
            if tier_conf < req.confidence_threshold:
                routing_reason = (
                    f"Jev System 1 Pre-Router confidence ({tier_conf:.2f}) is below gate ({req.confidence_threshold:.2f}) "
                    f"for choice='{tier_choice}'. Routing to L1 Gemini 2.5 Flash first with mandatory Post-Generation Noul Battery verification."
                )
            else:
                routing_reason = (
                    f"Jev System 1 Pre-Router routed to L1 Gemini 2.5 Flash (choice='{tier_choice}', "
                    f"confidence={tier_conf:.2f}, complexity={comp_score:.2f}/2.0, thinkingBudget={thinking_budget})."
                )

        # Build southbound Vertex AI payload
        sys_parts: list[str] = []
        if req.system_instruction.strip():
            sys_parts.append(req.system_instruction.strip())
        if req.rag_context.strip():
            sys_parts.append(f"REFERENCE CONTEXT:\n{req.rag_context.strip()}")

        vertex_payload: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": req.user_query.strip()}]}],
            "generationConfig": {
                "temperature": 0.1,
                "maxOutputTokens": 2048,
                "thinkingConfig": {"thinkingBudget": thinking_budget},
            },
        }
        if sys_parts:
            vertex_payload["systemInstruction"] = {"parts": [{"text": "\n\n".join(sys_parts)}]}

        return {
            "routing_decision": routing_decision,
            "target_model": target_model,
            "direct_to_pro": direct_to_pro,
            "thinking_budget": thinking_budget,
            "routing_reason": routing_reason,
            "jev_pre_route": {
                "model": jev_raw.get("model", JEV_MODEL_DEFAULT),
                "latency_ms": jev_latency_ms,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_usd": jev_cost_usd,
                "confidence_threshold": req.confidence_threshold,
                "target_tier": {
                    "choice": tier_choice,
                    "confidence": round(tier_conf, 4),
                    "probabilities": tier_probs,
                },
                "complexity": {
                    "score": round(comp_score, 4),
                    "confidence": round(comp_conf, 4),
                    "probabilities": comp_probs,
                },
                "pre_nouls": {
                    "requires_formal_proof": round(proof_noul, 4),
                    "has_strict_multi_constraints": round(multi_noul, 4),
                },
                "questions_sent": questions,
            },
            "vertex_payload": vertex_payload,
        }

    def verify_and_cascade(self, req: JevVerifyCascadeRequest) -> dict[str, Any]:
        """Stage 2: Verify L1 Flash completion using a Decomposed Jev Noul Battery & escalate to L2 Pro if any flag fires."""
        l1_text, l1_usage = self._vertex.parse_vertex_response(
            req.vertex_response_raw,
            model=req.initial_model,
        )

        # If Stage 1 already routed directly to System 2 (Gemini 2.5 Pro), no post-verification cascade needed
        if req.initial_model == MODEL_PRO or req.routing_decision == "GEMINI_2_5_PRO":
            return {
                "final_response_text": l1_text,
                "final_model_used": f"{MODEL_PRO} (Direct System 2 Fast-Track via Jev)",
                "route_path": "Jev Pre-Router -> Direct Gemini 2.5 Pro (Skipped L1 Flash)",
                "direct_to_pro": True,
                "post_verifier_executed": False,
                "escalated_to_pro": False,
                "escalation_reason": None,
                "l1_response_preview": None,
                "l1_usage": None,
                "l2_usage": l1_usage.model_dump(),
                "l2_latency_ms": 0.0,
                "jev_post_verify": None,
            }

        # Optional deterministic simulation of a subtle L1 Flash hallucination/omission for live demos
        candidate_text_for_verification = l1_text
        simulated_defect_note = None
        if req.simulate_l1_defect:
            candidate_text_for_verification = (
                "Based on the policy bulletin, Customer PII and PCI-DSS workloads can be deployed in "
                "us-central1 (Iowa) or asia-east1, and encryption keys are rotated every 365 days "
                "using standard Google-managed keys. (Note: Audit log retention period was not checked.)"
            )
            simulated_defect_note = (
                "Simulated subtle L1 fabrication injected: claims us-central1/asia-east1 & 365-day Google-managed keys "
                "(contradicting RAG context's australia-southeast1/2 & 90-day CMEK rule) and omits audit log retention."
            )

        if not req.enable_post_verifier:
            return {
                "final_response_text": candidate_text_for_verification,
                "final_model_used": MODEL_FLASH,
                "route_path": "Jev Pre-Router -> L1 Gemini 2.5 Flash (Verifier Disabled)",
                "direct_to_pro": False,
                "post_verifier_executed": False,
                "escalated_to_pro": False,
                "escalation_reason": None,
                "l1_response_preview": None,
                "l1_usage": l1_usage.model_dump(),
                "l2_usage": None,
                "l2_latency_ms": 0.0,
                "jev_post_verify": None,
            }

        # Build Decomposed Jev Noul Verifier Battery (following TypeSafe SDE Cascade pattern: True = defect/escalate)
        verify_state: dict[str, Any] = {
            "user_query": req.user_query,
            "l1_candidate_response": candidate_text_for_verification,
        }
        if req.system_instruction.strip():
            verify_state["system_instruction"] = req.system_instruction.strip()
        if req.rag_context.strip():
            verify_state["source_rag_context"] = req.rag_context.strip()

        verify_questions: dict[str, Any] = {
            "hallucinated_or_contradicts_context": {
                "type": "noul",
                "instructions": (
                    "Does `l1_candidate_response` state facts, regions, numbers, or policies that contradict "
                    "or are fabricated relative to `source_rag_context` (if `source_rag_context` is provided)?"
                ),
                "criteria": {
                    "true": "`l1_candidate_response` contradicts `source_rag_context` or states fabricated facts",
                    "false": "`l1_candidate_response` is factually consistent with `source_rag_context`",
                },
            },
            "missed_user_constraint": {
                "type": "noul",
                "instructions": (
                    "Does `l1_candidate_response` fail to answer or omit any explicit question, constraint, "
                    "or required item asked for in `user_query`?"
                ),
                "criteria": {
                    "true": "`l1_candidate_response` omits or fails to answer part of `user_query`",
                    "false": "`l1_candidate_response` addresses every part of `user_query`",
                },
            },
            "superficial_or_unproven": {
                "type": "noul",
                "instructions": (
                    "Does `user_query` ask for a rigorous analysis, formal proof, or multi-part architectural "
                    "derivation that `l1_candidate_response` only answers superficially?"
                ),
                "criteria": {
                    "true": "`l1_candidate_response` is too shallow or superficial for `user_query`",
                    "false": "`l1_candidate_response` provides sufficient depth for `user_query`",
                },
            },
            "internal_contradiction": {
                "type": "noul",
                "instructions": "Does `l1_candidate_response` contradict itself or contain logically inconsistent statements?",
                "criteria": {
                    "true": "`l1_candidate_response` is internally contradictory",
                    "false": "`l1_candidate_response` is internally consistent",
                },
            },
            "hedging_or_refusal": {
                "type": "noul",
                "instructions": (
                    "Does `l1_candidate_response` hedge, express uncertainty, or state that it cannot verify "
                    "part of the request?"
                ),
                "criteria": {
                    "true": "`l1_candidate_response` hedges or states something was not checked/verified",
                    "false": "`l1_candidate_response` answers directly without hedging",
                },
            },
            "__overall__::holistic_escalate_judge": {
                "type": "noul",
                "instructions": (
                    "Holistic check: Is `l1_candidate_response` an inaccurate, ungrounded, or incomplete "
                    "response to `user_query` that should be escalated to a stronger reasoning model?"
                ),
            },
            "response_quality": {
                "type": "score",
                "instructions": "Rate the overall accuracy, completeness, and grounding of `l1_candidate_response`",
                "criteria": [
                    "Flawed, hallucinated, or misses explicit constraints in `user_query`",
                    "Partially complete or surface-level answer",
                    "Accurate, complete, and faithfully grounded in the context",
                ],
            },
        }

        jev_raw, jev_latency_ms = self._call_typesafe_system_one(
            state=verify_state,
            questions=verify_questions,
        )
        answers = jev_raw.get("answers", {})
        usage = jev_raw.get("usage", {})
        input_tokens = int(usage.get("input_tokens", 0))
        output_tokens = int(usage.get("output_tokens", 0))
        jev_cost_usd = self.compute_jev_cost(input_tokens)

        noul_battery: dict[str, float] = {}
        for k, v in answers.items():
            if isinstance(v, dict) and v.get("type") == "noul":
                noul_battery[k] = round(float(v.get("noul", 0.0)), 4)

        qual_ans = answers.get("response_quality", {})
        qual_score = round(float(qual_ans.get("score", 2.0)), 4)
        qual_conf = round(float(qual_ans.get("confidence", 0.5)), 4)

        # Gate on `any_flag` (max over per-defect Noul heads, excluding __overall__)
        fired_heads: dict[str, float] = {
            k: p
            for k, p in noul_battery.items()
            if not k.startswith("__overall__") and p > req.fire_threshold
        }
        per_defect_values = [
            p for k, p in noul_battery.items() if not k.startswith("__overall__")
        ]
        max_defect_noul = max(per_defect_values) if per_defect_values else 0.0
        escalate = bool(fired_heads)

        jev_verify_telemetry = {
            "model": jev_raw.get("model", JEV_MODEL_DEFAULT),
            "latency_ms": jev_latency_ms,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": jev_cost_usd,
            "fire_threshold": req.fire_threshold,
            "max_defect_noul": round(max_defect_noul, 4),
            "gate_decision": "ESCALATE_TO_SYSTEM_2_PRO" if escalate else "ACCEPT_SYSTEM_1_L1_FLASH",
            "fired_heads": fired_heads,
            "noul_battery": noul_battery,
            "response_quality": {
                "score": qual_score,
                "confidence": qual_conf,
                "probabilities": qual_ans.get("probabilities", {}),
            },
            "simulated_l1_defect_note": simulated_defect_note,
            "questions_sent": verify_questions,
        }

        if not escalate:
            return {
                "final_response_text": candidate_text_for_verification,
                "final_model_used": f"{MODEL_FLASH} (Verified by Jev Noul Battery)",
                "route_path": "Jev Pre-Router -> L1 Gemini 2.5 Flash -> Jev Noul Battery (ACCEPTED)",
                "direct_to_pro": False,
                "post_verifier_executed": True,
                "escalated_to_pro": False,
                "escalation_reason": None,
                "l1_response_preview": None,
                "l1_usage": l1_usage.model_dump(),
                "l2_usage": None,
                "l2_latency_ms": 0.0,
                "jev_post_verify": jev_verify_telemetry,
            }

        # Escalate to System 2 (Gemini 2.5 Pro)!
        fired_summary = ", ".join(
            f"{k}={v:.2f}" for k, v in sorted(fired_heads.items(), key=lambda x: -x[1])
        )
        escalation_reason = (
            f"Jev Noul Battery `any_flag` gate fired (> {req.fire_threshold:.2f}): {fired_summary}. "
            f"Escalating from L1 ({MODEL_FLASH}) to System 2 ({MODEL_PRO})."
        )

        pro_payload = dict(req.vertex_payload_sent)
        gen_cfg = dict(pro_payload.get("generationConfig", {}))
        gen_cfg["maxOutputTokens"] = max(2048, int(gen_cfg.get("maxOutputTokens", 2048)))
        gen_cfg["thinkingConfig"] = {"thinkingBudget": 256}
        pro_payload["generationConfig"] = gen_cfg

        l2_text, l2_usage, _, l2_latency_ms = self._vertex.generate_content(
            payload=pro_payload,
            model=MODEL_PRO,
        )

        return {
            "final_response_text": l2_text,
            "final_model_used": f"{MODEL_FLASH} -> {MODEL_PRO} (Jev SDE Cascade Escalated)",
            "route_path": "Jev Pre-Router -> L1 Flash -> Jev Noul Battery (FIRED) -> L2 Gemini 2.5 Pro",
            "direct_to_pro": False,
            "post_verifier_executed": True,
            "escalated_to_pro": True,
            "escalation_reason": escalation_reason,
            "l1_response_preview": candidate_text_for_verification[:500],
            "l1_usage": l1_usage.model_dump(),
            "l2_usage": l2_usage.model_dump(),
            "l2_latency_ms": l2_latency_ms,
            "jev_post_verify": jev_verify_telemetry,
        }
