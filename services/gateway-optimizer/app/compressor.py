"""Optimization 2: LLMLingua Coarse-to-Fine Prompt Compression (Jiang et al., 2023 - arXiv:2310.05736)."""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from typing import Any

from app.config import COMPRESSION_MIN_TOKENS, LLMLINGUA_MODEL_NAME, MODEL_FLASH
from app.models import ChatMessage
from app.vertex_client import VertexAIClient

logger = logging.getLogger(__name__)

# Critical tokens that must never be pruned during token-level compression
FORCE_PRESERVE_TOKENS: list[str] = [
    "\n",
    ".",
    "?",
    "!",
    ":",
    "-",
    "%",
    "$",
    "not",
    "never",
    "must",
    "shall",
    "unless",
    "except",
    "only",
    "within",
    "hours",
    "days",
    "minutes",
    "seconds",
]


@dataclass
class CompressionResult:
    """Detailed output of the LLMLingua Coarse-to-Fine Budget Controller and Token Compressor."""

    applied: bool
    method: str
    tokens_before: int
    tokens_after: int
    ratio_achieved: float
    budget_allocation: dict[str, Any]
    original_prompt: str
    compressed_prompt: str
    compressed_system_instruction: str
    compressed_rag_context: str
    compressed_few_shots: list[str]
    latency_ms: float


class LLMLinguaCompressorEngine:
    """Implements LLMLingua Section 4.1 Budget Controller + Section 4.2 Token-Level Compression."""

    def __init__(self, vertex_client: VertexAIClient) -> None:
        self._vertex = vertex_client
        self._lock = threading.Lock()
        self._compressor: Any | None = None
        self._backend_name: str = "UNINITIALIZED"

    def warmup(self) -> str:
        """Eagerly load the small language model into CPU memory on container startup."""
        with self._lock:
            if self._compressor is not None:
                return self._backend_name
            try:
                from llmlingua import PromptCompressor  # type: ignore

                logger.info("Loading LLMLingua-2 model: %s", LLMLINGUA_MODEL_NAME)
                self._compressor = PromptCompressor(
                    model_name=LLMLINGUA_MODEL_NAME,
                    use_llmlingua2=True,
                    device_map="cpu",
                )
                self._backend_name = f"LLMLingua-2 ({LLMLINGUA_MODEL_NAME})"
                logger.info("LLMLingua-2 loaded successfully on CPU.")
            except Exception as exc:
                logger.warning("LLMLingua-2 load failed (%s); falling back to self-information compressor.", exc)
                self._compressor = None
                self._backend_name = "LLMLingua Coarse-to-Fine Self-Information Pruning"
            return self._backend_name

    @staticmethod
    def _assemble_full_prompt(
        system_instruction: str,
        rag_context: str,
        few_shots: list[str],
        messages: list[ChatMessage],
    ) -> str:
        sections: list[str] = []
        if system_instruction.strip():
            sections.append(f"### SYSTEM INSTRUCTION\n{system_instruction.strip()}")
        if rag_context.strip():
            sections.append(f"### RETRIEVED CONTEXT\n{rag_context.strip()}")
        if few_shots:
            joined_shots = "\n\n".join(f"Example {i + 1}:\n{ex.strip()}" for i, ex in enumerate(few_shots) if ex.strip())
            if joined_shots:
                sections.append(f"### FEW-SHOT DEMONSTRATIONS\n{joined_shots}")
        conv = "\n\n".join(f"{m.role.upper()}: {m.content.strip()}" for m in messages)
        sections.append(f"### CONVERSATION & USER QUERY\n{conv}")
        return "\n\n".join(sections)

    @staticmethod
    def _score_demonstration_relevance(demo: str, query: str) -> float:
        """Coarse-grained demonstration scoring (LLMLingua Section 4.1):
        Combines query keyword overlap + information density (unique token ratio + numeric/entity density).
        """
        q_tokens = set(re.findall(r"[a-zA-Z0-9_]{3,}", query.lower()))
        d_words = re.findall(r"[a-zA-Z0-9_]{2,}", demo.lower())
        if not d_words:
            return 0.0
        d_set = set(d_words)
        overlap = len(q_tokens.intersection(d_set)) / max(1, len(q_tokens))
        type_token_ratio = len(d_set) / len(d_words)
        numeric_density = len(re.findall(r"\b\d+(?:\.\d+)?%?\b", demo)) / max(1, len(d_words) / 20.0)
        return (overlap * 2.0) + type_token_ratio + min(1.0, numeric_density)

    def _compress_block_tokens(self, text: str, rate: float) -> str:
        """Run fine-grained token-level compression using LLMLingua-2 on CPU."""
        if not text.strip() or rate >= 0.95:
            return text

        self.warmup()
        if self._compressor is not None:
            result = self._compressor.compress_prompt(
                [text],
                rate=max(0.18, min(0.92, rate)),
                force_tokens=FORCE_PRESERVE_TOKENS,
                drop_consecutive=True,
            )
            compressed = str(result.get("compressed_prompt", text)).strip()
            return compressed if compressed else text

        # Fallback deterministic token-entropy pruner if model unavailable
        return self._entropy_token_prune(text, rate)

    @staticmethod
    def _entropy_token_prune(text: str, rate: float) -> str:
        """Deterministic lexical self-information pruner preserving high-entropy tokens, numbers, and negations."""
        low_info_words = {
            "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
            "that", "which", "who", "whom", "this", "these", "those", "very", "really",
            "quite", "basically", "essentially", "actually", "literally", "generally",
            "typically", "usually", "furthermore", "moreover", "additionally", "however",
            "therefore", "consequently", "accordingly", "specifically", "particular",
            "please", "kindly", "note", "important", "remember", "ensure", "make", "sure",
        }
        lines = text.splitlines()
        out_lines: list[str] = []
        for line in lines:
            words = line.split()
            if len(words) <= 6:
                out_lines.append(line)
                continue
            target_keep = max(4, int(len(words) * rate))
            scored: list[tuple[int, str, float]] = []
            for idx, w in enumerate(words):
                clean = re.sub(r"[^a-zA-Z0-9]", "", w).lower()
                if any(ch.isdigit() for ch in w) or clean in {"not", "never", "must", "shall", "unless", "except", "only"}:
                    score = 100.0
                elif w[0:1].isupper() and idx > 0:
                    score = 15.0 + len(clean)
                elif clean in low_info_words:
                    score = 0.5
                else:
                    score = float(len(clean))
                scored.append((idx, w, score))
            top_indices = {idx for idx, _, _ in sorted(scored, key=lambda x: x[2], reverse=True)[:target_keep]}
            kept = [w for idx, w, _ in scored if idx in top_indices]
            out_lines.append(" ".join(kept))
        return "\n".join(out_lines)

    def compress(
        self,
        system_instruction: str,
        rag_context: str,
        few_shot_examples: list[str],
        messages: list[ChatMessage],
        target_ratio: float = 0.55,
    ) -> CompressionResult:
        """Execute LLMLingua Coarse-to-Fine Budget Controller + Token Compression."""
        t0 = time.perf_counter()

        original_full = self._assemble_full_prompt(
            system_instruction=system_instruction,
            rag_context=rag_context,
            few_shots=few_shot_examples,
            messages=messages,
        )
        tokens_before = self._vertex.count_tokens(original_full, model=MODEL_FLASH)

        # Measure compressible zones (system + RAG + few-shot + non-final turns)
        compressible_text = "\n".join([system_instruction, rag_context, *few_shot_examples])
        if len(compressible_text.split()) < COMPRESSION_MIN_TOKENS and len(messages) <= 1:
            return CompressionResult(
                applied=False,
                method="SKIPPED_BELOW_THRESHOLD",
                tokens_before=tokens_before,
                tokens_after=tokens_before,
                ratio_achieved=1.0,
                budget_allocation={"reason": "Prompt below minimum compressible token threshold"},
                original_prompt=original_full,
                compressed_prompt=original_full,
                compressed_system_instruction=system_instruction,
                compressed_rag_context=rag_context,
                compressed_few_shots=few_shot_examples,
                latency_ms=round((time.perf_counter() - t0) * 1000.0, 2),
            )

        user_query = messages[-1].content if messages else ""

        # Step 1: LLMLingua Section 4.1 Budget Controller
        # Allocate higher preservation budget to instructions (tau_ins) and question (tau_que = 1.0),
        # and aggressive compression to demonstrations and retrieved RAG context (tau_dems).
        tau_que = 1.00
        tau_ins = min(0.75, max(0.45, target_ratio * 1.45))
        tau_dems = max(0.22, min(0.55, target_ratio * 0.85))

        # Coarse demonstration-level selection: if > 1 few-shot example, keep top highest-information examples
        selected_few_shots: list[str] = []
        if len(few_shot_examples) > 1:
            scored_demos = sorted(
                few_shot_examples,
                key=lambda d: self._score_demonstration_relevance(d, user_query),
                reverse=True,
            )
            keep_count = max(1, round(len(few_shot_examples) * max(0.34, target_ratio)))
            selected_few_shots = scored_demos[:keep_count]
        else:
            selected_few_shots = list(few_shot_examples)

        # Step 2: LLMLingua Section 4.2 Fine-Grained Token-Level Compression
        compressed_sys = (
            self._compress_block_tokens(system_instruction, rate=tau_ins)
            if len(system_instruction.split()) > 35
            else system_instruction
        )
        compressed_rag = (
            self._compress_block_tokens(rag_context, rate=tau_dems)
            if len(rag_context.split()) > 35
            else rag_context
        )
        compressed_shots = [
            self._compress_block_tokens(ex, rate=min(0.65, tau_dems * 1.3))
            for ex in selected_few_shots
        ]

        # Compress verbose historical turns if present, NEVER compress the final user query (tau_que = 1.0)
        compressed_messages: list[ChatMessage] = []
        for idx, msg in enumerate(messages):
            is_last_user_turn = idx == len(messages) - 1
            if not is_last_user_turn and len(msg.content.split()) > 60:
                c_content = self._compress_block_tokens(msg.content, rate=min(0.60, tau_ins))
                compressed_messages.append(ChatMessage(role=msg.role, content=c_content))
            else:
                compressed_messages.append(msg)

        compressed_full = self._assemble_full_prompt(
            system_instruction=compressed_sys,
            rag_context=compressed_rag,
            few_shots=compressed_shots,
            messages=compressed_messages,
        )
        tokens_after = self._vertex.count_tokens(compressed_full, model=MODEL_FLASH)
        ratio_achieved = round(tokens_after / max(1, tokens_before), 4)
        latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)

        budget_info = {
            "target_overall_rate": target_ratio,
            "tau_instruction": round(tau_ins, 3),
            "tau_demonstrations_rag": round(tau_dems, 3),
            "tau_question": tau_que,
            "demonstrations_before": len(few_shot_examples),
            "demonstrations_after_coarse_filter": len(selected_few_shots),
            "compression_factor_x": round(max(1.0, tokens_before / max(1, tokens_after)), 2),
        }

        return CompressionResult(
            applied=tokens_after < tokens_before,
            method=self._backend_name,
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            ratio_achieved=ratio_achieved,
            budget_allocation=budget_info,
            original_prompt=original_full,
            compressed_prompt=compressed_full,
            compressed_system_instruction=compressed_sys,
            compressed_rag_context=compressed_rag,
            compressed_few_shots=compressed_shots,
            latency_ms=latency_ms,
        )
