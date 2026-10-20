"""Optimization 3: FrugalGPT Model Routing & Sequential LLM Cascade (Chen, Zaharia, Zou, 2023 - arXiv:2305.05176)."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Literal, Optional

from app.config import DEFAULT_CASCADE_CONFIDENCE_THRESHOLD, MODEL_FLASH, MODEL_PRO
from app.models import TokenUsageBreakdown
from app.vertex_client import VertexAIClient

HIGH_COMPLEXITY_MARKERS: list[str] = [
    "formal verification",
    "tla+",
    "byzantine",
    "linearizability",
    "serializability",
    "serializable",
    "paxos",
    "raft",
    "two-phase commit",
    "2pc",
    "cap theorem",
    "pacelc",
    "impossibility",
    "prove that",
    "formal proof",
    "counterexample",
    "invariants",
    "split-brain",
    "quorum intersection",
    "active-active",
    "zero rpo",
    "rpo=0",
]

HEDGING_PHRASES: list[str] = [
    "i am not entirely sure",
    "cannot be formally guaranteed",
    "requires deeper formal analysis",
    "impossible to satisfy all",
    "conflicting constraints",
    "violates linearizability",
    "cannot simultaneously guarantee",
    "requires escalation",
    "[low_confidence]",
]


@dataclass
class RoutingDecision:
    """Initial tier routing decision before invoking Vertex AI."""

    decision: Literal["GEMINI_2_5_FLASH", "GEMINI_2_5_PRO"]
    target_model: str
    reason: str
    complexity_score: float
    complexity_signals: list[str]
    thinking_budget: int


@dataclass
class CascadeEvaluationResult:
    """Result of FrugalGPT generation scoring function g(q, f_L1(q)) and optional L2 escalation."""

    final_response_text: str
    final_model_used: str
    cascade_evaluated: bool
    escalated_to_pro: bool
    reliability_score: float
    reliability_threshold: float
    reliability_signals: dict[str, Any]
    escalation_reason: Optional[str]
    l1_response_preview: Optional[str]
    l1_usage: TokenUsageBreakdown
    l2_usage: Optional[TokenUsageBreakdown]
    l2_latency_ms: float


class FrugalGPTCascadeEngine:
    """Implements FrugalGPT's LLM router and generation scoring function g(q, f(q))."""

    def __init__(self, vertex_client: VertexAIClient) -> None:
        self._vertex = vertex_client

    @staticmethod
    def analyze_query_complexity(user_query: str, rag_context: str = "") -> tuple[float, list[str]]:
        """Compute a structural complexity score in [0.0, 1.0] and explainable signals."""
        q_lower = user_query.lower()
        signals: list[str] = []
        score = 0.15

        # 1. Check formal / distributed systems / multi-constraint markers
        matched_markers = [m for m in HIGH_COMPLEXITY_MARKERS if m in q_lower]
        if matched_markers:
            score += min(0.48, 0.14 * len(matched_markers))
            signals.append(f"Formal/distributed-systems reasoning markers ({', '.join(matched_markers[:4])})")

        # 2. Check multi-part questions or constraint enumerations
        question_marks = user_query.count("?")
        numbered_constraints = len(re.findall(r"(?:^|\s)(?:\(\d+\)|\d+\.|\[[a-z0-9]\])", user_query))
        if question_marks >= 2 or numbered_constraints >= 3:
            score += 0.20
            signals.append(f"Multi-constraint query structure ({numbered_constraints} constraints, {question_marks} questions)")

        # 3. Query length & analytical directives
        word_count = len(user_query.split())
        if word_count > 75:
            score += 0.12
            signals.append(f"High query density ({word_count} words)")

        if any(w in q_lower for w in ["trade-off", "contradiction", "edge case", "failure mode", "race condition"]):
            score += 0.15
            signals.append("Requires multi-hop failure-mode or contradiction analysis")

        if not signals:
            signals.append("Standard single-hop comprehension / policy lookup")

        return round(min(1.0, score), 3), signals

    def select_initial_model(self, user_query: str, rag_context: str, routing_enabled: bool) -> RoutingDecision:
        """Select L1 model in the FrugalGPT cascade.

        When routing_enabled is False, always routes to Gemini 2.5 Pro (baseline behavior).
        When routing_enabled is True, starts the FrugalGPT cascade at L1 (Gemini 2.5 Flash)
        so the generation scoring function g(q, f_L1(q)) can accept reliable Flash answers
        at ~76% lower token cost or escalate to L2 (Gemini 2.5 Pro) if g(q, f_L1(q)) < tau.
        """
        complexity_score, signals = self.analyze_query_complexity(user_query, rag_context)

        if not routing_enabled:
            return RoutingDecision(
                decision="GEMINI_2_5_PRO",
                target_model=MODEL_PRO,
                reason="Model routing disabled — sending directly to baseline model (Gemini 2.5 Pro).",
                complexity_score=complexity_score,
                complexity_signals=signals,
                thinking_budget=-1,  # Default dynamic thinking on Pro
            )

        # FrugalGPT Sequential Cascade always attempts L1 (Gemini 2.5 Flash) first,
        # adjusting Flash thinking budget slightly based on query complexity.
        thinking_budget = 0 if complexity_score < 0.55 else 64
        return RoutingDecision(
            decision="GEMINI_2_5_FLASH",
            target_model=MODEL_FLASH,
            reason=(
                f"FrugalGPT Cascade Stage L1: Routed to Gemini 2.5 Flash "
                f"(complexity={complexity_score:.2f}); post-generation scorer g(q, a) will verify reliability >= 0.80."
            ),
            complexity_score=complexity_score,
            complexity_signals=signals,
            thinking_budget=thinking_budget,
        )

    def evaluate_and_cascade(
        self,
        user_query: str,
        initial_model: str,
        vertex_response_raw: dict[str, Any],
        vertex_payload_sent: dict[str, Any],
        routing_enabled: bool,
        confidence_threshold: float = DEFAULT_CASCADE_CONFIDENCE_THRESHOLD,
        complexity_score: float = 0.2,
    ) -> CascadeEvaluationResult:
        """FrugalGPT Generation Scoring Function g(q, f_L1(q)) -> [0, 1] and L2 escalation."""
        l1_text, l1_usage = self._vertex.parse_vertex_response(vertex_response_raw, model=initial_model)

        # If routing wasn't enabled or initial call was already Gemini 2.5 Pro, no cascade needed
        if not routing_enabled or initial_model == MODEL_PRO:
            return CascadeEvaluationResult(
                final_response_text=l1_text,
                final_model_used=initial_model,
                cascade_evaluated=False,
                escalated_to_pro=False,
                reliability_score=1.0,
                reliability_threshold=confidence_threshold,
                reliability_signals={"mode": "direct_pro_no_cascade"},
                escalation_reason=None,
                l1_response_preview=None,
                l1_usage=l1_usage,
                l2_usage=None,
                l2_latency_ms=0.0,
            )

        # Compute FrugalGPT reliability score g(q, f_L1(q)) in [0, 1]
        candidates = vertex_response_raw.get("candidates", [{}])
        first_cand = candidates[0] if candidates else {}
        finish_reason = str(first_cand.get("finishReason", "STOP"))
        avg_logprobs = first_cand.get("avgLogprobs")

        # 1. Base score from token probability or completion state
        if isinstance(avg_logprobs, (int, float)):
            # Convert average logprob (typically in [-1.2, -0.01]) to [0, 1] probability proxy
            prob_proxy = math.exp(max(-2.5, min(0.0, float(avg_logprobs))))
            base_confidence = 0.55 + (0.43 * prob_proxy)
        else:
            base_confidence = 0.91 if finish_reason == "STOP" and len(l1_text.split()) >= 20 else 0.65

        # 2. Check for hedging / impossibility / unresolved constraint tension markers in L1 output
        text_lower = l1_text.lower()
        detected_hedges = [h for h in HEDGING_PHRASES if h in text_lower]
        hedge_penalty = min(0.22, 0.08 * len(detected_hedges))

        # 3. Check structural constraint & formal proof depth on high-complexity queries
        complexity_penalty = 0.0
        structural_notes: list[str] = []
        if complexity_score >= 0.70:
            # High-complexity multi-constraint distributed systems / formal proof queries require
            # rigorous invariant verification; penalize L1 Flash when complexity is >= 0.70
            has_formal_proof = any(
                kw in text_lower for kw in ["theorem", "q.e.d", "lemma", "formal invariant proof"]
            )
            if not has_formal_proof:
                complexity_penalty += 0.24
                structural_notes.append(
                    f"High query complexity ({complexity_score:.2f}) lacks formal invariant proof in L1 Flash output"
                )

        if finish_reason != "STOP":
            complexity_penalty += 0.25
            structural_notes.append(f"Non-STOP finishReason ({finish_reason})")

        g_score = round(max(0.10, min(0.99, base_confidence - hedge_penalty - complexity_penalty)), 3)

        signals: dict[str, Any] = {
            "base_confidence": round(base_confidence, 3),
            "avg_logprobs": round(float(avg_logprobs), 4) if isinstance(avg_logprobs, (int, float)) else "n/a",
            "finish_reason": finish_reason,
            "detected_uncertainty_markers": detected_hedges,
            "hedge_penalty": round(hedge_penalty, 3),
            "complexity_risk_penalty": round(complexity_penalty, 3),
            "structural_notes": structural_notes,
            "query_complexity_score": complexity_score,
        }

        if g_score >= confidence_threshold:
            return CascadeEvaluationResult(
                final_response_text=l1_text,
                final_model_used=MODEL_FLASH,
                cascade_evaluated=True,
                escalated_to_pro=False,
                reliability_score=g_score,
                reliability_threshold=confidence_threshold,
                reliability_signals=signals,
                escalation_reason=None,
                l1_response_preview=None,
                l1_usage=l1_usage,
                l2_usage=None,
                l2_latency_ms=0.0,
            )

        # g(q, f_L1(q)) < tau_1 -> Escalate to L2 (Gemini 2.5 Pro)!
        escalation_reasons: list[str] = []
        if structural_notes:
            escalation_reasons.extend(structural_notes)
        if detected_hedges:
            escalation_reasons.append(f"Uncertainty/constraint-conflict markers detected: {', '.join(detected_hedges[:2])}")
        if not escalation_reasons:
            escalation_reasons.append(
                f"FrugalGPT scorer g(q, f_L1(q)) = {g_score:.2f} below reliability threshold tau = {confidence_threshold:.2f}"
            )
        reason_str = "; ".join(escalation_reasons)

        # Prepare L2 payload: ensure maxOutputTokens (2048) exceeds thinkingBudget (256) so visible response is never truncated
        pro_payload = dict(vertex_payload_sent)
        gen_cfg = dict(pro_payload.get("generationConfig", {}))
        gen_cfg["maxOutputTokens"] = max(2048, int(gen_cfg.get("maxOutputTokens", 2048)))
        gen_cfg["thinkingConfig"] = {"thinkingBudget": 256}
        pro_payload["generationConfig"] = gen_cfg

        l2_text, l2_usage, _, l2_latency_ms = self._vertex.generate_content(
            payload=pro_payload,
            model=MODEL_PRO,
        )

        return CascadeEvaluationResult(
            final_response_text=l2_text,
            final_model_used=f"{MODEL_FLASH} -> {MODEL_PRO} (Cascaded)",
            cascade_evaluated=True,
            escalated_to_pro=True,
            reliability_score=g_score,
            reliability_threshold=confidence_threshold,
            reliability_signals=signals,
            escalation_reason=reason_str,
            l1_response_preview=l1_text[:450] + ("..." if len(l1_text) > 450 else ""),
            l1_usage=l1_usage,
            l2_usage=l2_usage,
            l2_latency_ms=l2_latency_ms,
        )
