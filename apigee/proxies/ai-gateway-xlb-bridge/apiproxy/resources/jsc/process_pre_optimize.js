// Apigee X PreFlow Step 3: Process optimizer output and prepare southbound Vertex AI request
var preRespContent = context.getVariable("preOptimizeResponse.content") || "{}";
var preData = {};
try {
    preData = JSON.parse(preRespContent);
} catch (e) {
    throw new Error("Failed to parse preOptimizeResponse from gateway-optimizer: " + e);
}

var routingDecision = preData.routing_decision || "GEMINI_2_5_PRO";
var targetModel = preData.target_model || "gemini-2.5-pro";

context.setVariable("ai.routing_decision", routingDecision);
context.setVariable("ai.target_model", targetModel);
context.setVariable("ai.cache_namespace_key", preData.cache_namespace_key || "");
context.setVariable("ai.extracted_user_query", preData.extracted_user_query || "");
context.setVariable("ai.pre_telemetry_json", preRespContent);

if (routingDecision !== "CACHE_SHORT_CIRCUIT") {
    var vertexPayloadStr = JSON.stringify(preData.vertex_payload || {});
    context.setVariable("ai.vertex_payload_sent_json", vertexPayloadStr);
    context.setVariable("request.content", vertexPayloadStr);
    context.setVariable("request.header.Content-Type", "application/json");
    context.setVariable("target.copy.pathsuffix", false);
    context.setVariable("target.copy.queryparams", false);
    context.setVariable("ai.vertex_start_ms", String(Date.now()));
}
