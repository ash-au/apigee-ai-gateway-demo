# Apigee X as an AI Gateway — Token Economics, Native AI Policies & System 1 (TypeSafe Jev) Routing

A live, end-to-end Google Cloud reference implementation (`australia-southeast1` / Sydney) proving how **Apigee X** acts as an enterprise AI Gateway to reduce LLM token consumption and inference cost by **50%–99%+**, enforce all **7 Native Apigee X AI Policies**, and execute **System 1 (TypeSafe Jev) + System 2 (Vertex AI Gemini) Dynamic Routing & Decomposed `Noul` Battery Cascades**.

---

## Core Capabilities Across All 5 Interactive Tabs

1. **Tab 1: AI Cost & Token Economics (`FrugalGPT` + `LLMLingua-2` + Firestore/In-Memory Cache)**
   * **FrugalGPT (`arXiv:2305.05176` — Stanford University):**
     * *Semantic Completion Cache (§3.1):* Embeds queries via Vertex AI `text-embedding-005` (`768`-dim) in `australia-southeast1`. If cosine similarity $\ge 0.85$, Apigee X executes a targetless `<RouteRule name="Route-CacheShortCircuit">` and returns the cached response at **0 LLM tokens** (`~$0.0000007` embedding lookup cost).
     * *Sequential LLM Cascade (§3.3):* Routes first to $L_1$ (`gemini-2.5-flash`) and evaluates post-generation reliability $g(q, a) \in [0, 1]$ using `avgLogprobs`, `finishReason`, and structural checks—escalating to $L_2$ (`gemini-2.5-pro`) when $g(q, a) < 0.80$.
   * **LLMLingua / LLMLingua-2 (`arXiv:2310.05736` / `arXiv:2403.12968` — Microsoft Research):**
     * *Coarse-to-Fine Budget Controller (§3.1):* Preserves User Query at $\tau_{\text{query}} = 1.00$ and System Instructions at $\tau_{\text{instr}} = 0.85$ while pruning RAG context ($\tau_{\text{rag}} = 0.35$) via `microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank`.

2. **Tabs 2, 3 & 4: All 7 Native Apigee X AI Policies**
   * **Tab 2 (`POST /v1/ai-economics/policies/token-governance`):**
     1. `<PromptTokenLimit>` (`PTL-EnforcePromptLimit`): Pre-flight token spike arrest on inbound prompts (`0` output tokens wasted when blocked).
     2. `<LLMTokenQuota>` (`LTQ-EnforceOnly` & `LTQ-EnforceTokenQuota`): Distributed per-consumer token budget enforcement using real Vertex AI `usageMetadata.totalTokenCount`.
   * **Tab 3 (`POST /v1/ai-economics/policies/model-armor`):**
     3. `<SanitizeUserPrompt>` (`SUP-SanitizeUserPrompt`): Native Google Cloud Model Armor (`apigee-ai-safety-template`) blocking prompt injections, jailbreaks, and PII/PCI credit-card/SSN leaks in the Apigee Request Flow.
     4. `<SanitizeModelResponse>` (`SMR-SanitizeModelResponse`): Outbound Model Armor inspection blocking malicious phishing URLs and unsafe model completions in the Apigee Response Flow.
   * **Tab 4 (`POST /v1/ai-economics/policies/semantic-governance` & `/policies/native-cache`):**
     5. `<SemanticCacheLookup>` (`SCL-NativeSemanticCacheLookup`): Zero-code native Apigee XML semantic cache lookup using `text-embedding-005` + Vertex AI Vector Search (`SHARD_SIZE_MEDIUM`).
     6. `<SemanticCachePopulate>` (`SCP-NativeSemanticCachePopulate`): Zero-code native Apigee XML vector index population on cache misses.
     7. `<SemanticGovernance>` (`SG-EnforceEnterpriseDomain`): Declarative domain guardrail enforcement via Gemini (`enterprise-domain-guardrail`).

3. **Tab 5: System 1 (`TypeSafe Jev`) & System 2 (`Vertex AI Gemini`) Dynamic Routing & `Noul` Battery Cascade**
   * Integrates **TypeSafe Jev** (`POST https://api.typesafe.ai/v1/systemone`, `model="jev-latest"` $\rightarrow$ `jev-1.13.0`, **`$0.042 / 1M` input tokens**, **`$0.00` output tokens**, `~195ms` single-pass calibrated logits) directly into Apigee X (`POST /v1/ai-economics/system1-routing`):
     * **Stage 1 Pre-Flight Router (`SC-JevPreRoute`):** Evaluates `target_tier` (`Choice`: `flash_fast` | `flash_with_verifier` | `pro_system2_direct` + calibrated `confidence`), `complexity` (`Score` $0..2$ expected value), and pre-flight `Noul`s (`requires_formal_proof`, `has_strict_multi_constraints`). Dynamically sets `ai.routing_decision` so Apigee's `<RouteRule name="Route-VertexFlash">` or `<RouteRule name="Route-VertexPro">` either routes to $L_1$ Flash or **fast-tracks directly to System 2 (`gemini-2.5-pro`)** on formal proofs (skipping a doomed $L_1$ call).
     * **Stage 2 Post-Verifier (`SC-JevPostVerify`):** Audits $L_1$ (`gemini-2.5-flash`) completions using a **Decomposed 5-Head `Noul` Battery** (`hallucinated_or_contradicts_context`, `missed_user_constraint`, `superficial_or_unproven`, `internal_contradiction`, `hedging_or_refusal`), plus `__overall__::holistic_escalate_judge` and `response_quality` (`Score` $0..2$). Applies TypeSafe's **`any_flag = max(nouls) > fire_threshold` (`0.70`)** gate to catch subtle hallucinations or missed constraints that single holistic judges miss, automatically escalating to $L_2$ `gemini-2.5-pro`.
   * Includes an interactive **4-Tab "System 1 & Noul Battery Glossary" Modal** in the UI explaining `Noul`, `Noul Battery`, `Choice`, `Score`, Single-Pass vs. Autoregressive Inference, Logits, Calibrated Softmax, Expected Calibration Error (ECE), Selective Prediction, and a comparison against DeBERTa-v3-NLI, UC Berkeley RouteLLM, and Vectara HHEM-2.1.

---

## Live Deployed Endpoints (`apac-cs-5g-demo5` / `australia-southeast1`)

| Component | GCP Project / Apigee Org | Environment / Revision | Live URL / Resource | Runtime Service Account |
| :--- | :--- | :--- | :--- | :--- |
| **Demo UI & Side-by-Side BFF (Google IAP)** | `apac-cs-5g-demo5` (`australia-southeast1`) | `apigee-ai-economics-demo` (`rev 00007`) | **`https://apigee-ai-economics-demo-1019413155504.australia-southeast1.run.app`** | `demo-bff-sa@apac-cs-5g-demo5.iam.gserviceaccount.com` |
| **Apigee Southbound BFF Target** | `apac-cs-5g-demo5` (`australia-southeast1`) | `apigee-ai-economics-bff` (`rev 00007`) | `https://apigee-ai-economics-bff-1019413155504.australia-southeast1.run.app` | `demo-bff-sa@apac-cs-5g-demo5.iam.gserviceaccount.com` |
| **Apigee X AI Gateway Proxy (`ai-gateway-v1`)** | `apac-cs-5g-demo5` (`australia-southeast1`) | **Environment:** `demo` (`Revision 11`) | **`https://10.106.240.2.nip.io/v1/ai-economics`** | `apigee-ai-gw-sa@apac-cs-5g-demo5.iam.gserviceaccount.com` |
| **Gateway Optimizer & Jev Engine (`gateway-optimizer`)** | `apac-cs-5g-demo5` (`australia-southeast1`) | `gateway-optimizer` (`rev 00003`) | `https://gateway-optimizer-1019413155504.australia-southeast1.run.app` | `gw-optimizer-sa@apac-cs-5g-demo5.iam.gserviceaccount.com` |
| **TypeSafe Jev API Key Secret** | `apac-cs-5g-demo5` | Secret Manager | `projects/apac-cs-5g-demo5/secrets/typesafe-api-key` | Mounted as `TYPESAFE_API_KEY` on `gateway-optimizer` |
| **Model Armor Safety Template** | `apac-cs-5g-demo5` (`us-central1`) | `apigee-ai-safety-template` | `projects/apac-cs-5g-demo5/locations/us-central1/templates/apigee-ai-safety-template` | `apigee-ai-gw-sa@apac-cs-5g-demo5.iam.gserviceaccount.com` |
| **Vertex AI Vector Search (`SHARD_SIZE_MEDIUM`)** | `apac-cs-5g-demo5` (`australia-southeast1`) | `apigee-semantic-cache-endpoint` (`3216599276826132480`) | `https://958897680.australia-southeast1-1019413155504.vdb.vertexai.goog` | `apigee-ai-gw-sa@apac-cs-5g-demo5.iam.gserviceaccount.com` |

---

## Summary of All 5 UI Tabs & Apigee X Flows

| UI Tab | Apigee X Conditional Flow | Policies / Callouts Invoked | What It Proves |
| :--- | :--- | :--- | :--- |
| **Tab 1: AI Cost & Token Economics** | `POST /v1/ai-economics/chat` | `SC-PreOptimize`, `SC-EvaluateAndCascade`, `Route-CacheShortCircuit` | FrugalGPT semantic caching + L1/L2 model cascades + LLMLingua-2 prompt compression + multi-turn context pruning. |
| **Tab 2: Token FinOps & Quotas** | `POST /v1/ai-economics/policies/token-governance` | 1. `PTL-EnforcePromptLimit` (`<PromptTokenLimit>`)<br>2. `LTQ-EnforceTokenQuota` (`<LLMTokenQuota>`) | Pre-flight prompt token spike arrest (`X-Prompt-Token-Limit`) and rolling 1-minute token quota chargeback (`X-Quota-Limit`) using real Vertex AI `usageMetadata.totalTokenCount`. |
| **Tab 3: AI Safety & Model Armor** | `POST /v1/ai-economics/policies/model-armor` | 3. `SUP-SanitizeUserPrompt` (`<SanitizeUserPrompt>`)<br>4. `SMR-SanitizeModelResponse` (`<SanitizeModelResponse>`) | Native Google Cloud Model Armor integration blocking prompt injections, jailbreaks, PII/PCI credit-card leaks, and malicious URLs at the gateway edge (`0` LLM tokens billed on inbound blocks). |
| **Tab 4: Semantic Governance & Native Cache** | `POST /v1/ai-economics/policies/semantic-governance`<br>`POST /v1/ai-economics/policies/native-cache` | 5. `SCL-NativeSemanticCacheLookup` (`<SemanticCacheLookup>`)<br>6. `SCP-NativeSemanticCachePopulate` (`<SemanticCachePopulate>`)<br>7. `SG-EnforceEnterpriseDomain` (`<SemanticGovernance>`) | Declarative domain guardrails via `<SemanticGovernance>` + zero-code XML semantic caching backed by Vertex AI Vector Search (`SHARD_SIZE_MEDIUM` / `e2-standard-16`), plus 1-click UI & CLI node suspend/wake controls. |
| **Tab 5: System 1 (Jev) & System 2 Routing** | `POST /v1/ai-economics/system1-routing` | `JS-PrepareJevPreRoute`, `SC-JevPreRoute`, `JS-ProcessJevPreRoute`, `Route-VertexFlash` / `Route-VertexPro`, `JS-PrepareJevPostVerify`, `SC-JevPostVerify`, `JS-BuildJevFinalResponse` | Two-stage confidence-gated routing (`Choice` + `Score` + Pre-`Noul`s), Direct System 2 Fast-Track for formal proofs, and Stage 2 Decomposed 5-Head `Noul` Battery verification (`any_flag > 0.70`) via TypeSafe Jev (`jev-latest`). |

---

## Architecture Diagram (Tabs 1–5)

```text
                       ┌────────────────────────────────────────────────────────────────────┐
                       │         5-Tab Demo UI + FastAPI Side-by-Side BFF (Cloud Run)       │
                       │    Parallel Execution: Direct Vertex AI vs. Apigee X AI Gateway    │
                       └───────────────┬────────────────────────────────────┬───────────────┘
                                       │                                    │
         (A) Unoptimized Baseline      │                                    │ (B) Governed Apigee X Gateway Path
         Direct to Vertex AI           │                                    │ https://10.106.240.2.nip.io/v1/ai-economics
                                       ▼                                    ▼
                       ┌───────────────────────────┐ ┌──────────────────────────────────────────────────────┐
                       │ Vertex AI Gemini 2.5 Pro  │ │ Apigee X Proxy: ai-gateway-v1 (Env: demo, Rev 11)    │
                       │ ($1.25/1M in, $10/1M out) │ │                                                      │
                       └───────────────────────────┘ │  • Tab 1 (/chat):                                    │
                                                     │    SC-PreOptimize (Cache + Prune + LLMLingua-2)      │
                                                     │    -> Route-VertexFlash / Pro -> SC-EvaluateCascade  │
                                                     │                                                      │
                                                     │  • Tabs 2–4 (/policies/*):                           │
                                                     │    7 Native Apigee XML Policies:                     │
                                                     │    PromptTokenLimit, LLMTokenQuota,                  │
                                                     │    SanitizeUserPrompt, SanitizeModelResponse,        │
                                                     │    SemanticCacheLookup/Populate, SemanticGovernance  │
                                                     │                                                      │
                                                     │  • Tab 5 (/system1-routing):                         │
                                                     │    1. PreFlow: SC-JevPreRoute -> TypeSafe Jev        │
                                                     │       (Choice + Score + Pre-Nouls in ~195ms)         │
                                                     │    2. Dynamic RouteRules:                            │
                                                     │       ├── Route-VertexFlash (L1 gemini-2.5-flash)    │
                                                     │       └── Route-VertexPro (Direct System 2 FastTrack)│
                                                     │    3. PostFlow: SC-JevPostVerify -> TypeSafe Jev     │
                                                     │       (5-Head Decomposed Noul Battery: any_flag>0.70)│
                                                     │       └── Accept L1 Flash OR Escalate to L2 Pro      │
                                                     └──────────────────────────────────────────────────────┘
```

---

## Repository Structure

```text
.
├── README.md                          # Architecture, 5-tab guide, deployment, and troubleshooting
├── DEMO_SCRIPT.md                     # Live presenter script covering Tabs 1–5
├── HONESTY_AND_TRADEOFFS.md           # Candid engineering notes on accounting, Jev Noul battery & trade-offs
├── infra/
│   ├── 01_setup_gcp_and_iam.sh        # Provisions least-privilege Service Accounts & IAM bindings
│   ├── 02_setup_apigee_ingress.sh     # Sets up Apigee PSC NEG & HTTPS Load Balancer ingress
│   ├── 03_deploy_apigee_proxy.sh      # Packages, imports, and deploys ai-gateway-v1 to Apigee X
│   ├── 04_deploy_demo_ui.sh           # Builds & deploys apigee-ai-economics-demo & BFF to Cloud Run
│   └── toggle_vector_search.sh        # CLI helper to check, wake (on), or suspend (off) Vector Search node
├── apigee/
│   ├── proxies/ai-gateway-v1/         # Complete Apigee X API proxy bundle (7 native AI policies + Jev + JS)
│   └── tests/test_apigee_proxy_live.sh# End-to-end live curl test suite against Apigee X
└── services/
    ├── gateway-optimizer/             # FastAPI service: LLMLingua-2, FrugalGPT cascade & TypeSafe Jev engine
    │   └── app/
    │       ├── main.py                # FastAPI endpoints (/v1/optimize/* and /v1/jev/*)
    │       ├── jev_router.py          # Tab 5 TypeSafe Jev Stage 1 Pre-Router & Stage 2 5-Head Noul Battery
    │       ├── compressor.py          # LLMLingua-2 Coarse-to-Fine prompt compression
    │       ├── cascade.py             # FrugalGPT L1->L2 reliability scorer
    │       ├── cache.py               # Semantic completion cache (text-embedding-005)
    │       └── pruner.py              # Multi-turn context pruner & session deduplicator
    └── demo-ui/                       # FastAPI side-by-side BFF + 5-Tab UI + System 1 Glossary Modal
```

---

## Reproducible Deployment Instructions

### Prerequisites
* `gcloud` CLI authenticated with permissions on `apac-cs-5g-demo5` (Apigee environment `demo`).
* TypeSafe Jev API key stored in Google Cloud Secret Manager (`projects/apac-cs-5g-demo5/secrets/typesafe-api-key`).

### 1. Provision Service Accounts & IAM
```bash
./infra/01_setup_gcp_and_iam.sh
```

### 2. Deploy `gateway-optimizer` (with Secret Manager `TYPESAFE_API_KEY`)
```bash
gcloud run deploy gateway-optimizer \
  --source=services/gateway-optimizer \
  --project=apac-cs-5g-demo5 \
  --region=australia-southeast1 \
  --service-account=gw-optimizer-sa@apac-cs-5g-demo5.iam.gserviceaccount.com \
  --no-allow-unauthenticated \
  --cpu=2 --memory=2Gi --min-instances=1 --max-instances=5 --timeout=120 \
  --set-env-vars="GCP_PROJECT_ID=apac-cs-5g-demo5,GCP_REGION=australia-southeast1" \
  --set-secrets="TYPESAFE_API_KEY=typesafe-api-key:latest"
```

### 3. Package & Deploy the Apigee X Proxy (`ai-gateway-v1`)
```bash
./infra/03_deploy_apigee_proxy.sh
```

### 4. Deploy the 5-Tab Frontend & Side-by-Side BFF (`apigee-ai-economics-demo` & `apigee-ai-economics-bff`)
```bash
./infra/04_deploy_demo_ui.sh
```

### 5. Suspend or Wake the Vertex AI Vector Search Node (`$0/hr` Idle Mode)
```bash
# Check live Vector Search Index, Endpoint & Deployed Node state
./infra/toggle_vector_search.sh status

# Suspend node (undeploys index from endpoint -> $0.00/hr compute cost)
./infra/toggle_vector_search.sh off

# Wake node before a live demo of Tab 4 native <SemanticCacheLookup>
./infra/toggle_vector_search.sh on
```
