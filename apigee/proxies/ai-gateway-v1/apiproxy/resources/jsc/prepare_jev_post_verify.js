// Apigee X PostFlow (Tab 5): Package southbound Vertex AI response for Stage 2 Jev Noul Battery Verification
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
    preTelemetry = JSON.parse(context.getVariable("ai.jev_pre_telemetry_json") || "{}");
} catch (e) {
    preTelemetry = {};
}

var vertexPayloadSent = {};
try {
    vertexPayloadSent = JSON.parse(context.getVariable("ai.vertex_payload_sent_json") || "{}");
} catch (e) {
    vertexPayloadSent = {};
}

var verifyPayload = {
    user_query: context.getVariable("ai.jev_user_query") || "",
    system_instruction: context.getVariable("ai.jev_system_instruction") || "",
    rag_context: context.getVariable("ai.jev_rag_context") || "",
    initial_model: context.getVariable("ai.target_model") || "gemini-2.5-flash",
    routing_decision: context.getVariable("ai.routing_decision") || "GEMINI_2_5_FLASH",
    vertex_response_raw: vertexRaw,
    vertex_payload_sent: vertexPayloadSent,
    pre_route_telemetry: preTelemetry,
    fire_threshold: Number(context.getVariable("ai.jev_fire_threshold") || 0.70),
    enable_post_verifier: context.getVariable("ai.jev_enable_post_verifier") !== "false",
    simulate_l1_defect: context.getVariable("ai.jev_simulate_l1_defect") === "true"
};

context.setVariable("ai.jev_post_verify_request_body", JSON.stringify(verifyPayload));
