"""Configuration and Vertex AI pricing constants for the Gateway Optimizer service."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelPricing:
    """Published Vertex AI pricing in USD per 1,000,000 tokens (<= 200k context tier)."""

    input_per_million: float
    output_per_million: float  # Applies to both candidatesTokenCount and thoughtsTokenCount

    def compute_cost(
        self,
        input_tokens: int,
        output_tokens: int,
        thinking_tokens: int = 0,
    ) -> float:
        """Compute exact USD cost from real Vertex AI token counts."""
        input_cost = (input_tokens / 1_000_000.0) * self.input_per_million
        output_cost = ((output_tokens + thinking_tokens) / 1_000_000.0) * self.output_per_million
        return round(input_cost + output_cost, 8)


PROJECT_ID: str = os.environ.get("GCP_PROJECT_ID", "apac-cs-5g-demo5")
REGION: str = os.environ.get("GCP_REGION", "australia-southeast1")
PRO_LOCATION: str = os.environ.get("VERTEX_PRO_LOCATION", "global")

MODEL_FLASH: str = "gemini-2.5-flash"
MODEL_PRO: str = "gemini-2.5-pro"
MODEL_EMBEDDING: str = "text-embedding-005"

PRICING: dict[str, ModelPricing] = {
    MODEL_PRO: ModelPricing(input_per_million=1.25, output_per_million=10.00),
    MODEL_FLASH: ModelPricing(input_per_million=0.30, output_per_million=2.50),
    MODEL_EMBEDDING: ModelPricing(input_per_million=0.025, output_per_million=0.0),
}

DEFAULT_SIMILARITY_THRESHOLD: float = 0.85
DEFAULT_CASCADE_CONFIDENCE_THRESHOLD: float = 0.80
COMPRESSION_MIN_TOKENS: int = 80

LLMLINGUA_MODEL_NAME: str = os.environ.get(
    "LLMLINGUA_MODEL_NAME",
    "microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank",
)
