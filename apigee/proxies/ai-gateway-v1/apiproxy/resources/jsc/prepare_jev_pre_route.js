// Apigee X PreFlow (Tab 5): Pure Native System 1 Pre-Route Payload Builder (Zero Cloud Run)
// Strict ES5 for Apigee X Mozilla Rhino runtime.
var startMs = Date.now();
context.setVariable("ai.gateway_start_ms", String(startMs));

var rawBody = context.getVariable("request.content") || "{}";
var body = {};
try {
    body = JSON.parse(rawBody);
} catch (e) {
    body = {};
}

function normalizeProvider(raw) {
    var val = String(raw || "gemini_decision_1").toLowerCase().replace(/^\s+|\s+$/g, "");
    if (val === "typesafe_jev" || val === "typesafe" || val === "jev" || val === "jev-latest") {
        return "typesafe_jev";
    }
    return "gemini_decision_1";
}

function formatStateAsText(stateObj) {
    var keys = Object.keys(stateObj);
    var sections = [];
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = String(stateObj[k] || "").replace(/^\s+|\s+$/g, "");
        if (v.length > 0) {
            sections.push("=== " + k + " ===\n" + v);
        }
    }
    return sections.length > 0 ? sections.join("\n\n") : "(no context)";
}

var system1Provider = normalizeProvider(body.system1_provider);
var userQuery = String(body.user_query || body.user_prompt || body.prompt || "Hello");
var sysInstruction = String(body.system_instruction || "");
var ragContext = String(body.rag_context || "");
var confidenceThreshold = body.confidence_threshold !== undefined ? Number(body.confidence_threshold) : 0.75;
var fireThreshold = body.fire_threshold !== undefined ? Number(body.fire_threshold) : 0.70;
var enableDirectProFastTrack = body.enable_direct_pro_fast_track !== undefined ? Boolean(body.enable_direct_pro_fast_track) : true;
var enablePostVerifier = body.enable_post_verifier !== undefined ? Boolean(body.enable_post_verifier) : true;
var simulateL1Defect = body.simulate_l1_defect !== undefined ? Boolean(body.simulate_l1_defect) : false;

var stateObj = {
    user_query: userQuery
};
var trimmedSys = sysInstruction.replace(/^\s+|\s+$/g, "");
var trimmedRag = ragContext.replace(/^\s+|\s+$/g, "");
if (trimmedSys.length > 0) {
    stateObj.system_instruction = trimmedSys;
}
if (trimmedRag.length > 0) {
    stateObj.rag_context_preview = trimmedRag.substring(0, 2500);
}

var stage1Questions = {
    target_tier: {
        type: "choice",
        instructions: "Which model tier is required to answer `user_query` accurately?",
        criteria: {
            flash_fast: "Simple factual lookup, policy check, or straightforward single-hop question",
            flash_with_verifier: "Moderate multi-step synthesis, RAG extraction, or incident summarization",
            pro_system2_direct: "Formal distributed systems proof, deep mathematical/theoretical trade-off derivation, or complex multi-invariant reasoning"
        }
    },
    complexity: {
        type: "score",
        instructions: "How intellectually demanding is `user_query` to answer accurately without errors?",
        criteria: [
            "Simple lookup, policy question, or standard procedure",
            "Moderate multi-step synthesis, RAG extraction, or incident summarization",
            "Deep formal proof, distributed consensus theory, or complex edge-case trade-off analysis"
        ]
    },
    requires_formal_proof: {
        type: "noul",
        instructions: "Does `user_query` ask for a formal proof, theoretical trade-off derivation, or distributed consensus invariant analysis?"
    },
    has_strict_multi_constraints: {
        type: "noul",
        instructions: "Does `user_query` contain multiple distinct constraints, fields, or sub-questions that must all be verified?"
    }
};

var s1PrePayload;
if (system1Provider === "gemini_decision_1") {
    s1PrePayload = {
        model: "gemini-decision-1",
        input: formatStateAsText(stateObj),
        questions: stage1Questions
    };
} else {
    s1PrePayload = {
        model: "jev-latest",
        state: stateObj,
        questions: stage1Questions
    };
}

context.setVariable("ai.system1_provider", system1Provider);
context.setVariable("ai.jev_user_query", userQuery);
context.setVariable("ai.jev_system_instruction", sysInstruction);
context.setVariable("ai.jev_rag_context", ragContext);
context.setVariable("ai.jev_confidence_threshold", String(confidenceThreshold));
context.setVariable("ai.jev_fire_threshold", String(fireThreshold));
context.setVariable("ai.jev_enable_direct_pro_fast_track", String(enableDirectProFastTrack));
context.setVariable("ai.jev_enable_post_verifier", String(enablePostVerifier));
context.setVariable("ai.jev_simulate_l1_defect", String(simulateL1Defect));
context.setVariable("ai.s1_pre_request_body", JSON.stringify(s1PrePayload));
context.setVariable("ai.stage1_start_ms", String(Date.now()));
