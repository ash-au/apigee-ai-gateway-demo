# Live Presenter Script: Apigee X as an Enterprise AI Gateway (5-Tab Walkthrough)

**Audience:** CIOs, VP of Platform Engineering, Enterprise Architects, CISO / Security Architects, and Staff Engineers  
**Duration:** 5–10 minutes (modular across all 5 Use-Case Tabs + Interactive Glossaries)  
**GCP Project & Region:** `apac-cs-5g-demo5` (`australia-southeast1` / Sydney)  
**Apigee X Organization & Environment:** `apac-cs-5g-demo5` / `demo` (`demo-group`, Revision 11)  
**Live Demo UI URL (`@google.com` IAP):** `https://apigee-ai-economics-demo-1019413155504.australia-southeast1.run.app`  
**Apigee X Gateway Base URL:** `https://10.106.240.2.nip.io/v1/ai-economics`

---

## Pre-Flight Check (30 seconds before going live)
1. Open the Demo UI in your browser (`https://apigee-ai-economics-demo-1019413155504.australia-southeast1.run.app`).
2. Click **"Reset Gateway Cache & Session Ledger"** in the top-right masthead so the semantic cache is cold and the cumulative session ledger starts at `$0.000000` across `0 runs`.
3. *(Optional)* If you plan to demo **Tab 4's Native Vertex AI Vector Search Cache (`<SemanticCacheLookup>`)** live, check the node status banner at the top of Tab 4 (`./infra/toggle_vector_search.sh status`).

---

## Part 1: Tab 1 — AI Cost & Token Economics (`FrugalGPT` + `LLMLingua-2`)

### 1. The Setup: Why Point-to-Point AI Pilots Fail at Scale
* **What to say:**
  > "Right now, 90% of enterprise AI pilots are built as direct point-to-point connections from an application straight to a frontier model like `gemini-2.5-pro`. When you skip the API gateway layer, every single request—whether it's a repeated tier-1 FAQ, a bloated 5,000-token RAG payload, or an 8-turn chat log—burns frontier input, output, and internal thinking tokens.
  >
  > Today we're looking at a live Apigee X gateway in `australia-southeast1` across **5 interactive tabs**:
  > - **Tab 1** operationalizes Stanford's **FrugalGPT** and Microsoft Research's **LLMLingua-2** into four gateway policies controlled by HTTP headers.
  > - **Tabs 2, 3, and 4** showcase all **7 Native Apigee X AI Policies** (`PromptTokenLimit`, `LLMTokenQuota`, `SanitizeUserPrompt`, `SanitizeModelResponse`, `SemanticCacheLookup`, `SemanticCachePopulate`, and `SemanticGovernance`).
  > - **Tab 5** introduces **System 1 (TypeSafe Jev) & System 2 (Vertex AI Gemini) Dynamic Routing** using single-pass calibrated probabilities (`Choice`, `Score`, and a decomposed 5-head `Noul` battery)."

### 2. Model Routing + Semantic Completion Cache (Tab 1, Scenarios 1 & 2)
1. **Select Scenario 1: *Tier-1 IT Support FAQ (Turn 1: Route & Index Cache)*** and click **"Execute Side-by-Side Comparison"**.
   * **Point out on screen:**
     * **Left (Direct Baseline):** Hits `gemini-2.5-pro`, burning frontier input + output + thinking tokens (`~$0.0020–$0.0035`).
     * **Right (Via Apigee X):** Routes to `gemini-2.5-flash` in Sydney (`L1`), verifies post-generation reliability $g(q, a) \ge 0.80$, and indexes the completion in `text-embedding-005`. Cost drops by **~94%**.
2. **Immediately select Scenario 2: *Rephrased IT Support FAQ (Turn 2: Semantic Cache Hit)*** and click **"Execute Side-by-Side Comparison"**.
   * **Point out on screen:**
     * Completely different wording from Turn 1, yet `text-embedding-005` computes cosine similarity **`0.8685 >= 0.85`**.
     * Apigee executes targetless `<RouteRule name="Route-CacheShortCircuit">`. **LLM Tokens Billed: `0`** (only `29` embedding tokens costing **`$0.00000073`** — **99.9%+ cost reduction**).

### 3. LLMLingua-2 Coarse-to-Fine Prompt Compression & Context Pruning (Tab 1, Scenarios 3 & 4)
1. **Select Scenario 3: *Verbose RAG Compliance Audit (LLMLingua-2 Compression)*** and click **"Execute Side-by-Side Comparison"**.
2. Open **Tab 1 ("LLMLingua-2 Prompt Compression Diff")** in the **Staff Engineer Inspection Drawer**:
   * Show how the **LLMLingua Coarse-to-Fine Budget Controller** keeps User Query at 100% fidelity ($\tau_q = 1.0$), System Instructions at 85%, and prunes noisy RAG context via `llmlingua-2-bert-base` on CPU—cutting prompt tokens by **~55%** while preserving every required compliance citation (`australia-southeast1`, `APP 8`, `CMEK` 90-day rotation).

---

## Part 2: Tabs 2, 3 & 4 — All 7 Native Apigee X AI Policies

### 1. Tab 2: Native Token FinOps & Quotas (`PromptTokenLimit` + `LLMTokenQuota`)
1. Click **Tab 2 ("2. Token FinOps & Quotas")**.
2. **Scenario 1 (*Concise Enterprise Query*):** Passes both `PTL-EnforcePromptLimit` and `LTQ-EnforceTokenQuota`, deducting actual `usageMetadata.totalTokenCount` from the distributed counter.
3. **Scenario 2 (*Oversized Context Dump*):** Click Execute to watch `<PromptTokenLimit>` reject a bloated prompt pre-flight (`HTTP 429`) before Vertex AI is ever called (**0 output tokens wasted**).
4. **Scenario 3 (*Tight FinOps Consumer Budget*):** Run twice to watch `<LLMTokenQuota>` enforce per-app chargeback budgets (`free-tier-sandbox`) and trip `HTTP 429` once the rolling 1-minute token budget is exhausted.

### 2. Tab 3: AI Safety & Google Cloud Model Armor (`SanitizeUserPrompt` + `SanitizeModelResponse`)
1. Click **Tab 3 ("3. AI Safety & Model Armor")**.
2. **Scenario 1 (*Prompt Injection & Jailbreak*):** Direct-to-Vertex processes the prompt and bills tokens; Apigee X's `<SanitizeUserPrompt>` intercepts it via Model Armor template `apigee-ai-safety-template` (`HTTP 400`, **0 LLM tokens billed**).
3. **Scenario 2 (*PII / PCI Credit Card Leak*):** Model Armor's Sensitive Data Protection (SDP) filter blocks unredacted Visa card and SSN numbers at the Apigee edge before they leave your boundary.
4. **Scenario 3 (*Malicious Phishing URL in Completion*):** Shows outbound response inspection via `<SanitizeModelResponse>` catching an unsafe URL in the model completion.

### 3. Tab 4: Declarative Semantic Governance & Native Vector Search Cache
1. Click **Tab 4 ("4. Semantic Governance & Native Cache")**.
2. **Scenario 2 (*Off-Topic Crypto & Penny Stock Speculation*):** Watch Apigee's native `<SemanticGovernance>` policy (`SG-EnforceEnterpriseDomain`) evaluate the completion against declarative rule `enterprise-domain-guardrail` and block unauthorized financial speculation.
3. Point out the **Dedicated Vector Search Node Control** bar at the top (`SHARD_SIZE_MEDIUM` / `e2-standard-16`), showing how teams can wake or suspend the Vertex AI Vector Search node (`$0.00/hr` when suspended) with one click.

---

## Part 3: Tab 5 — System 1 (TypeSafe Jev) & System 2 (Vertex AI Gemini) Dynamic Routing

1. Click **Tab 5 ("5. System 1 (Jev) & System 2 Routing")**.
2. *(Optional for executive/technical audiences)* Click the purple **"Explain Noul Battery, Jev Primitives & ML Terms"** button to open the interactive 4-tab Glossary modal explaining:
   * **System 1 (`jev-latest`) vs. System 2 (`gemini-2.5-pro`)**: Single-pass calibrated probabilities (`~200ms`, `$0.042/1M` input, `$0.00` output) vs. slow autoregressive token generation (`$1.25/1M` input, `$10.00/1M` output + thinking).
   * **`Noul` & `Noul Battery`**: Why a single holistic "should we escalate?" judge averages out subtle errors (`~0.04–0.15`), whereas a decomposed **5-Head `Noul` Battery** with an **`any_flag = max(nouls) > 0.70`** gate catches subtle hallucinations and omitted constraints.
3. **Run Scenario 1 (*Simple Factual Lookup*):**
   * **Point out:** Stage 1 Jev outputs `Choice: flash_fast` (`confidence = 0.82 >= 0.75`) and `Complexity: 0.10 / 2.0`. Apigee takes `Route-VertexFlash`. Stage 2 Jev runs the 5-head `Noul` battery (`max_noul = 0.07 <= 0.70`), accepts $L_1$ Flash, and delivers **~88% net cost savings** (including Jev's `$0.000072` cost).
4. **Run Scenario 2 (*Formal Distributed Consensus Proof*):**
   * **Point out:** Standard cascades waste 1.5 seconds calling $L_1$ Flash on a formal FLP/Raft proof that Flash cannot solve. Here, Stage 1 Jev fires `Choice: pro_system2_direct` (`confidence = 1.00`, `requires_formal_proof = 0.99`) and Apigee's `<RouteRule name="Route-VertexPro">` fast-tracks **straight to System 2 (`gemini-2.5-pro`)**, skipping a wasted $L_1$ call and skipping Stage 2 verification (`$0.000028` Jev overhead).
5. **Run Scenario 3 (*Subtle Hallucination / Missed Constraint Trap*):**
   * **Point out:** Stage 1 routes to $L_1$ Flash (`flash_with_verifier`). A subtle L1 fabrication/omission is injected (`simulate_l1_defect = true`). Look at the **Stage 2 Jev 5-Head `Noul` Battery** box at the bottom right:
     * `missed_user_constraint : 0.9900  <== FIRES (> 0.70)`
     * `hedging_or_refusal     : 0.9600  <== FIRES (> 0.70)`
     * `hallucinated_or_contradicts_context : 0.8900  <== FIRES (> 0.70)`
   * Because `any_flag > 0.70`, Apigee rejects the defective $L_1$ draft and automatically escalates to **System 2 (`gemini-2.5-pro`)** to recover a 100% accurate, compliant response.
