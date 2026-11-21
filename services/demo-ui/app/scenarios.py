"""Curated Enterprise AI Scenarios & Pricing Schedule for the Apigee X AI Economics Demo."""

from typing import Any, Dict, List

PRICING_SCHEDULE: Dict[str, Any] = {
    "region": "australia-southeast1 (Sydney)",
    "currency": "USD",
    "models": {
        "gemini-2.5-pro": {
            "display_name": "Vertex AI Gemini 2.5 Pro",
            "endpoint": "locations/global/publishers/google/models/gemini-2.5-pro",
            "input_per_1m_usd": 1.25,
            "output_per_1m_usd": 10.00,
            "thinking_per_1m_usd": 10.00,
            "note": "Thinking tokens (thoughtsTokenCount) are billed at the output token rate ($10.00 / 1M).",
        },
        "gemini-2.5-flash": {
            "display_name": "Vertex AI Gemini 2.5 Flash",
            "endpoint": "locations/australia-southeast1/publishers/google/models/gemini-2.5-flash",
            "input_per_1m_usd": 0.30,
            "output_per_1m_usd": 2.50,
            "thinking_per_1m_usd": 2.50,
            "note": "4.17x cheaper on input and 4.0x cheaper on output than Gemini 2.5 Pro.",
        },
        "text-embedding-005": {
            "display_name": "Vertex AI Text Embedding 005",
            "endpoint": "locations/australia-southeast1/publishers/google/models/text-embedding-005",
            "input_per_1m_usd": 0.025,
            "output_per_1m_usd": 0.0,
            "note": "768-dimensional embeddings used for FrugalGPT Semantic Completion Cache.",
        },
        "gemini-decision-1": {
            "display_name": "Google Gemini Decision 1 (System 1)",
            "endpoint": "generativelanguage.googleapis.com/v1beta/decisions",
            "input_per_1m_usd": 0.10,
            "output_per_1m_usd": 0.0,
            "note": "Google's non-generative single-pass System 1 Decisions API (Choice, Score, Noul; 256K multimodal context; free output tokens).",
        },
        "jev-latest": {
            "display_name": "TypeSafe Jev (System 1)",
            "endpoint": "api.typesafe.ai/v1/systemone",
            "input_per_1m_usd": 0.042,
            "output_per_1m_usd": 0.0,
            "note": "TypeSafe single-pass calibrated System 1 model ($42/Btok input, free output tokens).",
        },
    },
    "papers": [
        {
            "title": "FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance",
            "authors": "Lingjiao Chen, Matei Zaharia, James Zou (Stanford University, 2023)",
            "arxiv": "arXiv:2305.05176",
            "url": "https://arxiv.org/abs/2305.05176",
            "mechanisms_used": [
                "Section 3.1: LLM Approximation / Semantic Completion Cache via vector embeddings",
                "Section 3.3: LLM Cascade — sequential L1 (Gemini 2.5 Flash) -> reliability scorer g(q, a) -> L2 (Gemini 2.5 Pro)",
            ],
        },
        {
            "title": "LLMLingua / LLMLingua-2: Compressing Prompts for Accelerated Inference of Large Language Models",
            "authors": "Huiqiang Jiang, Qianhui Wu, Chin-Yew Lin, Yuqing Yang, Lili Qiu (Microsoft Research, 2023/2024)",
            "arxiv": "arXiv:2310.05736 / arXiv:2403.12968",
            "url": "https://arxiv.org/abs/2310.05736",
            "mechanisms_used": [
                "Section 3.1: Coarse-grained Budget Controller assigning distinct retention ratios to System Instructions (tau_instr), RAG/Demos (tau_rag), and User Query (tau_q = 1.0)",
                "Token-level extractive compression via microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank on CPU",
            ],
        },
    ],
}

PRESET_SCENARIOS: List[Dict[str, Any]] = [
    {
        "id": "scenario-1-faq-miss",
        "step_number": 1,
        "title": "1. Tier-1 IT Support FAQ (Turn 1: Route & Index Cache)",
        "subtitle": "Routes a low-complexity query to Gemini 2.5 Flash and indexes the vector in the Semantic Cache",
        "optimization_focus": "Model Routing (Flash L1) + Cache Indexing",
        "recommended_toggles": {
            "semantic_cache": True,
            "prompt_compression": False,
            "model_routing": True,
            "context_pruning": False,
        },
        "session_id": "demo-it-faq-session",
        "scenario_id": "it-okta-mfa-faq",
        "system_instruction": (
            "You are the Enterprise IT Service Desk Assistant for an Australian financial services "
            "institution. Provide clear, actionable instructions in 3 concise bullet points."
        ),
        "rag_context": (
            "IT KB-2041 (Okta FastPass & MFA Device Lifecycle): Employees upgrading or replacing "
            "their mobile device must generate a temporary 15-minute enrollment passcode via the "
            "Self-Service Identity Portal (https://id.corp.example.com.au) using their corporate "
            "laptop TouchID/Windows Hello passkey, or contact the Sydney Service Desk (+61 2 8000 1199) "
            "for live video badge verification."
        ),
        "few_shot_examples": [],
        "conversation_history": [],
        "user_prompt": "How do I reset my corporate Okta MFA token if I just bought a new phone?",
        "compression_target_ratio": 0.45,
        "similarity_threshold": 0.85,
        "presenter_note": (
            "Run this first to populate the semantic cache. Notice how Apigee routes to Gemini 2.5 Flash "
            "(complexity = 0.15, reliability g(q,a) >= 0.90) instead of burning Gemini 2.5 Pro + Thinking tokens."
        ),
    },
    {
        "id": "scenario-2-faq-hit",
        "step_number": 2,
        "title": "2. Rephrased IT Support FAQ (Turn 2: Semantic Cache Hit)",
        "subtitle": "Different wording, same intent — Apigee short-circuits Vertex AI at 0 LLM tokens",
        "optimization_focus": "FrugalGPT Completion Cache (text-embedding-005 >= 0.85)",
        "recommended_toggles": {
            "semantic_cache": True,
            "prompt_compression": False,
            "model_routing": True,
            "context_pruning": False,
        },
        "session_id": "demo-it-faq-session",
        "scenario_id": "it-okta-mfa-faq",
        "system_instruction": (
            "You are the Enterprise IT Service Desk Assistant for an Australian financial services "
            "institution. Provide clear, actionable instructions in 3 concise bullet points."
        ),
        "rag_context": (
            "IT KB-2041 (Okta FastPass & MFA Device Lifecycle): Employees upgrading or replacing "
            "their mobile device must generate a temporary 15-minute enrollment passcode via the "
            "Self-Service Identity Portal (https://id.corp.example.com.au) using their corporate "
            "laptop TouchID/Windows Hello passkey, or contact the Sydney Service Desk (+61 2 8000 1199) "
            "for live video badge verification."
        ),
        "few_shot_examples": [],
        "conversation_history": [],
        "user_prompt": (
            "I upgraded my smartphone today and need to transfer or re-enroll my company Okta "
            "multi-factor authenticator app. What is the procedure?"
        ),
        "compression_target_ratio": 0.45,
        "similarity_threshold": 0.85,
        "presenter_note": (
            "Run immediately after Scenario 1. Zero words overlap verbatim in the phrasing, yet "
            "text-embedding-005 computes cosine similarity ~0.87 >= 0.85. Apigee executes Route-CacheShortCircuit: "
            "0 LLM tokens, ~$0.0000007 embedding cost (>99.9% savings), ~350ms latency."
        ),
    },
    {
        "id": "scenario-3-rag-compression",
        "step_number": 3,
        "title": "3. Verbose RAG Compliance Audit (LLMLingua-2 Compression)",
        "subtitle": "Prunes redundant legal boilerplate & irrelevant retrieved chunks before LLM inference",
        "optimization_focus": "LLMLingua-2 Coarse-to-Fine Prompt Compression + Flash Routing",
        "recommended_toggles": {
            "semantic_cache": False,
            "prompt_compression": True,
            "model_routing": True,
            "context_pruning": False,
        },
        "session_id": "demo-rag-compliance",
        "scenario_id": "apra-cps234-rag",
        "system_instruction": (
            "You are a Cloud Security & APRA CPS 234 Compliance Auditor. Answer the user's question "
            "using strictly the retrieved policy excerpts in 3 concise bullet points citing exact "
            "regions, encryption standards, and retention numbers."
        ),
        "rag_context": (
            "DOCUMENT 1 (ENTERPRISE CLOUD DATA SOVEREIGNTY STANDARD v4.2 - SECTION 9.1): "
            "In accordance with our global enterprise data governance framework and APRA Prudential "
            "Standard CPS 234 (Information Security), it is strictly mandated that all Customer "
            "Personally Identifiable Information (PII), core banking ledger snapshots, and Payment "
            "Card Industry Data Security Standard (PCI-DSS v4.0) workloads deployed on Google Cloud "
            "Platform must reside exclusively within the australia-southeast1 (Sydney) or "
            "australia-southeast2 (Melbourne) regions. Cross-border replication of unmasked customer "
            "records to non-Australian regions is strictly prohibited under Australian Privacy "
            "Principle 8 (APP 8). Furthermore, all persistent disks, Cloud SQL instances, and BigQuery "
            "datasets storing Tier-1 regulated data must utilize Customer-Managed Encryption Keys "
            "(CMEK) hosted in Cloud KMS with a mandatory 90-day automatic key rotation schedule and "
            "365-day immutable Cloud Audit Log retention.\n\n"
            "DOCUMENT 2 (LEGACY ARCHIVE DUPLICATE - 2024 COMPLIANCE BULLETIN): "
            "As previously communicated in the quarterly compliance bulletin, in accordance with our "
            "global enterprise data governance framework, it is strictly required that all Customer "
            "Personally Identifiable Information (PII) and Payment Card Industry (PCI-DSS) workloads "
            "deployed on Google Cloud Platform must reside exclusively within the australia-southeast1 "
            "(Sydney) or australia-southeast2 (Melbourne) regions.\n\n"
            "DOCUMENT 3 (RETRIEVED VECTOR NOISE - SYDNEY FACILITIES MEMO #882): "
            "Please be advised that the Level 14 commercial espresso machine and chilled sparkling "
            "water tap in the Sydney Barangaroo headquarters will undergo scheduled quarterly "
            "descaling maintenance this Friday between 14:00 and 16:00 AEST. Staff and visiting "
            "contractors are encouraged to utilize the Level 12 client pantry during this window."
        ),
        "few_shot_examples": [
            "Example Q: Where must Tier-1 regulated data keys be managed?\nExample A: In Cloud KMS using Customer-Managed Encryption Keys (CMEK) with a 90-day rotation schedule.",
            "Example Q: What is the office Wi-Fi password for guests?\nExample A: Guest Wi-Fi credentials are provisioned at the Barangaroo ground floor concierge desk.",
        ],
        "conversation_history": [],
        "user_prompt": (
            "Which GCP regions are approved for Customer PII and PCI-DSS workloads, what encryption "
            "key policy applies, and how long must audit logs be retained?"
        ),
        "compression_target_ratio": 0.38,
        "similarity_threshold": 0.85,
        "presenter_note": (
            "Open the 'Prompt Compression Diff' tab below after running: LLMLingua-2 strips the irrelevant "
            "few-shot example and prunes low-information tokens across the 3 RAG documents by ~55%, while "
            "preserving every compliance entity (australia-southeast1/2, APP 8, CMEK 90-day, 365-day logs)."
        ),
    },
    {
        "id": "scenario-4-context-pruning",
        "step_number": 4,
        "title": "4. Multi-Turn SEV-2 Incident Bridge (Context Pruning & Dedup)",
        "subtitle": "Strips repeated incident headers, verbose pod/SQL dumps & filler turns (~3,000 -> ~450 tokens)",
        "optimization_focus": "Zero-LLM Cross-Turn Deduplication, Log Compaction & Rolling State Summary",
        "recommended_toggles": {
            "semantic_cache": False,
            "prompt_compression": False,
            "model_routing": False,
            "context_pruning": True,
        },
        "session_id": "demo-sev2-incident",
        "scenario_id": "sev2-incident-4912",
        "system_instruction": (
            "You are an SRE Incident Commander assistant. Provide a crisp executive post-mortem "
            "summary covering: (1) Root Cause, (2) Peak Impact, and (3) Mitigation Verification."
        ),
        "rag_context": "",
        "few_shot_examples": [],
        "conversation_history": [
            {
                "role": "user",
                "content": (
                    "[INCIDENT-BRIDGE-HEADER: SEV-2 #4912 | REGION: australia-southeast1 | SERVICE: checkout-api | COMMANDER: @sre-sydney-oncall]\n"
                    "PagerDuty Alert PD-998412 | Escalation Policy: Tier-1-Payments-AU | Runbook: https://runbooks.corp.example.com.au/payments/checkout-api-latency\n"
                    "Bridge Policy: All telemetry snapshots must include cluster, namespace, pod replica counts, and active DB connection counts for compliance audit trail.\n\n"
                    "02:14 UTC — Alert fired: Checkout API p99 latency spiked from 180ms to 4,200ms in Sydney (australia-southeast1). Error rate climbed to 6.4%.\n\n"
                    "GKE Pod Snapshot (namespace=payments-prod, cluster=gke-sydney-autopilot-01):\n"
                    "checkout-api-7d9b8c6f4-2kx9p   2/2   Running   0   4h12m   10.42.1.14   gke-node-pool-a-01   cpu=310m/2000m   mem=512Mi/2Gi\n"
                    "checkout-api-7d9b8c6f4-4mn2q   2/2   Running   0   4h12m   10.42.1.18   gke-node-pool-a-02   cpu=325m/2000m   mem=524Mi/2Gi\n"
                    "checkout-api-7d9b8c6f4-7pq8r   2/2   Running   0   4h12m   10.42.1.21   gke-node-pool-a-03   cpu=305m/2000m   mem=508Mi/2Gi\n"
                    "checkout-api-7d9b8c6f4-9tv4s   2/2   Running   0   4h12m   10.42.1.25   gke-node-pool-b-01   cpu=340m/2000m   mem=530Mi/2Gi\n"
                    "checkout-api-7d9b8c6f4-b3w1t   2/2   Running   0   4h12m   10.42.1.29   gke-node-pool-b-02   cpu=318m/2000m   mem=515Mi/2Gi\n"
                    "checkout-api-7d9b8c6f4-c8z5v   2/2   Running   0   4h12m   10.42.1.33   gke-node-pool-b-03   cpu=332m/2000m   mem=519Mi/2Gi\n"
                    "checkout-api-7d9b8c6f4-d1f6w   2/2   Running   0   4h12m   10.42.1.37   gke-node-pool-c-01   cpu=309m/2000m   mem=510Mi/2Gi\n"
                    "checkout-api-7d9b8c6f4-e5h9x   2/2   Running   0   4h12m   10.42.1.41   gke-node-pool-c-02   cpu=321m/2000m   mem=516Mi/2Gi\n"
                    "checkout-api-7d9b8c6f4-f2j3y   2/2   Running   0   4h12m   10.42.1.45   gke-node-pool-c-03   cpu=315m/2000m   mem=514Mi/2Gi\n"
                    "checkout-api-7d9b8c6f4-g7k8z   2/2   Running   0   4h12m   10.42.1.49   gke-node-pool-c-04   cpu=328m/2000m   mem=522Mi/2Gi\n"
                    "Envoy sidecar healthz=200 OK across all 10 replicas; zero OOMKills; zero CrashLoopBackOff events; node disk pressure=False; memory pressure=False."
                ),
            },
            {
                "role": "model",
                "content": (
                    "Acknowledged SEV-2 #4912 at 02:14 UTC. Inspecting regional GKE autopilot pod CPU/memory utilization and Cloud SQL PostgreSQL connection saturation in australia-southeast1."
                ),
            },
            {
                "role": "user",
                "content": (
                    "[INCIDENT-BRIDGE-HEADER: SEV-2 #4912 | REGION: australia-southeast1 | SERVICE: checkout-api | COMMANDER: @sre-sydney-oncall]\n"
                    "PagerDuty Alert PD-998412 | Escalation Policy: Tier-1-Payments-AU | Runbook: https://runbooks.corp.example.com.au/payments/checkout-api-latency\n"
                    "Bridge Policy: All telemetry snapshots must include cluster, namespace, pod replica counts, and active DB connection counts for compliance audit trail.\n\n"
                    "02:17 UTC — Checked Cloud Load Balancer & Apigee X northbound metrics in australia-southeast1:\n"
                    "northbound_rps=1420, tls_handshake_p99=14ms, apigee_proxy_overhead_p99=6ms, upstream_connect_ms=4ms, upstream_header_wait_ms=4180ms.\n"
                    "All 10 GKE pods remain Ready; zero DNS resolution errors; VPC peering health=GREEN; Cloud Armor WAF block_rate=0.02% (normal baseline).\n"
                    "Raw Cloud Monitoring Metric Dump:\n"
                    "metric.loadbalancing.googleapis.com/https/backend_latencies{region=australia-southeast1,zone=a,backend=checkout-api-neg}: p50=890ms p95=3640ms p99=4210ms\n"
                    "metric.loadbalancing.googleapis.com/https/backend_latencies{region=australia-southeast1,zone=b,backend=checkout-api-neg}: p50=912ms p95=3710ms p99=4195ms\n"
                    "metric.loadbalancing.googleapis.com/https/backend_latencies{region=australia-southeast1,zone=c,backend=checkout-api-neg}: p50=878ms p95=3590ms p99=4205ms\n"
                    "metric.kubernetes.io/container/cpu/core_usage_time{namespace=payments-prod,pod=checkout-api}: avg=0.32 cores (16% of limit)\n"
                    "metric.kubernetes.io/container/memory/used_bytes{namespace=payments-prod,pod=checkout-api}: avg=518Mi (25% of limit)\n"
                    "metric.kubernetes.io/pod/network/received_bytes_count{namespace=payments-prod,pod=checkout-api}: 42.1 MB/s (normal)\n"
                    "metric.kubernetes.io/pod/network/sent_bytes_count{namespace=payments-prod,pod=checkout-api}: 38.4 MB/s (normal)\n"
                    "metric.cloudsql.googleapis.com/database/cpu/utilization{instance=payments-pg-prod-au}: 0.28 (normal)\n"
                    "metric.cloudsql.googleapis.com/database/disk/read_ops_count{instance=payments-pg-prod-au}: 112 iops (normal)\n"
                    "metric.cloudsql.googleapis.com/database/disk/write_ops_count{instance=payments-pg-prod-au}: 245 iops (normal)"
                ),
            },
            {
                "role": "model",
                "content": (
                    "Checking Cloud SQL PostgreSQL connection pool metrics and recent deployment diffs now. Standing by for pg_stat_activity snapshot."
                ),
            },
            {
                "role": "user",
                "content": (
                    "[INCIDENT-BRIDGE-HEADER: SEV-2 #4912 | REGION: australia-southeast1 | SERVICE: checkout-api | COMMANDER: @sre-sydney-oncall]\n"
                    "PagerDuty Alert PD-998412 | Escalation Policy: Tier-1-Payments-AU | Runbook: https://runbooks.corp.example.com.au/payments/checkout-api-latency\n"
                    "Bridge Policy: All telemetry snapshots must include cluster, namespace, pod replica counts, and active DB connection counts for compliance audit trail.\n\n"
                    "02:19 UTC — Telemetry update: GKE pod CPU is nominal at 34%, but Cloud SQL PostgreSQL active connections hit the hard ceiling (max_connections=500) right after release v2026.10.19-rc3 rolled out.\n\n"
                    "Raw pg_stat_activity & PgBouncer SHOW POOLS Dump (instance=payments-pg-prod-au):\n"
                    "pid=18401 | state=idle in transaction | wait_event=ClientRead | app=checkout-api | client_addr=10.42.1.14 | age=48s\n"
                    "pid=18402 | state=idle in transaction | wait_event=ClientRead | app=checkout-api | client_addr=10.42.1.18 | age=51s\n"
                    "pid=18403 | state=idle in transaction | wait_event=ClientRead | app=checkout-api | client_addr=10.42.1.21 | age=49s\n"
                    "pid=18404 | state=idle in transaction | wait_event=ClientRead | app=checkout-api | client_addr=10.42.1.25 | age=53s\n"
                    "pid=18405 | state=idle in transaction | wait_event=ClientRead | app=checkout-api | client_addr=10.42.1.29 | age=47s\n"
                    "pid=18406 | state=idle in transaction | wait_event=ClientRead | app=checkout-api | client_addr=10.42.1.33 | age=55s\n"
                    "pid=18407 | state=idle in transaction | wait_event=ClientRead | app=checkout-api | client_addr=10.42.1.37 | age=44s\n"
                    "pid=18408 | state=idle in transaction | wait_event=ClientRead | app=checkout-api | client_addr=10.42.1.41 | age=52s\n"
                    "pid=18409 | state=idle in transaction | wait_event=ClientRead | app=checkout-api | client_addr=10.42.1.45 | age=46s\n"
                    "pid=18410 | state=idle in transaction | wait_event=ClientRead | app=checkout-api | client_addr=10.42.1.49 | age=50s\n"
                    "pgbouncer_pool=checkout_db | cl_active=1420 | cl_waiting=580 | sv_active=500 | sv_idle=0 | maxwait=4.1s | pool_mode=session\n"
                    "Postgres log: FATAL: sorry, too many clients already (max_connections=500) [repeated 412 times in 60s]"
                ),
            },
            {
                "role": "model",
                "content": (
                    "Confirmed correlation with release v2026.10.19-rc3. Checking diff in connection pooler configuration for checkout-api."
                ),
            },
            {
                "role": "user",
                "content": (
                    "[INCIDENT-BRIDGE-HEADER: SEV-2 #4912 | REGION: australia-southeast1 | SERVICE: checkout-api | COMMANDER: @sre-sydney-oncall]\n"
                    "PagerDuty Alert PD-998412 | Escalation Policy: Tier-1-Payments-AU | Runbook: https://runbooks.corp.example.com.au/payments/checkout-api-latency\n"
                    "Bridge Policy: All telemetry snapshots must include cluster, namespace, pod replica counts, and active DB connection counts for compliance audit trail.\n\n"
                    "02:25 UTC — Root cause isolated: Commit PR #8812 in release v2026.10.19-rc3 accidentally changed PgBouncer pool_mode from 'transaction' to 'session' and raised max_client_conn to 2000, starving backend PostgreSQL connections.\n\n"
                    "Helm Chart Diff (charts/checkout-api/values-prod-au.yaml, v2026.10.18 -> v2026.10.19-rc3):\n"
                    "  pgbouncer:\n"
                    "    image: gcr.io/apac-cs-5g-demo5/pgbouncer:1.22.1\n"
                    "    replicas: 4\n"
                    "    listen_port: 6432\n"
                    "    auth_type: scram-sha-256\n"
                    "    default_pool_size: 45\n"
                    "    reserve_pool_size: 10\n"
                    "    reserve_pool_timeout: 3\n"
                    "    server_reset_query: DISCARD ALL\n"
                    "-   pool_mode: transaction\n"
                    "+   pool_mode: session\n"
                    "-   max_client_conn: 600\n"
                    "+   max_client_conn: 2000\n"
                    "    ignore_startup_parameters: extra_float_digits\n"
                    "    stats_period: 60\n"
                    "    log_connections: 0\n"
                    "    log_disconnections: 0"
                ),
            },
            {
                "role": "model",
                "content": (
                    "Noted: PR #8812 PgBouncer pool_mode regression (transaction -> session). Recommend immediate Helm rollback to v2026.10.18."
                ),
            },
            {
                "role": "user",
                "content": (
                    "[INCIDENT-BRIDGE-HEADER: SEV-2 #4912 | REGION: australia-southeast1 | SERVICE: checkout-api | COMMANDER: @sre-sydney-oncall]\n"
                    "PagerDuty Alert PD-998412 | Escalation Policy: Tier-1-Payments-AU | Runbook: https://runbooks.corp.example.com.au/payments/checkout-api-latency\n"
                    "Bridge Policy: All telemetry snapshots must include cluster, namespace, pod replica counts, and active DB connection counts for compliance audit trail.\n\n"
                    "02:30 UTC — Executed `helm rollback checkout-api` to v2026.10.18 in australia-southeast1. Active Cloud SQL connections dropped from 500 to 68, error rate is 0.0%, and p99 latency recovered to 165ms."
                ),
            },
            {
                "role": "model",
                "content": "Rollback to v2026.10.18 verified. Service health is green.",
            },
        ],
        "user_prompt": (
            "Write the 3-bullet executive post-mortem summary for SEV-2 #4912 (Root Cause, Peak Impact, and Mitigation Status)."
        ),
        "compression_target_ratio": 0.45,
        "similarity_threshold": 0.85,
        "presenter_note": (
            "Try running this with ONLY Context Pruning enabled: Tier 1 strips repeated cross-turn incident headers, "
            "verbose pod/pg_stat_activity log dumps, and filler ack turns at $0.00 LLM overhead — cutting input tokens "
            "by ~75% and total Pro cost by ~30-45% with zero model downgrade!"
        ),
    },
    {
        "id": "scenario-5-cascade-escalation",
        "step_number": 5,
        "title": "5. Deep Architectural Proof (FrugalGPT Cascade Escalation)",
        "subtitle": "Demonstrates honest cascade escalation: Flash L1 flags low confidence -> escalates to Pro L2",
        "optimization_focus": "FrugalGPT Sequential Cascade (L1 Flash -> Scorer g(q,a) < 0.80 -> L2 Pro)",
        "recommended_toggles": {
            "semantic_cache": False,
            "prompt_compression": False,
            "model_routing": True,
            "context_pruning": False,
        },
        "session_id": "demo-arch-cascade",
        "scenario_id": "spanner-truetime-proof",
        "system_instruction": (
            "You are a Principal Distributed Systems Architect. If you are a lightweight triage model "
            "evaluating a formal distributed consensus proof, begin with [REQUIRES_DEEP_REASONING] and "
            "provide a brief initial sketch; if you are the deep reasoning model, provide a rigorous "
            "3-part architectural analysis."
        ),
        "rag_context": "",
        "few_shot_examples": [],
        "conversation_history": [],
        "user_prompt": (
            "Provide a formal distributed systems trade-off analysis comparing Cloud Spanner TrueTime "
            "commit-wait bounds (2*epsilon) against multi-region Raft/Paxos clock-skew read-refresh "
            "latencies under an asymmetric network partition between Sydney (australia-southeast1) "
            "and Perth."
        ),
        "compression_target_ratio": 0.50,
        "similarity_threshold": 0.85,
        "presenter_note": (
            "Critical credibility moment for senior engineers: when L1 (Flash) triggers a low reliability "
            "score g(q,a) < 0.80, the gateway automatically escalates to L2 (Gemini 2.5 Pro) AND honestly "
            "bills BOTH the L1 attempt and the L2 completion."
        ),
    },
]
