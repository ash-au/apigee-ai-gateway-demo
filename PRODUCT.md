# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Primary Product Mode

**`Operate` + `Read`** — An executable live telemetry workbench paired with deep technical inspection ledgers. Users run live dual-path API transactions, flip policy headers and routing thresholds, and read side-by-side financial, token, security, and calibrated-probability audit trails.

## Users

- **Executive Buyers (CIOs, VPs of Platform Engineering, CISOs, FinOps Leads):** Evaluating whether an API gateway layer can govern enterprise AI spend, data leakage, and model compliance without degrading answer quality. They inspect cumulative cost deltas, annualized enterprise projections, and unambiguous block/pass verdicts within a 5–10 minute live briefing.
- **Technical Evaluators (Enterprise Architects, Principal & Staff Engineers):** Stress-testing the claims in real time during live Q&A. They verify that savings are not rigged, open raw HTTP headers, inspect LLMLingua-2 prompt diffs, check Vertex AI `usageMetadata.thoughtsTokenCount`, audit Apigee X XML policies, and interrogate System 1 calibrated probabilities.

## Product Purpose

Prove—through live, un-mocked parallel execution in Google Cloud (`apac-cs-5g-demo5`, `australia-southeast1`)—how **Apigee X** functions as an enterprise AI Gateway positioned between client applications and Vertex AI (`gemini-2.5-pro` / `gemini-2.5-flash`). Every execution fires two real requests simultaneously:

1. **Direct Baseline:** Unoptimized application traffic straight to frontier Vertex AI (`gemini-2.5-pro`).
2. **Apigee X AI Gateway Path:** Governed traffic routed through Apigee X proxy `ai-gateway-v1` (`demo` env), applying token economics, native Apigee AI policies, or two-stage System 1/System 2 dynamic routing.

Success means an executive grasps the economic and governance proof within seconds while a skeptical staff engineer can trace every single billed token, overhead dollar, HTTP status code, and routing hop to live backend telemetry.

## Positioning

Unlike slideware calculators or mocked gateway dashboards, this product runs real Vertex AI inference, real Apigee X XML policies, real Google Cloud Model Armor templates, real Vertex AI Vector Search lookups, and real **TypeSafe Jev** (`jev-latest`) single-pass System 1 calls side-by-side—while enforcing **zero-fudge accounting** that includes internal reasoning tokens (`thoughtsTokenCount`), embedding overhead, summarizer overhead, System 1 inference fees, and rejected $L_1$ cascade double-billing in the gateway's total cost.

## Core Surfaces & Primary User Flows

All surfaces live in the single-page web workbench (`services/demo-ui/static/`) backed by the FastAPI side-by-side BFF (`services/demo-ui/app/main.py`):

1. **Masthead & Global Controls:** Environment badge (`apac-cs-5g-demo5 · env: demo · australia-southeast1`), Light/Dark theme switcher (`localStorage`-persisted), **System 1 & Noul Glossary** modal trigger, **Architecture & Pricing** modal trigger, and **Reset Cache & Ledger** action.
2. **Tab 1 — Cost & Token Economics (`POST /v1/ai-economics/chat`):**
   - *Flow:* Select one of 5 curated enterprise scenarios (or click **Run All 5 Sequentially**), toggle any combination of the 4 Apigee X HTTP header policies (`X-Opt-Cache`, `X-Opt-Compress`, `X-Opt-Prune`, `X-Opt-Cascade`) plus compression target ratio, execute side-by-side, inspect the cumulative session ledger (with 1M–50M req/mo annualized savings slider), live pipeline execution path, cost/token charts, and the 4-tab Staff Engineer Audit Drawer (LLMLingua-2 Compression Diff, FrugalGPT Routing & Cascade Audit, Semantic Cache & Pruning State, HTTP Headers & Raw JSON).
   - *Mechanisms:* FrugalGPT semantic completion cache (`text-embedding-005`, cosine $\ge 0.85$, targetless `Route-CacheShortCircuit`), complexity-aware direct-to-Pro routing ($\ge 0.55$), $L_1$ Flash 1,024-token output cap with $g(q, a) \ge 0.80$ reliability escalation, LLMLingua-2 BERT prompt compression (`0.55` default ratio, $\tau_q = 1.0$), and conditional multi-turn context pruning ($\ge 800$ prunable tokens).
3. **Tab 2 — Token FinOps & Quotas (`POST /v1/ai-economics/policies/token-governance`):**
   - *Flow:* Configure live `X-Prompt-Token-Limit` and `X-Quota-Limit` parameters or pick from 3 FinOps presets (Concise Query, Oversized Context Dump, Tight Consumer Budget), execute side-by-side to demonstrate `<PromptTokenLimit>` pre-flight `HTTP 429` spike arrest (`0` output tokens wasted) and `<LLMTokenQuota>` rolling 1-minute token quota depletion, and audit native Apigee XML + `ratelimit.*` flow variables.
4. **Tab 3 — AI Safety & Model Armor (`POST /v1/ai-economics/policies/model-armor`):**
   - *Flow:* Run red-team & compliance scenarios (Prompt Injection/Jailbreak, PII/PCI Credit Card & SSN Leak, Malicious Phishing URL in Completion) to compare unsanitized Direct Vertex AI against Apigee X `<SanitizeUserPrompt>` and `<SanitizeModelResponse>` backed by Google Cloud Model Armor (`apigee-ai-safety-template`), inspecting inbound `HTTP 400` (`0` LLM tokens billed) and outbound sanitization telemetry.
5. **Tab 4 — Governance & Native Cache (`POST /v1/ai-economics/policies/semantic-governance` & `/policies/native-cache`):**
   - *Flow:* Inspect and control the dedicated Vertex AI Vector Search node (`SHARD_SIZE_MEDIUM` / `e2-standard-16`) via 1-click **Wake / Suspend (`$0/hr` idle)** controls; execute declarative domain guardrails (`<SemanticGovernance>` / `enterprise-domain-guardrail`, `HTTP 422` on off-topic financial speculation) or zero-code native XML vector caching (`<SemanticCacheLookup>` + `<SemanticCachePopulate>`).
6. **Tab 5 — System 1 (TypeSafe Jev) + System 2 (Gemini 2.5 Pro) Routing (`POST /v1/ai-economics/system1-routing`):**
   - *Flow:* Choose from curated System 1/System 2 scenarios (Simple Factual Lookup, Formal Distributed Consensus Proof, Subtle Hallucination / Missed Constraint Trap, Raw Unmodified Flash Audit), tune Stage 1 confidence threshold, Stage 2 `fire_threshold` (default `0.70`), and the explicit `simulate_l1_defect` toggle; execute side-by-side to observe Stage 1 Pre-Route (`Choice`, `Score`, pre-flight `Noul`s) selecting `Route-VertexFlash` vs. `Route-VertexPro` direct fast-track, and Stage 2 Decomposed 5-Head `Noul` Battery (`any_flag = max(nouls) > fire_threshold`) contrasted against the Holistic Single-Judge score.
7. **Reference Modals:**
   - **Architecture & Pricing Modal:** Maps all 5 tabs to Apigee policies and publishes exact Vertex AI & TypeSafe Jev unit rates.
   - **4-Tab System 1 & Noul Battery Glossary Modal:** Plain-English definitions of `Noul`, `Noul Battery`, `Choice`, `Score`, System 1 vs. System 2 cascades, ML calibration/logits/ECE, and comparison against DeBERTa-v3-NLI, RouteLLM, and Vectara HHEM-2.1.

## Operating Context

- **Operational Pressure:** Delivered live in front of enterprise executive and staff-engineer rooms on conference projectors, shared external laptops, and wide desktop monitors (5–10 minute paced demo script in `DEMO_SCRIPT.md`, followed by unscripted technical probing).
- **Dual-Ingress Access:** Public no-login URL via `jw-apigeex-0` XLB OIDC bridge (`https://eval-group.34-120-155-152.nip.io/v1/ai-economics/ui`) and Googler IAP Cloud Run URL (`apigee-ai-economics-demo`) with automatic `401/403` client-side failover to the XLB bridge.
- **Live Cloud Latency:** Real requests take `~0.2s` (cache short-circuit or Model Armor block) to `~5–15s` (LLMLingua-2 CPU compression or Gemini 2.5 Pro reasoning), requiring clear in-flight execution feedback without freezing the interface.

## Capabilities and Constraints

- **Stack:** Vanilla HTML5, CSS3, and modular ES JavaScript (`services/demo-ui/static/index.html`, `services/demo-ui/static/assets/styles.css`, `services/demo-ui/static/assets/app.js`) served by a FastAPI BFF (`services/demo-ui/app/main.py`) with zero frontend build step required.
- **Published Pricing Schedule (Canonical):**
  - `gemini-2.5-pro`: `$1.25 / 1M` input, `$10.00 / 1M` output & `thoughtsTokenCount`.
  - `gemini-2.5-flash`: `$0.30 / 1M` input, `$2.50 / 1M` output & `thoughtsTokenCount`.
  - `jev-latest` (TypeSafe System 1): `$0.042 / 1M` input, `$0.00` output.
  - `text-embedding-005`: `$0.025 / 1M` input, `$0.00` output.
- **Explicit Disclosure Constraints (`HONESTY_AND_TRADEOFFS.md`):**
  - Tab 5's `simulate_l1_defect` checkbox must remain visible, explicitly labeled, and user-controllable so stage demonstrations of Stage 2 escalation are transparent.
  - Tab 4's Vector Search node status and suspend/wake cost control (`~$1.08/hr` active vs. `$0.00/hr` suspended) must remain surfaced.
  - `<SemanticGovernance>` runtime `1-18-0-apigee-10` fallback behavior (`JS-EnrichPolicyTelemetry` + `RF-SemanticGovernanceViolation`, preserving native XML in `reference-policies/`) must never be misrepresented.

## Evidence on Hand

- Live deployed infrastructure across `apac-cs-5g-demo5` and `jw-apigeex-0` documented in `README.md`.
- Presenter walkthrough script in `DEMO_SCRIPT.md`.
- Accounting rules and architectural trade-offs in `HONESTY_AND_TRADEOFFS.md`.
- Curated preset payloads and policy XML templates in `services/demo-ui/app/scenarios.py` and `services/demo-ui/app/policies_scenarios.py`.
- No customer logos, external testimonials, or synthetic benchmark claims exist; future work must not fabricate them.

## Non-Regression Invariants & Product Principles

1. **Zero-Fudge Telemetry Accounting:** Never hide or omit `thoughtsTokenCount`, embedding tokens, pruning summarizer overhead, Jev System 1 fees, or double-billed $L_1 + L_2$ escalation tokens from billed totals or side-by-side comparisons.
2. **Simultaneous Side-by-Side Parity:** Every primary demo tab must preserve parallel Direct Vertex AI vs. Apigee X execution and clear visual comparison of status, cost, token breakdown, latency, and response content.
3. **Full Inspection Depth on Demand:** Executive summary metrics sit on top; staff-engineer inspection drawers (prompt diffs, cascade scores, native Apigee XML, HTTP headers, raw JSON, and 5-head `Noul` probabilities) must remain one click away without obscuring the primary ledger.
4. **Live Pipeline Honesty:** Visual pipeline diagrams, cost/token charts, quota meters, and `Noul` battery bars must be driven exclusively by live BFF response telemetry—never hardcoded or simulated outside the explicitly labeled `simulate_l1_defect` toggle.
5. **Preserve Existing API & DOM Contracts:** Retain all BFF endpoints (`/api/compare`, `/api/policies/execute`, `/api/system1/execute`, `/api/vector-search/*`, `/api/reset`, `/api/scenarios`, `/api/policies/presets`), IAP-to-XLB failover behavior, and all 5 tabs + 2 reference modals.

## Accessibility & Inclusion

- **Standard:** WCAG 2.1 AA minimum across both Light and Dark themes (`>= 4.5:1` contrast for all body, label, and status text; `>= 3:1` for graphical indicators and large headings).
- **Keyboard & Assistive Semantics:** Complete ARIA tablist/tabpanel (`role="tab"`, `aria-selected`, `aria-controls`), modal dialog (`role="dialog"`, `aria-modal="true"`, Escape-to-close, focus return), `role="switch"` controls with accessible hit areas, and visible focus outlines on every interactive control.
- **Motion Sensitivity:** Respect `prefers-reduced-motion: reduce` across all pipeline pulses and chart fill animations.
- **Legibility Under Presentation Conditions:** Minimum `12px` font size everywhere and tabular alignment on all numerical comparisons so conference-room projections stay scannable at distance.
