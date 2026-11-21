// Apigee X PreFlow (Tab 5): Parse Direct System 1 Response & Configure Dynamic Apigee RouteRule
// Strict ES5 for Apigee X Mozilla Rhino runtime.
var stage1EndMs = Date.now();
var stage1StartMs = Number(context.getVariable("ai.stage1_start_ms") || stage1EndMs);
var stage1LatencyMs = Math.max(1, stage1EndMs - stage1StartMs);

var providerId = context.getVariable("ai.system1_provider") || "gemini_decision_1";
var isGemini = providerId === "gemini_decision_1";
var providerLabel = isGemini ? "Google Gemini Decision 1" : "TypeSafe Jev";
var defaultModel = isGemini ? "gemini-decision-1" : "jev-latest";
var endpointUrl = isGemini
    ? "https://generativelanguage.googleapis.com/v1beta/decisions"
    : "https://api.typesafe.ai/v1/systemone";
var ratePer1M = isGemini ? 0.10 : 0.042;

var rawStr = context.getVariable("s1PreResponse.content") || "{}";
var s1Raw = {};
try {
    s1Raw = JSON.parse(rawStr);
} catch (e) {
    throw new Error("Failed to parse Stage 1 " + providerLabel + " response: " + e);
}

var promptFb = s1Raw.prompt_feedback || s1Raw.promptFeedback || {};
if (promptFb.block_reason || promptFb.blockReason) {
    throw new Error(providerLabel + " blocked Stage 1 input: " + JSON.stringify(promptFb));
}

var answers = s1Raw.answers || {};
var usage = s1Raw.usage || {};
var inputTokens = Number(
    usage.total_input_tokens || usage.totalInputTokens || usage.input_tokens || usage.total_tokens || 0
);
var outputTokens = Number(
    usage.total_output_tokens || usage.totalOutputTokens || usage.output_tokens || 0
);
var s1CostUsd = Number(((inputTokens / 1000000.0) * ratePer1M).toFixed(8));

var tierAns = answers.target_tier || {};
var tierChoice = String(tierAns.choice || "flash_with_verifier");
var tierConf = Number(tierAns.confidence !== undefined ? tierAns.confidence : 0.5);
var tierProbs = tierAns.probabilities || {};

var compAns = answers.complexity || {};
var compScore = Number(compAns.score !== undefined ? compAns.score : 1.0);
var compConf = Number(compAns.confidence !== undefined ? compAns.confidence : 0.5);
var compProbs = compAns.probabilities || {};

var proofNoul = Number((answers.requires_formal_proof && answers.requires_formal_proof.noul) || 0.0);
var multiNoul = Number((answers.has_strict_multi_constraints && answers.has_strict_multi_constraints.noul) || 0.0);

var confidenceThreshold = Number(context.getVariable("ai.jev_confidence_threshold") || 0.75);
var enableDirectProFastTrack = context.getVariable("ai.jev_enable_direct_pro_fast_track") !== "false";
var simulateL1Defect = context.getVariable("ai.jev_simulate_l1_defect") === "true";

var directToPro = false;
if (enableDirectProFastTrack && !simulateL1Defect) {
    if (
        (tierChoice === "pro_system2_direct" && tierConf >= confidenceThreshold) ||
        (compScore >= 1.65 && compConf >= confidenceThreshold) ||
        (proofNoul >= 0.82)
    ) {
        directToPro = true;
    }
}

var routingDecision;
var targetModel;
var thinkingBudget;
var routingReason;

if (directToPro) {
    routingDecision = "GEMINI_2_5_PRO";
    targetModel = "gemini-2.5-pro";
    thinkingBudget = 256;
    routingReason = providerLabel + " Stage 1 Pre-Router (Direct Apigee ServiceCallout) selected Direct System 2 Fast-Track " +
        "(choice='" + tierChoice + "' with confidence=" + tierConf.toFixed(2) + " >= " + confidenceThreshold.toFixed(2) +
        ", complexity=" + compScore.toFixed(2) + "/2.0, requires_formal_proof=" + proofNoul.toFixed(2) +
        "). Skipping L1 Flash via Apigee Route-VertexPro.";
} else {
    routingDecision = "GEMINI_2_5_FLASH";
    targetModel = "gemini-2.5-flash";
    thinkingBudget = (tierChoice === "flash_fast" && compScore < 0.75) ? 0 : 64;
    if (tierConf < confidenceThreshold) {
        routingReason = providerLabel + " Stage 1 Pre-Router (Direct Apigee ServiceCallout) confidence (" + tierConf.toFixed(2) +
            ") is below gate (" + confidenceThreshold.toFixed(2) + ") for choice='" + tierChoice +
            "'. Routing to L1 Gemini 2.5 Flash first with mandatory Post-Generation Noul Battery verification.";
    } else {
        routingReason = providerLabel + " Stage 1 Pre-Router (Direct Apigee ServiceCallout) routed to L1 Gemini 2.5 Flash " +
            "(choice='" + tierChoice + "', confidence=" + tierConf.toFixed(2) +
            ", complexity=" + compScore.toFixed(2) + "/2.0, thinkingBudget=" + thinkingBudget + ").";
    }
}

var userQuery = String(context.getVariable("ai.jev_user_query") || "").replace(/^\s+|\s+$/g, "");
var sysInstruction = String(context.getVariable("ai.jev_system_instruction") || "").replace(/^\s+|\s+$/g, "");
var ragContext = String(context.getVariable("ai.jev_rag_context") || "").replace(/^\s+|\s+$/g, "");

var sysParts = [];
if (sysInstruction.length > 0) {
    sysParts.push(sysInstruction);
}
if (ragContext.length > 0) {
    sysParts.push("REFERENCE CONTEXT:\n" + ragContext);
}

var vertexPayload = {
    contents: [
        {
            role: "user",
            parts: [{ text: userQuery }]
        }
    ],
    generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        thinkingConfig: {
            thinkingBudget: thinkingBudget
        }
    }
};
if (sysParts.length > 0) {
    vertexPayload.systemInstruction = {
        parts: [{ text: sysParts.join("\n\n") }]
    };
}

var preTelemetry = {
    system1_provider: providerId,
    system1_provider_label: providerLabel,
    routing_decision: routingDecision,
    target_model: targetModel,
    direct_to_pro: directToPro,
    thinking_budget: thinkingBudget,
    routing_reason: routingReason,
    jev_pre_route: {
        provider: providerId,
        provider_label: providerLabel,
        endpoint: endpointUrl,
        pricing_per_million_usd: ratePer1M,
        model: s1Raw.model || defaultModel,
        latency_ms: stage1LatencyMs,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: s1CostUsd,
        confidence_threshold: confidenceThreshold,
        target_tier: {
            choice: tierChoice,
            confidence: Number(tierConf.toFixed(4)),
            probabilities: tierProbs
        },
        complexity: {
            score: Number(compScore.toFixed(4)),
            confidence: Number(compConf.toFixed(4)),
            probabilities: compProbs
        },
        pre_nouls: {
            requires_formal_proof: Number(proofNoul.toFixed(4)),
            has_strict_multi_constraints: Number(multiNoul.toFixed(4))
        }
    }
};

var vertexPayloadStr = JSON.stringify(vertexPayload);

context.setVariable("ai.routing_decision", routingDecision);
context.setVariable("ai.target_model", targetModel);
context.setVariable("ai.jev_pre_telemetry_json", JSON.stringify(preTelemetry));
context.setVariable("ai.vertex_payload_sent_json", vertexPayloadStr);
context.setVariable("request.content", vertexPayloadStr);
context.setVariable("request.header.Content-Type", "application/json");
context.setVariable("target.copy.pathsuffix", false);
context.setVariable("target.copy.queryparams", false);
context.setVariable("ai.vertex_start_ms", String(Date.now()));
