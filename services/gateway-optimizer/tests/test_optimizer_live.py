"""Real integration tests for the Gateway Optimizer service against live Vertex AI (no mocks)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import MODEL_FLASH, MODEL_PRO, PRICING
from app.main import app

client = TestClient(app)


def test_pricing_includes_thinking_tokens() -> None:
    """Verify that Gemini 2.5 pricing charges output rate for both candidatesTokenCount and thoughtsTokenCount."""
    pro_cost = PRICING[MODEL_PRO].compute_cost(
        input_tokens=1_000,
        output_tokens=200,
        thinking_tokens=300,
    )
    # 1,000 * $1.25/1M ($0.00125) + (200 + 300) * $10.00/1M ($0.00500) = $0.00625
    assert pro_cost == 0.00625

    flash_cost = PRICING[MODEL_FLASH].compute_cost(
        input_tokens=1_000,
        output_tokens=200,
        thinking_tokens=100,
    )
    # 1,000 * $0.30/1M ($0.0003) + 300 * $2.50/1M ($0.00075) = $0.00105
    assert flash_cost == 0.00105


def test_semantic_cache_miss_then_hit_live_vertex() -> None:
    """Verify real Vertex AI text-embedding-005 semantic cache miss followed by semantic paraphrase hit."""
    client.post("/v1/state/reset")

    q1 = "What is our APRA CPS 234 notification window if a third-party cloud payment processor suffers a material security incident?"
    q2 = "How quickly do we have to report a material cyber breach at an outsourced payment vendor under APRA CPS 234?"

    r1 = client.post(
        "/v1/optimize/pre",
        json={
            "session_id": "test-cache",
            "scenario_id": "cps234-test",
            "system_instruction": "You are an enterprise risk advisor.",
            "rag_context": "Under APRA CPS 234 Paragraph 36, an APRA-regulated entity must notify APRA as soon as possible and not later than 72 hours after becoming aware of an information security incident.",
            "messages": [{"role": "user", "content": q1}],
            "toggles": {
                "semantic_cache": True,
                "prompt_compression": False,
                "model_routing": True,
                "context_pruning": False,
            },
        },
    )
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["cache_hit"] is False
    assert d1["embedding_tokens_used"] > 0

    # Simulate completing the L1 call and storing via /v1/optimize/cascade
    fake_vertex_l1 = {
        "candidates": [
            {
                "content": {"parts": [{"text": "Under APRA CPS 234, you must notify APRA within 72 hours."}]},
                "finishReason": "STOP",
            }
        ],
        "usageMetadata": {
            "promptTokenCount": 65,
            "candidatesTokenCount": 16,
            "thoughtsTokenCount": 0,
            "totalTokenCount": 81,
        },
    }
    rc = client.post(
        "/v1/optimize/cascade",
        json={
            "session_id": "test-cache",
            "scenario_id": "cps234-test",
            "cache_namespace_key": d1["cache_namespace_key"],
            "user_query": q1,
            "target_model_initial": d1["target_model"],
            "vertex_response_raw": fake_vertex_l1,
            "vertex_payload_sent": d1["vertex_payload"],
            "toggles": {
                "semantic_cache": True,
                "prompt_compression": False,
                "model_routing": True,
                "context_pruning": False,
            },
            "pre_telemetry": d1,
        },
    )
    assert rc.status_code == 200
    assert rc.json()["cached_for_future"] is True

    # Now send paraphrased query q2 -> should trigger a real semantic cache hit!
    r2 = client.post(
        "/v1/optimize/pre",
        json={
            "session_id": "test-cache",
            "scenario_id": "cps234-test",
            "system_instruction": "You are an enterprise risk advisor.",
            "rag_context": "Under APRA CPS 234 Paragraph 36, an APRA-regulated entity must notify APRA as soon as possible and not later than 72 hours after becoming aware of an information security incident.",
            "messages": [{"role": "user", "content": q2}],
            "toggles": {
                "semantic_cache": True,
                "prompt_compression": False,
                "model_routing": True,
                "context_pruning": False,
            },
        },
    )
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["cache_hit"] is True
    assert d2["cache_similarity"] >= 0.88
    assert d2["routing_decision"] == "CACHE_SHORT_CIRCUIT"
    assert "72 hours" in d2["cached_response_text"]
