"""Optimization 1: Semantic Caching (FrugalGPT Section 3.2 - LLM Approximation / Completion Cache)."""

from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

from app.config import MODEL_EMBEDDING, PRICING
from app.vertex_client import VertexAIClient


@dataclass
class CacheEntry:
    """Single semantic cache record."""

    namespace_key: str
    user_query: str
    embedding: np.ndarray  # Unit-normalized 768-dim vector
    response_text: str
    model_used: str
    created_at: float


@dataclass
class CacheLookupResult:
    """Result of a semantic cache lookup."""

    hit: bool
    similarity: Optional[float]
    matched_query: Optional[str]
    response_text: Optional[str]
    model_used: Optional[str]
    embedding_vector: list[float]
    embedding_tokens: int
    embedding_cost_usd: float
    latency_ms: float


class SemanticCacheEngine:
    """Vector similarity completion cache backed by Vertex AI text-embedding-005."""

    def __init__(self, vertex_client: VertexAIClient) -> None:
        self._vertex = vertex_client
        self._lock = threading.RLock()
        self._entries: list[CacheEntry] = []

    @staticmethod
    def build_namespace_key(scenario_id: Optional[str], system_instruction: str, rag_context: str) -> str:
        """Create a deterministic namespace key so cache hits respect system/RAG context boundaries."""
        if scenario_id:
            return f"scenario:{scenario_id}"
        digest = hashlib.sha256(f"{system_instruction.strip()}||{rag_context.strip()[:500]}".encode("utf-8")).hexdigest()[:12]
        return f"ctx:{digest}"

    @staticmethod
    def _normalize(vec: list[float]) -> np.ndarray:
        arr = np.asarray(vec, dtype=np.float32)
        norm = float(np.linalg.norm(arr))
        if norm > 0.0:
            arr = arr / norm
        return arr

    def lookup(
        self,
        namespace_key: str,
        user_query: str,
        threshold: float = 0.88,
    ) -> CacheLookupResult:
        """Embed user_query via Vertex AI text-embedding-005 and search for cosine similarity >= threshold."""
        t0 = time.perf_counter()
        raw_vec, emb_tokens, _ = self._vertex.embed_text(user_query, task_type="SEMANTIC_SIMILARITY")
        emb_cost = PRICING[MODEL_EMBEDDING].compute_cost(input_tokens=emb_tokens, output_tokens=0)
        q_vec = self._normalize(raw_vec)

        best_sim: float = -1.0
        best_entry: Optional[CacheEntry] = None

        with self._lock:
            for entry in self._entries:
                if entry.namespace_key != namespace_key:
                    continue
                sim = float(np.dot(q_vec, entry.embedding))
                if sim > best_sim:
                    best_sim = sim
                    best_entry = entry

        total_ms = round((time.perf_counter() - t0) * 1000.0, 2)

        if best_entry is not None and best_sim >= threshold:
            return CacheLookupResult(
                hit=True,
                similarity=round(best_sim, 4),
                matched_query=best_entry.user_query,
                response_text=best_entry.response_text,
                model_used=best_entry.model_used,
                embedding_vector=raw_vec,
                embedding_tokens=emb_tokens,
                embedding_cost_usd=emb_cost,
                latency_ms=total_ms,
            )

        return CacheLookupResult(
            hit=False,
            similarity=round(best_sim, 4) if best_sim > 0.0 else None,
            matched_query=best_entry.user_query if best_entry else None,
            response_text=None,
            model_used=None,
            embedding_vector=raw_vec,
            embedding_tokens=emb_tokens,
            embedding_cost_usd=emb_cost,
            latency_ms=total_ms,
        )

    def store(
        self,
        namespace_key: str,
        user_query: str,
        response_text: str,
        model_used: str,
        precomputed_embedding: Optional[list[float]] = None,
    ) -> None:
        """Store a verified completion in the semantic cache."""
        if not user_query.strip() or not response_text.strip():
            return
        if precomputed_embedding is None:
            raw_vec, _, _ = self._vertex.embed_text(user_query, task_type="SEMANTIC_SIMILARITY")
        else:
            raw_vec = precomputed_embedding

        norm_vec = self._normalize(raw_vec)
        with self._lock:
            # Replace if exact same query exists in namespace
            self._entries = [
                e for e in self._entries
                if not (e.namespace_key == namespace_key and e.user_query.strip().lower() == user_query.strip().lower())
            ]
            self._entries.append(
                CacheEntry(
                    namespace_key=namespace_key,
                    user_query=user_query,
                    embedding=norm_vec,
                    response_text=response_text,
                    model_used=model_used,
                    created_at=time.time(),
                )
            )

    def stats(self) -> dict[str, int]:
        """Return current cache entry count."""
        with self._lock:
            return {"entries": len(self._entries)}

    def clear(self) -> int:
        """Clear all semantic cache entries and return count removed."""
        with self._lock:
            count = len(self._entries)
            self._entries.clear()
            return count
