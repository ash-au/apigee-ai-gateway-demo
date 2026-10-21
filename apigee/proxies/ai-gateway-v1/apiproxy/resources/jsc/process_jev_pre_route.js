// Apigee X PreFlow (Tab 5): Process Jev Pre-Route response and set dynamic southbound route
var preRespContent = context.getVariable("jevPreRouteResponse.content") || "{}";
var preData = {};
try {
    preData = JSON.parse(preRespContent);
} catch (e) {
    throw new Error("Failed to parse jevPreRouteResponse from gateway-optimizer: " + e);
}

var routingDecision = preData.routing_decision || "GEMINI_2_5_FLASH";
var targetModel = preData.target_model || "gemini-2.5-flash";

// Set ai.routing_decision so Apigee's existing RouteRules (Route-VertexFlash vs Route-VertexPro) route dynamically!
context.setVariable("ai.routing_decision", routingDecision);
context.setVariable("ai.target_model", targetModel);
context.setVariable("ai.jev_pre_telemetry_json", preRespContent);

var vertexPayloadStr = JSON.stringify(preData.vertex_payload || {});
context.setVariable("ai.vertex_payload_sent_json", vertexPayloadStr);
context.setVariable("request.content", vertexPayloadStr);
context.setVariable("request.header.Content-Type", "application/json");
context.setVariable("target.copy.pathsuffix", false);
context.setVariable("target.copy.queryparams", false);
context.setVariable("ai.vertex_start_ms", String(Date.now()));
