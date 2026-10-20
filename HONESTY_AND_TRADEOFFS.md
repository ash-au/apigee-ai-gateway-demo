# Engineering Honesty, Accounting Rules & Architectural Trade-Offs

This document records the exact accounting rules, algorithmic adaptations from the research papers, and production trade-offs in this build so that any Staff Engineer, Principal Architect, or FinOps lead inspecting the system gets a transparent answer.

---

## 1. Zero-Fudge Token & Cost Accounting Rules

1. **All Token Counts Originate from Live Vertex AI `usageMetadata`:**
   * Every LLM call returns `promptTokenCount`, `candidatesTokenCount`, and `thoughtsTokenCount` directly from Vertex AI (`australia-southeast1-aiplatform.googleapis.com` for `gemini-2.5-flash` and `aiplatform.googleapis.com` for `gemini-2.5-pro`).
2. **Internal Thinking Tokens (`thoughtsTokenCount`) Are Explicitly Surfaced and Billed:**
   * In Gemini 2.5 models, reasoning ("thinking") tokens are billed at the **output token rate** (`$10.00 / 1M` on Gemini 2.5 Pro; `$2.50 / 1M` on Gemini 2.5 Flash) and share the `maxOutputTokens` budget with `candidatesTokenCount`.
   * Both the Direct Baseline column and the Apigee X Gateway column explicitly display `thoughtsTokenCount` and bill them at the model's output rate.
3. **All Gateway Overhead Is Included in the Gateway's Billed Totals:**
   * **Semantic Cache Lookups (`text-embedding-005`):** Every cache lookup (whether a HIT or a MISS) bills the real `statistics.token_count` returned by Vertex AI `text-embedding-005` at `$0.025 / 1M` tokens (`embedding_overhead_tokens`).
   * **Context Pruning Summarization (`gemini-2.5-flash`):** When `X-Opt-Prune: true` condenses older conversation turns into a rolling state summary, the input, output, and thinking tokens consumed by that summarization call are added to `pruning_summarizer_overhead_tokens` and `pruning_summarizer_cost_usd`.
   * **FrugalGPT Cascade Escalations ($L_1 + L_2$ Double-Billing):** When `gemini-2.5-flash` ($L_1$) scores below the reliability threshold ($g(q, a) < 0.80$) and escalates to `gemini-2.5-pro` ($L_2$), the gateway sums **both** $L_1$ and $L_2$ tokens and costs into `grand_total_billed_tokens` and `total_cost_usd`.

---

## 2. How the Two Research Papers Were Adapted for Real-Time Gateway Execution

| Paper & Concept | Original Paper Formulation | Our Real-Time Gateway Implementation | Why This Choice Was Made |
| :--- | :--- | :--- | :--- |
| **LLMLingua / LLMLingua-2**<br>(`arXiv:2310.05736` / `arXiv:2403.12968`) | Uses a small causal LM (LLaMA-2-7B / GPT-2) for iterative token perplexity scoring (LLMLingua-1) or a bidirectional XLM-RoBERTa / BERT token classifier trained via data distillation from GPT-4 (LLMLingua-2), combined with a Coarse-grained Budget Controller ($\tau_{\text{instr}}, \tau_{\text{dems}}, \tau_{\text{q}}$). | Implements the **LLMLingua Section 3.1 Coarse-grained Budget Controller** ($\tau_{\text{instr}}=0.85, \tau_{\text{rag}}=0.35, \tau_{\text{q}}=1.0$) + coarse demonstration filtering via `text-embedding-005` cosine similarity, paired with **`microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank`** running on Cloud Run CPU (`torch` CPU threads). | Running a 7B autoregressive model for iterative perplexity scoring without a GPU takes >25s per request. `llmlingua-2-bert-base` is a single forward-pass bidirectional token classifier from the official Microsoft LLMLingua-2 release that runs on standard Cloud Run CPU without GPU quota while preserving key entities and numbers. |
| **FrugalGPT Completion Cache**<br>(`arXiv:2305.05176` §3.1) | Embeds queries into a vector index; if a new query is within similarity threshold $\tau$ of a cached query, returns the cached completion without invoking the LLM. | Uses Vertex AI `text-embedding-005` (`768`-dim) in `australia-southeast1` with cosine similarity threshold $\tau = 0.85$, partitioned by `(scenario_id, sha256(system_instruction))` namespace. | Partitioning by system instruction / scenario prevents cross-tenant or cross-persona cache pollution while still matching semantically equivalent user questions. |
| **FrugalGPT LLM Cascade & Scorer $g(q, a)$**<br>(`arXiv:2305.05176` §3.3) | Trains a DistilBERT regression scorer $g(q, f_i(q)) \in [0, 1]$ on labeled benchmark pairs to predict whether model $L_i$'s answer is reliable. | Combines a pre-inference complexity router with a **post-generation calibrated reliability scorer $g(q, a)$** using Vertex AI's native `avgLogprobs`, `finishReason`, structural completeness checks, and explicit uncertainty/escalation markers (`[REQUIRES_DEEP_REASONING]`). | Vertex AI `gemini-2.5-flash` natively returns per-token log-probabilities (`avgLogprobs`), giving an intrinsic model calibration signal at 0ms extra inference cost rather than running a separate DistilBERT scorer over long completions. |

---

## 3. Production Trade-Offs to Highlight to Technical Buyers

1. **CPU vs. GPU Latency on LLMLingua-2 Compression:**
   * On a 2-vCPU Cloud Run instance, `llmlingua-2-bert-base` takes `~1.5s–6.5s` on long multi-document RAG prompts (`350–1,000` tokens).
   * *Production recommendation:* Deploy `gateway-optimizer` on a Cloud Run **NVIDIA L4 GPU** instance in `australia-southeast1` (or GKE Autopilot GPU node pool), which reduces `llmlingua-2` inference latency from `~5s` on CPU to **`<45ms`**.
2. **In-Memory Vector Cache vs. Vertex AI Vector Search / AlloyDB pgvector:**
   * For self-contained demo portability and instant `/reset` capability during live presentations, the semantic cache and rolling session summaries are stored in thread-safe in-memory structures on the warm (`min-instances=1`) `gateway-optimizer` container.
   * *Production recommendation:* Back the semantic cache with **Cloud Memorystore for Redis Vector** or **AlloyDB `pgvector`** inside the same VPC so cache state is shared horizontally across all Cloud Run replicas with sub-5ms ANN lookup.
3. **When Context Pruning Costs More Than It Saves (Short Conversations):**
   * Calling `gemini-2.5-flash` to summarize a short history can consume ~400–600 Flash tokens (`~$0.0007`). If the conversation only has 1–2 short turns, summarizing would cost more than sending the raw turns.
   * That is why our pruner (`pruner.py`) enforces a minimum threshold (`> 4` turns) and reuses cached session state summaries across subsequent turns, amortizing the summarization overhead over long multi-turn sessions.
