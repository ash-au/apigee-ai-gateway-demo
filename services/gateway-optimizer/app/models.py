"""Pydantic v2 data models for the Apigee AI Gateway Optimizer service."""

from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


class OptimizationToggles(BaseModel):
    """Four independently togglable gateway-level optimizations."""

    semantic_cache: bool = Field(default=True, description="Enable FrugalGPT completion cache via Vertex embeddings")
    prompt_compression: bool = Field(default=True, description="Enable LLMLingua coarse-to-fine prompt compression")
    model_routing: bool = Field(default=True, description="Enable FrugalGPT model routing & cascade escalation")
    context_pruning: bool = Field(default=True, description="Enable multi-turn session deduplication & rolling summary")


class ChatMessage(BaseModel):
    """Single message turn in a conversation."""

    role: Literal["user", "model"] = "user"
    content: str


class TokenUsageBreakdown(BaseModel):
    """Exact token counts returned by Vertex AI usageMetadata."""

    model: str
    prompt_tokens: int = 0
    candidate_tokens: int = 0
    thinking_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0


class PreOptimizeRequest(BaseModel):
    """Incoming request from Apigee X ServiceCallout before calling Vertex AI."""

    session_id: str = Field(default="default-session")
    scenario_id: Optional[str] = Field(default=None)
    system_instruction: str = Field(default="")
    rag_context: str = Field(default="")
    few_shot_examples: list[str] = Field(default_factory=list)
    messages: list[ChatMessage] = Field(min_length=1)
    toggles: OptimizationToggles = Field(default_factory=OptimizationToggles)
    compression_target_ratio: float = Field(default=0.38, ge=0.15, le=0.90)
    similarity_threshold: float = Field(default=0.85, ge=0.70, le=0.99)


class PreOptimizeResponse(BaseModel):
    """Response returned to Apigee X PreFlow with optimized payload, routing, and telemetry."""

    # 1. Semantic Cache telemetry
    cache_hit: bool = False
    cache_similarity: Optional[float] = None
    cached_matched_query: Optional[str] = None
    cached_response_text: Optional[str] = None
    cached_model_used: Optional[str] = None
    embedding_tokens_used: int = 0
    embedding_cost_usd: float = 0.0
    embedding_latency_ms: float = 0.0

    # 2. Context Pruning / Session Dedup telemetry
    pruning_applied: bool = False
    turns_before_pruning: int = 0
    turns_after_pruning: int = 0
    tokens_before_pruning: int = 0
    tokens_after_pruning: int = 0
    pruning_summary_text: Optional[str] = None
    pruning_flash_input_tokens: int = 0
    pruning_flash_output_tokens: int = 0
    pruning_flash_thinking_tokens: int = 0
    pruning_overhead_cost_usd: float = 0.0
    pruning_latency_ms: float = 0.0

    # 3. LLMLingua Prompt Compression telemetry
    compression_applied: bool = False
    compression_method: str = "NONE"
    tokens_before_compression: int = 0
    tokens_after_compression: int = 0
    compression_ratio_achieved: float = 1.0
    budget_allocation: dict[str, Any] = Field(default_factory=dict)
    original_assembled_prompt: str = ""
    compressed_assembled_prompt: str = ""
    compression_latency_ms: float = 0.0

    # 4. FrugalGPT Model Routing decision
    routing_decision: Literal["CACHE_SHORT_CIRCUIT", "GEMINI_2_5_FLASH", "GEMINI_2_5_PRO"] = "GEMINI_2_5_PRO"
    target_model: str = "gemini-2.5-pro"
    routing_reason: str = ""
    complexity_score: float = 0.0
    complexity_signals: list[str] = Field(default_factory=list)

    # Prepared Vertex AI payload & target coordinates for Apigee
    vertex_target_host: str = "aiplatform.googleapis.com"
    vertex_target_path: str = ""
    vertex_payload: dict[str, Any] = Field(default_factory=dict)
    cache_namespace_key: str = ""
    extracted_user_query: str = ""


class CascadeEvaluateRequest(BaseModel):
    """Request from Apigee X PostFlow to score L1 (Flash) output and escalate to L2 (Pro) if needed."""

    session_id: str = "default-session"
    scenario_id: Optional[str] = None
    cache_namespace_key: str = ""
    user_query: str
    target_model_initial: str
    vertex_response_raw: dict[str, Any]
    vertex_payload_sent: dict[str, Any]
    toggles: OptimizationToggles
    confidence_threshold: float = 0.80
    pre_telemetry: dict[str, Any] = Field(default_factory=dict)


class CascadeEvaluateResponse(BaseModel):
    """Final response and complete auditable telemetry envelope returned through Apigee X."""

    final_response_text: str
    final_model_used: str
    cascade_evaluated: bool = False
    escalated_to_pro: bool = False
    reliability_score: float = 1.0
    reliability_threshold: float = 0.80
    reliability_signals: dict[str, Any] = Field(default_factory=dict)
    escalation_reason: Optional[str] = None
    l1_response_preview: Optional[str] = None
    l1_usage: TokenUsageBreakdown
    l2_usage: Optional[TokenUsageBreakdown] = None
    l2_latency_ms: float = 0.0
    cached_for_future: bool = False
