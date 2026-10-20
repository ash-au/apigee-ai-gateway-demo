#!/usr/bin/env bash
# ==============================================================================
# test_apigee_proxy_live.sh
# Live end-to-end smoke test against the deployed Apigee X proxy:
#   https://eval-group.34-120-155-152.nip.io/v1/ai-economics
# Exercises all 4 optimizations (Cache, Compress, Route/Cascade, Prune)
# and prints both X-Apigee-* HTTP headers and JSON telemetry envelopes.
# ==============================================================================
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-https://eval-group.34-120-155-152.nip.io/v1/ai-economics}"
HDR_FILE="$(mktemp)"
trap 'rm -f "${HDR_FILE}"' EXIT

echo "================================================================================"
echo "0. Resetting Gateway State (POST ${GATEWAY_URL}/reset)"
echo "================================================================================"
curl -sS -X POST "${GATEWAY_URL}/reset" -H "Content-Type: application/json" -d '{}'
echo -e "\n"

echo "================================================================================"
echo "1. Optimization 1 + 3 (Turn 1): Semantic Cache MISS + Route to Gemini 2.5 Flash"
echo "   X-Opt-Cache: true | X-Opt-Route: true"
echo "================================================================================"
RESP1="$(curl -sS -D "${HDR_FILE}" -X POST "${GATEWAY_URL}/chat" \
  -H "Content-Type: application/json" \
  -H "X-Opt-Cache: true" \
  -H "X-Opt-Compress: false" \
  -H "X-Opt-Route: true" \
  -H "X-Opt-Prune: false" \
  -H "X-Session-Id: apigee-smoke-session" \
  -H "X-Scenario-Id: tier1-faq" \
  -d '{
    "system_instruction": "You are an enterprise IT support assistant. Answer concisely in 2 sentences.",
    "user_prompt": "How do I reset my corporate Okta MFA token if I got a new phone?"
  }')"
grep -i "^x-ai-gateway-" "${HDR_FILE}" || true
echo "${RESP1}" | python3 -m json.tool
echo ""

echo "================================================================================"
echo "2. Optimization 1 (Turn 2): Semantic Cache HIT (Rephrased Query)"
echo "   X-Opt-Cache: true | Cosine Similarity >= 0.85 via text-embedding-005"
echo "================================================================================"
RESP2="$(curl -sS -D "${HDR_FILE}" -X POST "${GATEWAY_URL}/chat" \
  -H "Content-Type: application/json" \
  -H "X-Opt-Cache: true" \
  -H "X-Opt-Compress: false" \
  -H "X-Opt-Route: true" \
  -H "X-Opt-Prune: false" \
  -H "X-Session-Id: apigee-smoke-session" \
  -H "X-Scenario-Id: tier1-faq" \
  -d '{
    "system_instruction": "You are an enterprise IT support assistant. Answer concisely in 2 sentences.",
    "user_prompt": "I just upgraded my smartphone and need to re-enroll my company Okta multi-factor authenticator. What is the procedure?"
  }')"
grep -i "^x-ai-gateway-" "${HDR_FILE}" || true
echo "${RESP2}" | python3 -m json.tool
echo ""

echo "================================================================================"
echo "3. Optimization 2: LLMLingua-2 Coarse-to-Fine Prompt Compression"
echo "   X-Opt-Compress: true | X-Opt-Route: true"
echo "================================================================================"
RESP3="$(curl -sS -D "${HDR_FILE}" -X POST "${GATEWAY_URL}/chat" \
  -H "Content-Type: application/json" \
  -H "X-Opt-Cache: false" \
  -H "X-Opt-Compress: true" \
  -H "X-Opt-Route: true" \
  -H "X-Opt-Prune: false" \
  -H "X-Session-Id: apigee-smoke-compress" \
  -H "X-Scenario-Id: rag-policy" \
  -d '{
    "system_instruction": "You are an enterprise compliance assistant. Answer strictly using the retrieved policy excerpts in 2 bullet points.",
    "rag_context": "DOCUMENT 1 (CORPORATE CLOUD SECURITY POLICY v4.2 - SECTION 9): In accordance with our global enterprise data governance framework, it is strictly required that all Customer Personally Identifiable Information (PII) and Payment Card Industry (PCI-DSS) workloads deployed on Google Cloud Platform must reside exclusively within the australia-southeast1 (Sydney) or australia-southeast2 (Melbourne) regions. Cross-border replication of unmasked customer records to non-Australian regions is prohibited under Australian Privacy Principle 8 (APP 8). Furthermore, all persistent disks and Cloud SQL instances storing Tier-1 regulated data must utilize Customer-Managed Encryption Keys (CMEK) hosted in Cloud KMS with a 90-day automatic key rotation schedule.\n\nDOCUMENT 2 (REPEATED ARCHIVE COPY): In accordance with our global enterprise data governance framework, it is strictly required that all Customer Personally Identifiable Information (PII) and Payment Card Industry (PCI-DSS) workloads deployed on Google Cloud Platform must reside exclusively within the australia-southeast1 (Sydney) or australia-southeast2 (Melbourne) regions.\n\nDOCUMENT 3 (IRRELEVANT CAFETERIA MEMO): Please note that the Level 14 espresso machine in the Sydney Barangaroo office will undergo scheduled descaling maintenance this Friday between 14:00 and 16:00 AEST. Staff are encouraged to use the Level 12 kitchen facilities during this window.",
    "user_prompt": "Which GCP regions are approved for Customer PII workloads and what encryption key policy applies?"
  }')"
grep -i "^x-ai-gateway-" "${HDR_FILE}" || true
echo "${RESP3}" | python3 -m json.tool
echo ""

echo "================================================================================"
echo "4. Optimization 3: FrugalGPT Sequential Cascade (Escalation from Flash -> Pro)"
echo "   X-Opt-Route: true on an architectural trade-off prompt with [REQUIRES_DEEP_REASONING]"
echo "================================================================================"
RESP4="$(curl -sS -D "${HDR_FILE}" -X POST "${GATEWAY_URL}/chat" \
  -H "Content-Type: application/json" \
  -H "X-Opt-Cache: false" \
  -H "X-Opt-Compress: false" \
  -H "X-Opt-Route: true" \
  -H "X-Opt-Prune: false" \
  -H "X-Session-Id: apigee-smoke-cascade" \
  -H "X-Scenario-Id: arch-review" \
  -d '{
    "system_instruction": "You are a Principal Distributed Systems Architect. If a question asks for a formal Spanner vs CockroachDB Paxos/TrueTime write-commit latency proof, include [REQUIRES_DEEP_REASONING] if you are a lightweight triage model, or provide a rigorous 3-bullet analysis.",
    "user_prompt": "Provide a formal distributed systems trade-off analysis comparing Cloud Spanner TrueTime commit-wait bounds against multi-region Raft/Paxos clock-skew read-refresh latencies under asymmetric network partitions across Sydney and Perth."
  }')"
grep -i "^x-ai-gateway-" "${HDR_FILE}" || true
echo "${RESP4}" | python3 -m json.tool
echo ""

echo "================================================================================"
echo "5. Optimization 4: Context Pruning / Multi-Turn Session Deduplication"
echo "   X-Opt-Prune: true | X-Opt-Route: true (8-turn bloated incident thread)"
echo "================================================================================"
RESP5="$(curl -sS -D "${HDR_FILE}" -X POST "${GATEWAY_URL}/chat" \
  -H "Content-Type: application/json" \
  -H "X-Opt-Cache: false" \
  -H "X-Opt-Compress: false" \
  -H "X-Opt-Route: true" \
  -H "X-Opt-Prune: true" \
  -H "X-Session-Id: apigee-smoke-prune" \
  -H "X-Scenario-Id: multiturn-incident" \
  -d '{
    "system_instruction": "You are an Incident Commander assistant. Summarize the root cause and next action in 2 sentences.",
    "conversation_history": [
      {"role": "user", "content": "SEV-2 Incident #4912 opened at 02:14 UTC: Checkout API p99 latency spiked from 180ms to 4,200ms in australia-southeast1."},
      {"role": "model", "content": "Acknowledged SEV-2 #4912. Checking regional GKE pod metrics and Cloud SQL connection pools in australia-southeast1."},
      {"role": "user", "content": "Update 02:19 UTC: GKE CPU is normal at 34%, but Cloud SQL PostgreSQL active connections hit the max_connections=500 ceiling after release v2026.10.19-rc3 rolled out."},
      {"role": "model", "content": "Noted. Release v2026.10.19-rc3 correlates with the connection pool exhaustion on Cloud SQL."},
      {"role": "user", "content": "Update 02:25 UTC: Found the bug in v2026.10.19-rc3 — PR #8812 overrode PgBouncer pool_mode from transaction to session and set max_client_conn=2000."},
      {"role": "model", "content": "Confirmed root cause in PR #8812 (PgBouncer pool_mode changed to session)."},
      {"role": "user", "content": "Update 02:30 UTC: Rolled back helm chart to v2026.10.18. Active DB connections dropped to 68 and p99 latency recovered to 165ms."},
      {"role": "model", "content": "Rollback verified; service metrics nominal."}
    ],
    "user_prompt": "Give me the executive post-mortem summary of root cause and current mitigation status for SEV-2 #4912."
  }')"
grep -i "^x-ai-gateway-" "${HDR_FILE}" || true
echo "${RESP5}" | python3 -m json.tool
echo ""
