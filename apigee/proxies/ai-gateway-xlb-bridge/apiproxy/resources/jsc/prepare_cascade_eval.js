// Apigee X PostFlow Step 1: Package L1 Vertex AI response for FrugalGPT Cascade Evaluation
var vertexEndMs = Date.now();
var vertexStartMs = Number(context.getVariable("ai.vertex_start_ms") || vertexEndMs);
context.setVariable("ai.l1_vertex_latency_ms", String(Math.max(0, vertexEndMs - vertexStartMs)));

var vertexRawStr = context.getVariable("response.content") || "{}";
var vertexRaw = {};
try {
    vertexRaw = JSON.parse(vertexRawStr);
} catch (e) {
    vertexRaw = {};
}

var preTelemetry = {};
try {
    preTelemetry = JSON.parse(context.getVariable("ai.pre_telemetry_json") || "{}");
} catch (e) {
    preTelemetry = {};
}

var vertexPayloadSent = {};
try {
    vertexPayloadSent = JSON.parse(context.getVariable("ai.vertex_payload_sent_json") || "{}");
} catch (e) {
    vertexPayloadSent = {};
}

var toggles = {};
try {
    toggles = JSON.parse(context.getVariable("ai.toggles_json") || "{}");
} catch (e) {
    toggles = {};
}

var cascadePayload = {
    session_id: context.getVariable("ai.session_id") || "default-session",
    scenario_id: context.getVariable("ai.scenario_id") || null,
    cache_namespace_key: context.getVariable("ai.cache_namespace_key") || "",
    user_query: context.getVariable("ai.extracted_user_query") || "",
    target_model_initial: context.getVariable("ai.target_model") || "gemini-2.5-flash",
    vertex_response_raw: vertexRaw,
    vertex_payload_sent: vertexPayloadSent,
    toggles: toggles,
    confidence_threshold: 0.80,
    pre_telemetry: {
        complexity_score: preTelemetry.complexity_score || 0.2
    }
};

context.setVariable("ai.cascade_eval_request_body", JSON.stringify(cascadePayload));
