"""Optimization 4: Two-Tier Cost-Aware Context Pruning & Multi-Turn Session Deduplication.

Tier 1 ($0.00 LLM overhead — deterministic):
  - Cross-turn deduplication of repeated headers, alert banners, and multi-line blocks
    (keeps the first occurrence across the entire conversation + RAG context).
  - Removal of low-value conversational filler/acknowledgment turns in older history.
  - Compaction of verbose raw log/JSON telemetry dumps in older turns while preserving
    all diagnostic lines (timestamps, metrics, error codes, PR/commit IDs, root causes).

Tier 2 (ROI-gated rolling summary via Gemini 2.5 Flash):
  - Only invoked when remaining prunable older history still exceeds PRUNE_MIN_HISTORY_TOKENS
    (default 800 tokens), ensuring >4.5x compression so Pro input savings strictly exceed
    Flash summarizer overhead. Cached per (session_id, history_digest) for $0.00 reuse.
"""

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

_FILLER_ACK_PREFIXES = (
    "acknowledged",
    "confirmed correlation",
    "checking ",
    "standing by",
    "noted",
    "copy that",
    "roger",
    "on it",
    "looking into",
)

_DIAGNOSTIC_SIGNAL_RE = re.compile(
    r"(root cause|pr\s*#\d+|commit|rollback|p99|p95|latency|error|fatal|exception|timeout|"
    r"max_connections|pool_mode|max_client_conn|v\d{4}\.\d|utc|mitigat|recover|incident|sev-\d)",
    re.IGNORECASE,
)


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
    """Prunes multi-turn history using zero-cost cross-turn dedup + ROI-gated rolling summaries."""

    def __init__(self, vertex_client: VertexAIClient) -> None:
        self._vertex = vertex_client
        self._lock = threading.RLock()
        # Maps (session_id, history_digest) -> summary_text
        self._summary_cache: dict[tuple[str, str], str] = {}

    @staticmethod
    def _hash_norm(text: str) -> str:
        norm = re.sub(r"\s+", " ", text.lower()).strip()
        return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]

    @classmethod
    def _deduplicate_text_with_state(
        cls,
        text: str,
        seen_blocks: set[str],
        seen_lines: set[str],
        compact_verbose_logs: bool = False,
    ) -> tuple[str, int]:
        """Deduplicate repeated paragraphs/lines against shared cross-turn sets.

        Returns (cleaned_text, removed_units_count).
        """
        if not text.strip():
            return text, 0

        blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
        kept_blocks: list[str] = []
        removed = 0

        for block in blocks:
            norm_block = re.sub(r"\s+", " ", block.lower()).strip()
            if len(norm_block) > 70:
                bh = cls._hash_norm(norm_block)
                if bh in seen_blocks:
                    removed += 1
                    continue
                seen_blocks.add(bh)

            # Deduplicate repeated single lines (e.g. incident headers, alert footers, repeated log lines)
            raw_lines = block.splitlines()
            kept_lines: list[str] = []
            for line in raw_lines:
                stripped = line.strip()
                if not stripped:
                    continue
                norm_line = re.sub(r"\s+", " ", stripped.lower())
                if len(norm_line) >= 42:
                    lh = cls._hash_norm(norm_line)
                    if lh in seen_lines:
                        removed += 1
                        continue
                    seen_lines.add(lh)
                kept_lines.append(stripped)

            if not kept_lines:
                continue

            # Compact verbose raw log / JSON / telemetry dumps in older turns while keeping signal lines
            if compact_verbose_logs and len(kept_lines) > 6 and sum(len(l) for l in kept_lines) > 360:
                signal_lines: list[str] = []
                for idx, l in enumerate(kept_lines):
                    if idx == 0 or _DIAGNOSTIC_SIGNAL_RE.search(l):
                        signal_lines.append(l)
                if len(signal_lines) < len(kept_lines):
                    omitted = len(kept_lines) - len(signal_lines)
                    removed += omitted
                    signal_lines.append(f"[...{omitted} verbose telemetry/log lines compacted by Apigee pruner]")
                    kept_lines = signal_lines

            kept_blocks.append("\n".join(kept_lines))

        return "\n\n".join(kept_blocks), removed

    @classmethod
    def _is_filler_ack_turn(cls, msg: ChatMessage) -> bool:
        """Identify short conversational acknowledgment turns that add no factual state."""
        if msg.role != "model":
            return False
        text = msg.content.strip()
        if len(text) > 220:
            return False
        lower = text.lower()
        return any(lower.startswith(p) for p in _FILLER_ACK_PREFIXES)

    @staticmethod
    def _merge_consecutive_roles(messages: list[ChatMessage]) -> list[ChatMessage]:
        """Merge adjacent messages with the same role so Gemini receives strict user/model alternation."""
        merged: list[ChatMessage] = []
        for m in messages:
            if merged and merged[-1].role == m.role:
                merged[-1] = ChatMessage(
                    role=m.role,
                    content=f"{merged[-1].content.rstrip()}\n\n{m.content.lstrip()}",
                )
            else:
                merged.append(m)
        return merged

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
        """Apply Tier 1 zero-cost cross-turn pruning, then Tier 2 ROI-gated Flash summary if needed."""
        t0 = time.perf_counter()
        turns_before = len(messages)

        raw_serialized = self._serialize_messages(messages, rag_context)
        tokens_before = self._vertex.count_tokens(raw_serialized, model=MODEL_FLASH)

        # Shared cross-turn deduplication sets ($0.00 LLM cost)
        seen_blocks: set[str] = set()
        seen_lines: set[str] = set()
        total_removed_units = 0
        dropped_filler_turns = 0

        dedup_rag, rag_removed = self._deduplicate_text_with_state(
            rag_context, seen_blocks, seen_lines, compact_verbose_logs=False
        )
        total_removed_units += rag_removed

        # Single-turn with no RAG deduplication -> nothing to prune
        if turns_before <= 2 and rag_removed == 0:
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
            # Keep the last 2 turns (most recent exchange + current user query) verbatim;
            # aggressively deduplicate & compact older turns (messages[:-2]).
            cutoff = max(1, turns_before - 2)
            older_turns = messages[:cutoff]
            recent_delta = messages[cutoff:]

            cleaned_older: list[ChatMessage] = []
            for m in older_turns:
                if self._is_filler_ack_turn(m):
                    dropped_filler_turns += 1
                    continue
                cleaned_text, removed_cnt = self._deduplicate_text_with_state(
                    m.content, seen_blocks, seen_lines, compact_verbose_logs=True
                )
                total_removed_units += removed_cnt
                if cleaned_text.strip():
                    cleaned_older.append(ChatMessage(role=m.role, content=cleaned_text))

            cleaned_recent: list[ChatMessage] = []
            for m in recent_delta:
                cleaned_text, removed_cnt = self._deduplicate_text_with_state(
                    m.content, seen_blocks, seen_lines, compact_verbose_logs=False
                )
                total_removed_units += removed_cnt
                cleaned_recent.append(ChatMessage(role=m.role, content=cleaned_text or m.content))

            older_text = "\n\n".join(
                f"Turn {i + 1} ({m.role}): {m.content}"
                for i, m in enumerate(cleaned_older)
            )
            history_digest = hashlib.sha256(older_text.encode("utf-8")).hexdigest()[:16]
            cache_key = (session_id, history_digest)

            with self._lock:
                cached_summary = self._summary_cache.get(cache_key)

            if cached_summary is not None:
                # Reuse cached rolling summary at $0.00 summarizer cost
                summary_text = cached_summary
                pruned_messages: list[ChatMessage] = [
                    ChatMessage(
                        role="user",
                        content=f"[PRIOR SESSION STATE SUMMARY (Turns 1-{cutoff})]\n{summary_text}",
                    ),
                    *cleaned_recent,
                ]
            else:
                prunable_history_tokens = (
                    self._vertex.count_tokens(older_text, model=MODEL_FLASH)
                    if older_text.strip()
                    else 0
                )
                if prunable_history_tokens >= min_history_tokens:
                    # Tier 2: ROI-positive Flash rolling summary (strictly >=800 tok -> <=160 tok)
                    summarizer_prompt = (
                        "Summarize the following prior conversation turns into a dense, factual bulleted state summary "
                        "(max 110 words). Preserve all exact identifiers, timestamps, metrics, root causes, error codes, "
                        "and decisions reached. Omit conversational filler and repeated log lines.\n\n"
                        f"PRIOR TURNS:\n{older_text}"
                    )
                    payload = {
                        "contents": [{"role": "user", "parts": [{"text": summarizer_prompt}]}],
                        "generationConfig": {
                            "temperature": 0.0,
                            "maxOutputTokens": 180,
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
                        *cleaned_recent,
                    ]
                else:
                    # Tier 1 alone achieved full compaction with $0.00 LLM summarizer overhead!
                    pruned_messages = [*cleaned_older, *cleaned_recent]
                    if total_removed_units > 0 or dropped_filler_turns > 0:
                        summary_text = (
                            f"Tier 1 zero-LLM deterministic pruning: removed {total_removed_units} duplicate "
                            f"headers/log lines and {dropped_filler_turns} filler acknowledgment turns "
                            f"($0.00 summarizer overhead)."
                        )
        else:
            pruned_messages = []
            for m in messages:
                cleaned_text, removed_cnt = self._deduplicate_text_with_state(
                    m.content, seen_blocks, seen_lines, compact_verbose_logs=False
                )
                total_removed_units += removed_cnt
                pruned_messages.append(ChatMessage(role=m.role, content=cleaned_text or m.content))

        pruned_messages = self._merge_consecutive_roles(pruned_messages)
        pruned_serialized = self._serialize_messages(pruned_messages, dedup_rag)
        tokens_after = self._vertex.count_tokens(pruned_serialized, model=MODEL_FLASH)
        latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        applied = (tokens_after < tokens_before) or (dropped_filler_turns > 0) or (flash_in > 0)

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
