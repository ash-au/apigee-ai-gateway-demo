"""Optimization 4: Context Pruning & Multi-Turn Session Deduplication."""

from __future__ import annotations

import hashlib
import re
import threading
import time
from dataclasses import dataclass
from typing import Optional

from app.config import MODEL_FLASH, PRICING, PRUNE_MIN_HISTORY_TOKENS
from app.models import ChatMessage
from app.vertex_client import VertexAIClient


@dataclass
class PruneResult:
    """Result of multi-turn context pruning and session deduplication."""

    applied: bool
    pruned_messages: list[ChatMessage]
    deduplicated_rag_context: str
    turns_before: int
    turns_after: int
    tokens_before: int
    tokens_after: int
    summary_text: Optional[str]
    flash_input_tokens: int
    flash_output_tokens: int
    flash_thinking_tokens: int
    overhead_cost_usd: float
    latency_ms: float


class ContextPrunerEngine:
    """Prunes multi-turn history into a rolling state summary + verbatim recent delta."""

    def __init__(self, vertex_client: VertexAIClient) -> None:
        self._vertex = vertex_client
        self._lock = threading.RLock()
        # Maps (session_id, history_digest) -> summary_text
        self._summary_cache: dict[tuple[str, str], str] = {}

    @staticmethod
    def _deduplicate_paragraphs(text: str) -> str:
        """Remove duplicate multi-line blocks or repeated boilerplate paragraphs within RAG/history."""
        if not text.strip():
            return text
        blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
        seen_hashes: set[str] = set()
        unique_blocks: list[str] = []
        for block in blocks:
            norm = re.sub(r"\s+", " ", block.lower()).strip()
            if len(norm) > 80:
                h = hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]
                if h in seen_hashes:
                    continue
                seen_hashes.add(h)
            unique_blocks.append(block)
        return "\n\n".join(unique_blocks)

    @staticmethod
    def _serialize_messages(messages: list[ChatMessage], rag_context: str = "") -> str:
        parts: list[str] = []
        if rag_context.strip():
            parts.append(f"[CONTEXT]\n{rag_context.strip()}")
        for idx, m in enumerate(messages, 1):
            parts.append(f"[TURN {idx} - {m.role.upper()}]\n{m.content.strip()}")
        return "\n\n".join(parts)

    def prune(
        self,
        session_id: str,
        messages: list[ChatMessage],
        rag_context: str = "",
        min_history_tokens: int = PRUNE_MIN_HISTORY_TOKENS,
    ) -> PruneResult:
        """Condense older conversation turns into a factual state summary while keeping the latest delta verbatim."""
        t0 = time.perf_counter()
        turns_before = len(messages)

        raw_serialized = self._serialize_messages(messages, rag_context)
        tokens_before = self._vertex.count_tokens(raw_serialized, model=MODEL_FLASH)

        dedup_rag = self._deduplicate_paragraphs(rag_context)

        # If single-turn and no duplicate paragraphs in RAG, nothing to prune
        if turns_before <= 2 and len(dedup_rag) == len(rag_context.strip()):
            return PruneResult(
                applied=False,
                pruned_messages=messages,
                deduplicated_rag_context=rag_context,
                turns_before=turns_before,
                turns_after=turns_before,
                tokens_before=tokens_before,
                tokens_after=tokens_before,
                summary_text=None,
                flash_input_tokens=0,
                flash_output_tokens=0,
                flash_thinking_tokens=0,
                overhead_cost_usd=0.0,
                latency_ms=round((time.perf_counter() - t0) * 1000.0, 2),
            )

        flash_in = 0
        flash_out = 0
        flash_think = 0
        overhead_cost = 0.0
        summary_text: Optional[str] = None

        if turns_before > 2:
            # Keep the last 2 turns (previous assistant response + latest user prompt) or last 1 user turn verbatim,
            # and summarize all earlier turns (messages[:-2] or messages[:-1]).
            cutoff = max(1, turns_before - 2)
            older_turns = messages[:cutoff]
            recent_delta = messages[cutoff:]

            older_text = "\n\n".join(
                f"Turn {i + 1} ({m.role}): {self._deduplicate_paragraphs(m.content)}"
                for i, m in enumerate(older_turns)
            )
            history_digest = hashlib.sha256(older_text.encode("utf-8")).hexdigest()[:16]
            cache_key = (session_id, history_digest)

            with self._lock:
                cached_summary = self._summary_cache.get(cache_key)

            if cached_summary is not None:
                # Always reuse cached summary when available (0 summarizer token cost)
                summary_text = cached_summary
                pruned_messages: list[ChatMessage] = [
                    ChatMessage(
                        role="user",
                        content=f"[PRIOR SESSION STATE SUMMARY (Turns 1-{cutoff})]\n{summary_text}",
                    ),
                    *recent_delta,
                ]
            else:
                prunable_history_tokens = self._vertex.count_tokens(older_text, model=MODEL_FLASH)
                if prunable_history_tokens >= min_history_tokens:
                    # Call Gemini 2.5 Flash with thinkingBudget=0 to produce a dense factual state summary
                    summarizer_prompt = (
                        "Summarize the following prior conversation turns into a dense, factual bulleted state summary "
                        "(max 140 words). Preserve all exact identifiers, timestamps, metrics, root causes, error codes, "
                        "and decisions reached. Omit conversational filler and repeated log lines.\n\n"
                        f"PRIOR TURNS:\n{older_text}"
                    )
                    payload = {
                        "contents": [{"role": "user", "parts": [{"text": summarizer_prompt}]}],
                        "generationConfig": {
                            "temperature": 0.0,
                            "maxOutputTokens": 240,
                            "thinkingConfig": {"thinkingBudget": 0},
                        },
                    }
                    gen_text, usage, _, _ = self._vertex.generate_content(payload, model=MODEL_FLASH)
                    summary_text = gen_text.strip()
                    flash_in = usage.prompt_tokens
                    flash_out = usage.candidate_tokens
                    flash_think = usage.thinking_tokens
                    overhead_cost = usage.cost_usd

                    with self._lock:
                        self._summary_cache[cache_key] = summary_text

                    pruned_messages = [
                        ChatMessage(
                            role="user",
                            content=f"[PRIOR SESSION STATE SUMMARY (Turns 1-{cutoff})]\n{summary_text}",
                        ),
                        *recent_delta,
                    ]
                else:
                    # Skip summarisation below PRUNE_MIN_HISTORY_TOKENS; only apply zero-cost paragraph deduplication
                    pruned_messages = [
                        ChatMessage(role=m.role, content=self._deduplicate_paragraphs(m.content))
                        for m in messages
                    ]
        else:
            pruned_messages = [
                ChatMessage(role=m.role, content=self._deduplicate_paragraphs(m.content))
                for m in messages
            ]

        pruned_serialized = self._serialize_messages(pruned_messages, dedup_rag)
        tokens_after = self._vertex.count_tokens(pruned_serialized, model=MODEL_FLASH)
        latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        applied = (summary_text is not None) or (tokens_after < tokens_before)

        return PruneResult(
            applied=applied,
            pruned_messages=pruned_messages,
            deduplicated_rag_context=dedup_rag,
            turns_before=turns_before,
            turns_after=len(pruned_messages),
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            summary_text=summary_text,
            flash_input_tokens=flash_in,
            flash_output_tokens=flash_out,
            flash_thinking_tokens=flash_think,
            overhead_cost_usd=overhead_cost,
            latency_ms=latency_ms,
        )

    def clear(self) -> int:
        """Clear cached session summaries."""
        with self._lock:
            count = len(self._summary_cache)
            self._summary_cache.clear()
            return count
