// Apigee X PreFlow (Tab 5): Prepare Stage 1 System 1 (TypeSafe Jev) Pre-Route Request
var startMs = Date.now();
context.setVariable("ai.gateway_start_ms", String(startMs));

var rawBody = context.getVariable("request.content") || "{}";
var body = {};
try {
    body = JSON.parse(rawBody);
} catch (e) {
    body = {};
}

var userQuery = body.user_query || body.user_prompt || body.prompt || "Hello";
var sysInstruction = body.system_instruction || "";
var ragContext = body.rag_context || "";
var confidenceThreshold = body.confidence_threshold !== undefined ? Number(body.confidence_threshold) : 0.75;
var fireThreshold = body.fire_threshold !== undefined ? Number(body.fire_threshold) : 0.70;
var enableDirectProFastTrack = body.enable_direct_pro_fast_track !== undefined ? Boolean(body.enable_direct_pro_fast_track) : true;
var enablePostVerifier = body.enable_post_verifier !== undefined ? Boolean(body.enable_post_verifier) : true;
var simulateL1Defect = body.simulate_l1_defect !== undefined ? Boolean(body.simulate_l1_defect) : false;

var jevPreRoutePayload = {
    session_id: body.session_id || "jev-demo-session",
    scenario_id: body.scenario_id || "jev-custom",
    system_instruction: sysInstruction,
    rag_context: ragContext,
    user_query: userQuery,
    confidence_threshold: confidenceThreshold,
    fire_threshold: fireThreshold,
    enable_direct_pro_fast_track: enableDirectProFastTrack,
    enable_post_verifier: enablePostVerifier,
    simulate_l1_defect: simulateL1Defect
};

context.setVariable("ai.jev_user_query", userQuery);
context.setVariable("ai.jev_system_instruction", sysInstruction);
context.setVariable("ai.jev_rag_context", ragContext);
context.setVariable("ai.jev_fire_threshold", String(fireThreshold));
context.setVariable("ai.jev_enable_post_verifier", String(enablePostVerifier));
context.setVariable("ai.jev_simulate_l1_defect", String(simulateL1Defect));
context.setVariable("ai.jev_pre_route_request_body", JSON.stringify(jevPreRoutePayload));
