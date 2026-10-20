# Apigee X as an AI Gateway — Proving the Token & Cost Economics

A live, end-to-end Google Cloud reference implementation (`australia-southeast1` / Sydney) proving that an API management gateway (**Apigee X**) reduces enterprise LLM token consumption and inference cost by **50%–99%+** while preserving response quality.

This system operationalizes two foundational peer-reviewed papers directly inside the **Apigee X + Cloud Run + Vertex AI** request/response pipeline:

1. **FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance**
   * *Authors:* Lingjiao Chen, Matei Zaharia, James Zou (Stanford University, 2023) — [`arXiv:2305.05176`](https://arxiv.org/abs/2305.05176)
   * *Mechanisms Implemented:*
     * **Section 3.1 (LLM Approximation / Semantic Completion Cache):** Embeds incoming queries via Vertex AI `text-embedding-005` (`768` dimensions) in `australia-southeast1`. If cosine similarity $\ge 0.85$ within the active system/scenario namespace, Apigee X executes a targetless `<RouteRule name="Route-CacheShortCircuit">` and returns the cached completion at **0 LLM tokens** (`~$0.0000007` embedding lookup cost).
     * **Section 3.3 (Sequential LLM Cascade):** Routes requests first to $L_1$ (`gemini-2.5-flash` in `australia-southeast1`, `$0.30/1M` input, `$2.50/1M` output). In the Apigee X `PostFlow`, a calibrated reliability scorer $g(q, f_{L_1}(q)) \in [0, 1]$ evaluates token log-probabilities (`avgLogprobs`), `finishReason`, structural completeness, and uncertainty markers. If $g(q, a) < 0.80$, the gateway automatically escalates to $L_2$ (`gemini-2.5-pro`, `$1.25/1M` input, `$10.00/1M` output) and transparently bills **both** the $L_1$ attempt and the $L_2$ completion.

2. **LLMLingua / LLMLingua-2: Compressing Prompts for Accelerated Inference of Large Language Models**
   * *Authors:* Huiqiang Jiang, Qianhui Wu, Chin-Yew Lin, Yuqing Yang, Lili Qiu (Microsoft Research, EMNLP 2023 / ACL 2024) — [`arXiv:2310.05736`](https://arxiv.org/abs/2310.05736)
   * *Mechanisms Implemented:*
     * **Section 3.1 (Coarse-to-Fine Budget Controller):** Assigns distinct token retention budgets by prompt structural role rather than uniformly truncating text:
       * System Instructions: $\tau_{\text{instr}} = 0.85$
       * Retrieved RAG Context & Few-Shot Demonstrations: $\tau_{\text{rag}} = 0.35$ (after coarse-level embedding similarity filtering of demonstrations)
       * User Query: $\tau_{\text{query}} = 1.00$ (never compressed)
     * **Token-Level Extractive Compression:** Runs `microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank` on Cloud Run CPU to prune low-information tokens before Apigee X dispatches the southbound request to Vertex AI.

---

## Live Deployed Endpoints (`apac-cs-5g-demo5` / `australia-southeast1`)

| Component | GCP Project / Apigee Org | Environment / Service | Live URL / Endpoint | Runtime Service Account |
| :--- | :--- | :--- | :--- | :--- |
| **Demo UI & Side-by-Side BFF (Google IAP)** | `apac-cs-5g-demo5` (`australia-southeast1`) | `apigee-ai-economics-demo` | **`https://apigee-ai-economics-demo-1019413155504.australia-southeast1.run.app`** | `demo-bff-sa@apac-cs-5g-demo5.iam.gserviceaccount.com` |
| **Apigee X AI Economics Proxy (`ai-gateway-v1`)** | `apac-cs-5g-demo5` (`australia-southeast1`) | **Environment:** `demo` (`demo-group`) | **`https://10.106.240.2.nip.io/v1/ai-economics/chat`** *(via Direct VPC Egress)* | `apigee-ai-gw-sa@apac-cs-5g-demo5.iam.gserviceaccount.com` |
| **Gateway Optimizer Callout (`gateway-optimizer`)** | `apac-cs-5g-demo5` (`australia-southeast1`) | `gateway-optimizer` | `https://gateway-optimizer-1019413155504.australia-southeast1.run.app` | `gw-optimizer-sa@apac-cs-5g-demo5.iam.gserviceaccount.com` |

---

## Architecture & Request Flow

```
                       ┌─────────────────────────────────────────────────────────────┐
                       │          Editorial Demo UI + FastAPI BFF (Cloud Run)        │
                       │               POST /api/compare (asyncio.gather)            │
                       └───────────────┬─────────────────────────────┬───────────────┘
                                       │                             │
         (A) Point-to-Point Baseline   │                             │ (B) Governed Gateway Path
         No Gateway / Unoptimized      │                             │ Headers: X-Opt-Cache, X-Opt-Compress,
                                       │                             │          X-Opt-Route, X-Opt-Prune
                                       ▼                             ▼
                       ┌───────────────────────────┐ ┌───────────────────────────────────────────────┐
                       │ Vertex AI Gemini 2.5 Pro  │ │ Apigee X Proxy: ai-gateway-v1 (/v1/ai-economics)│
                       │ ($1.25/1M in, $10/1M out) │ │  1. PreFlow: SC-PreOptimize (<GoogleIDToken>) │
                       └───────────────────────────┘ │     ├── Semantic Cache (text-embedding-005)   │
                                                     │     ├── Multi-Turn Context Pruning (Flash)    │
                                                     │     ├── LLMLingua-2 Prompt Compression        │
                                                     │     └── Complexity Router (Flash vs Pro)      │
                                                     │  2. Conditional RouteRules:                   │
                                                     │     ├── Route-CacheShortCircuit (0 LLM tok)   │
                                                     │     ├── Route-VertexFlash (Sydney L1)         │
                                                     │     └── Route-VertexPro (Global L2)           │
                                                     │  3. PostFlow: SC-EvaluateAndCascade           │
                                                     │     └── Scorer g(q,a) >= 0.80 or L2 Cascade   │
                                                     └───────────────────────────────────────────────┘
```

---

## Repository Structure

```text
.
├── README.md                          # Architecture, setup, deployment, and troubleshooting guide
├── DEMO_SCRIPT.md                     # 5-minute live presenter script for executive & technical audiences
├── HONESTY_AND_TRADEOFFS.md           # Candid engineering notes on heuristics, latency, and token accounting
├── infra/
│   ├── 01_setup_gcp_and_iam.sh        # Provisions least-privilege Service Accounts & IAM bindings
│   ├── 02_deploy_optimizer.sh         # Builds & deploys gateway-optimizer to Cloud Run (australia-southeast1)
│   ├── 03_deploy_apigee_proxy.sh      # Packages, imports, and deploys ai-gateway-v1 to Apigee X
│   └── 04_deploy_demo_ui.sh           # Builds & deploys apigee-ai-economics-demo UI/BFF to Cloud Run
├── apigee/
│   ├── proxies/ai-gateway-v1/         # Complete Apigee X API proxy bundle (XML policies + Rhino JS)
│   └── tests/test_apigee_proxy_live.sh# End-to-end live curl test suite against Apigee X
└── services/
    ├── gateway-optimizer/             # FastAPI + LLMLingua-2 + FrugalGPT cascade & semantic cache service
    └── demo-ui/                       # FastAPI side-by-side BFF + Editorial HTML/CSS/JS frontend
```

---

## Reproducible Deployment Instructions

### Prerequisites
* `gcloud` CLI authenticated with permissions on `apac-cs-5g-demo5` and Apigee organization `jw-apigeex-0`.
* Python 3.11+ and `zip` installed locally.

### Step 1: Provision Service Accounts & IAM
```bash
./infra/01_setup_gcp_and_iam.sh
```

### Step 2: Deploy the Gateway Optimizer Service to Cloud Run
```bash
./infra/02_deploy_optimizer.sh
```

### Step 3: Package & Deploy the Apigee X Proxy (`ai-gateway-v1`)
```bash
./infra/03_deploy_apigee_proxy.sh
```
Run the live Apigee X smoke test suite:
```bash
./apigee/tests/test_apigee_proxy_live.sh
```

### Step 4: Deploy the Editorial Frontend & Side-by-Side BFF
```bash
./infra/04_deploy_demo_ui.sh
```

---

## Troubleshooting

1. **Cloudtop Certificate-Based Access (CBA) `401 ACCESS_TOKEN_TYPE_UNSUPPORTED` when calling `apigee.googleapis.com`:**
   * On Google Cloudtop workstations with CBA enabled, access tokens are bound to the client certificate and must be sent to `https://apigee.mtls.googleapis.com`. Our deployment script (`infra/03_deploy_apigee_proxy.sh`) automatically uses `gcloud`'s bundled mTLS session (`googlecloudsdk.core.credentials.requests.GetSession()`) so deployment works seamlessly on CBA workstations.
2. **Apigee X Custom Response Headers Stripped if Prefixed with `X-Apigee-*`:**
   * Apigee X's Envoy ingress reserves the `X-Apigee-*` namespace for internal system headers and strips custom headers with that prefix on outbound responses. All custom gateway telemetry headers use `X-AI-Gateway-*` (`X-AI-Gateway-Cache-Status`, `X-AI-Gateway-Model-Used`, `X-AI-Gateway-Total-Cost-USD`, etc.).
3. **`gemini-2.5-pro` Regional Availability vs. `gemini-2.5-flash`:**
   * `gemini-2.5-flash` and `text-embedding-005` run directly on the regional `australia-southeast1-aiplatform.googleapis.com` endpoint. `gemini-2.5-pro` is invoked via the Vertex AI `global` endpoint (`aiplatform.googleapis.com/v1/projects/apac-cs-5g-demo5/locations/global/publishers/google/models/gemini-2.5-pro:generateContent`).
