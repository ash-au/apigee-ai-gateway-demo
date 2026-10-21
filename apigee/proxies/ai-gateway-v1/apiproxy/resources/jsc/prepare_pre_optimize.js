// Apigee X PreFlow Step 1: Parse incoming request & optimization toggles
var startMs = Date.now();
context.setVariable("ai.gateway_start_ms", String(startMs));

var rawBody = context.getVariable("request.content") || "{}";
var body = {};
try {
    body = JSON.parse(rawBody);
} catch (e) {
    body = {};
}

function parseBoolHeader(headerName, fallbackVal) {
    var h = context.getVariable("request.header." + headerName);
    if (h === null || h === undefined || h === "") {
        return fallbackVal;
    }
    var norm = String(h).toLowerCase().trim();
    return (norm === "true" || norm === "1" || norm === "yes" || norm === "on");
}

var bodyToggles = body.toggles || {};
var toggles = {
    semantic_cache: parseBoolHeader("X-Opt-Cache", bodyToggles.semantic_cache !== undefined ? bodyToggles.semantic_cache : true),
    prompt_compression: parseBoolHeader("X-Opt-Compress", bodyToggles.prompt_compression !== undefined ? bodyToggles.prompt_compression : true),
    model_routing: parseBoolHeader("X-Opt-Route", bodyToggles.model_routing !== undefined ? bodyToggles.model_routing : true),
    context_pruning: parseBoolHeader("X-Opt-Prune", bodyToggles.context_pruning !== undefined ? bodyToggles.context_pruning : true)
};

var sessionId = context.getVariable("request.header.X-Session-Id") || body.session_id || "default-session";
var scenarioId = context.getVariable("request.header.X-Scenario-Id") || body.scenario_id || null;

// Support both `messages` array OR `conversation_history` + `user_prompt` / `prompt`
var msgs = [];
if (Array.isArray(body.messages) && body.messages.length > 0) {
    msgs = body.messages;
} else {
    if (Array.isArray(body.conversation_history)) {
        for (var i = 0; i < body.conversation_history.length; i++) {
            msgs.push(body.conversation_history[i]);
        }
    }
    var userText = body.user_prompt || body.prompt || "Hello";
    msgs.push({ role: "user", content: userText });
}

var directProThresholdHdr = context.getVariable("request.header.X-Complexity-Direct-Pro-Threshold");
var directProThreshold = body.complexity_direct_pro_threshold !== undefined
    ? Number(body.complexity_direct_pro_threshold)
    : (directProThresholdHdr !== null && directProThresholdHdr !== undefined && directProThresholdHdr !== "" ? Number(directProThresholdHdr) : null);

var l1MaxOutHdr = context.getVariable("request.header.X-L1-Max-Output-Tokens");
var l1MaxOut = body.l1_max_output_tokens !== undefined
    ? Number(body.l1_max_output_tokens)
    : (l1MaxOutHdr !== null && l1MaxOutHdr !== undefined && l1MaxOutHdr !== "" ? Number(l1MaxOutHdr) : null);

var preOptimizePayload = {
    session_id: sessionId,
    scenario_id: scenarioId,
    system_instruction: body.system_instruction || "",
    rag_context: body.rag_context || "",
    few_shot_examples: body.few_shot_examples || [],
    messages: msgs,
    toggles: toggles,
    compression_target_ratio: body.compression_target_ratio || 0.55,
    similarity_threshold: body.similarity_threshold || 0.85,
    complexity_direct_pro_threshold: directProThreshold,
    l1_max_output_tokens: l1MaxOut
};

context.setVariable("ai.session_id", sessionId);
context.setVariable("ai.scenario_id", scenarioId || "");
context.setVariable("ai.toggles_json", JSON.stringify(toggles));
context.setVariable("ai.pre_optimize_request_body", JSON.stringify(preOptimizePayload));
