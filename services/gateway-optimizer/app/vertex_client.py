"""Authenticated Vertex AI client for embeddings, token counting, and Gemini 2.5 calls."""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import google.auth
from google.auth.transport.requests import AuthorizedSession

from app.config import (
    MODEL_EMBEDDING,
    MODEL_FLASH,
    MODEL_PRO,
    PRICING,
    PRO_LOCATION,
    PROJECT_ID,
    REGION,
)
from app.models import TokenUsageBreakdown

logger = logging.getLogger(__name__)


class VertexAIClient:
    """Client for calling real Vertex AI endpoints using Service Account / ADC auth."""

    def __init__(self, project_id: str = PROJECT_ID, region: str = REGION, pro_location: str = PRO_LOCATION) -> None:
        self.project_id = project_id
        self.region = region
        self.pro_location = pro_location
        self._session: AuthorizedSession | Any | None = None
        self._use_mtls: bool = False

    def _get_session(self) -> Any:
        if self._session is not None:
            return self._session

        # When running inside Cloud Run (K_SERVICE is set), use standard Service Account ADC
        if os.environ.get("K_SERVICE") or not os.path.exists("/etc/gcloud/certificate_config.json"):
            credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            self._session = AuthorizedSession(credentials)
            self._use_mtls = False
            return self._session

        # Fallback for local Cloudtop execution where CBA/mTLS is enforced
        try:
            import sys
            for p in ("/usr/lib/google-cloud-sdk/lib", "/usr/lib/google-cloud-sdk/lib/third_party"):
                if os.path.exists(p) and p not in sys.path:
                    sys.path.insert(0, p)
            from googlecloudsdk.core.credentials import requests as creds_requests  # type: ignore
            from googlecloudsdk.core.credentials import store  # type: ignore

            store.LoadIfEnabled()
            self._session = creds_requests.GetSession()
            self._use_mtls = True
            return self._session
        except ImportError:
            credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            self._session = AuthorizedSession(credentials)
            self._use_mtls = False
            return self._session

    def _host_for_location(self, location: str) -> str:
        domain = "mtls.googleapis.com" if self._use_mtls else "googleapis.com"
        if location == "global":
            return f"aiplatform.{domain}"
        return f"{location}-aiplatform.{domain}"

    def get_target_coordinates(self, model: str) -> tuple[str, str]:
        """Return (hostname, url_path) for Apigee southbound target routing (always non-mTLS from Apigee)."""
        location = self.pro_location if model == MODEL_PRO else self.region
        host = "aiplatform.googleapis.com" if location == "global" else f"{location}-aiplatform.googleapis.com"
        path = f"/v1/projects/{self.project_id}/locations/{location}/publishers/google/models/{model}:generateContent"
        return host, path

    def embed_text(self, text: str, task_type: str = "SEMANTIC_SIMILARITY") -> tuple[list[float], int, float]:
        """Generate a 768-dim embedding via Vertex AI text-embedding-005 in australia-southeast1.

        Returns:
            (embedding_vector, billable_token_count, latency_ms)
        """
        t0 = time.perf_counter()
        session = self._get_session()
        host = self._host_for_location(self.region)
        url = (
            f"https://{host}/v1/projects/{self.project_id}/locations/{self.region}"
            f"/publishers/google/models/{MODEL_EMBEDDING}:predict"
        )
        payload = {
            "instances": [{"content": text, "task_type": task_type}],
        }
        resp = session.post(url, json=payload, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)

        predictions = data.get("predictions", [])
        if not predictions:
            raise RuntimeError(f"Empty embedding response from Vertex AI: {data}")

        emb_obj = predictions[0].get("embeddings", {})
        values: list[float] = emb_obj.get("values", [])
        stats = emb_obj.get("statistics", {})
        token_count = int(stats.get("token_count", max(1, len(text.split()))))
        return values, token_count, latency_ms

    def count_tokens(self, text_or_contents: str | list[dict[str, Any]], model: str = MODEL_FLASH) -> int:
        """Call Vertex AI :countTokens endpoint for exact Gemini tokenizer counts."""
        session = self._get_session()
        location = self.pro_location if model == MODEL_PRO else self.region
        host = self._host_for_location(location)
        url = (
            f"https://{host}/v1/projects/{self.project_id}/locations/{location}"
            f"/publishers/google/models/{model}:countTokens"
        )
        if isinstance(text_or_contents, str):
            payload: dict[str, Any] = {
                "contents": [{"role": "user", "parts": [{"text": text_or_contents}]}]
            }
        else:
            payload = {"contents": text_or_contents}

        resp = session.post(url, json=payload, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return int(data.get("totalTokens", 0))

    def generate_content(
        self,
        payload: dict[str, Any],
        model: str = MODEL_FLASH,
    ) -> tuple[str, TokenUsageBreakdown, dict[str, Any], float]:
        """Invoke Vertex AI Gemini 2.5 (Flash or Pro) and return text, token usage, raw response, and latency_ms."""
        t0 = time.perf_counter()
        session = self._get_session()
        location = self.pro_location if model == MODEL_PRO else self.region
        host = self._host_for_location(location)
        url = (
            f"https://{host}/v1/projects/{self.project_id}/locations/{location}"
            f"/publishers/google/models/{model}:generateContent"
        )
        resp = session.post(url, json=payload, timeout=90)
        resp.raise_for_status()
        raw = resp.json()
        latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)

        text, usage = self.parse_vertex_response(raw, model=model)
        return text, usage, raw, latency_ms

    @staticmethod
    def parse_vertex_response(raw: dict[str, Any], model: str) -> tuple[str, TokenUsageBreakdown]:
        """Extract generated text and exact token counts (including thoughtsTokenCount) from Vertex AI response."""
        candidates = raw.get("candidates", [])
        text_parts: list[str] = []
        if candidates:
            content = candidates[0].get("content", {})
            for part in content.get("parts", []):
                if "text" in part and not part.get("thought", False):
                    text_parts.append(part["text"])
        response_text = "\n".join(text_parts).strip()

        usage_meta = raw.get("usageMetadata", {})
        prompt_tokens = int(usage_meta.get("promptTokenCount", 0))
        candidate_tokens = int(usage_meta.get("candidatesTokenCount", 0))
        thinking_tokens = int(usage_meta.get("thoughtsTokenCount", 0))
        total_tokens = int(
            usage_meta.get("totalTokenCount", prompt_tokens + candidate_tokens + thinking_tokens)
        )

        pricing = PRICING.get(model, PRICING[MODEL_PRO])
        cost_usd = pricing.compute_cost(
            input_tokens=prompt_tokens,
            output_tokens=candidate_tokens,
            thinking_tokens=thinking_tokens,
        )

        usage = TokenUsageBreakdown(
            model=model,
            prompt_tokens=prompt_tokens,
            candidate_tokens=candidate_tokens,
            thinking_tokens=thinking_tokens,
            total_tokens=total_tokens,
            cost_usd=cost_usd,
        )
        return response_text, usage
