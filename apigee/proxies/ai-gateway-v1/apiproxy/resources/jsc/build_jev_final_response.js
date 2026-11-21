// Apigee X PostFlow (Tab 5): Build Final Pure-Apigee System 1 + System 2 Response & Telemetry Envelope
// Strict ES5 for Apigee X Mozilla Rhino runtime.
var totalEndMs = Date.now();
var gatewayStartMs = Number(context.getVariable("ai.gateway_start_ms") || totalEndMs);
var totalGatewayLatencyMs = Math.max(1, totalEndMs - gatewayStartMs);

function parseVertexResponse(raw, modelName) {
    var candidates = (raw && raw.candidates) || [];
    var textParts = [];
    if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
        var parts = candidates[0].content.parts;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (p && typeof p.text === "string" && !p.thought) {
                textParts.push(p.text);
            }
        }
    }
    var text = textParts.join("\n").replace(/^\s+|\s+$/g, "");

    var usageMeta = (raw && raw.usageMetadata) || {};
    var promptTokens = Number(usageMeta.promptTokenCount || 0);
    var candidateTokens = Number(usageMeta.candidatesTokenCount || 0);
    var thinkingTokens = Number(usageMeta.thoughtsTokenCount || 0);
    var totalTokens = Number(usageMeta.totalTokenCount || (promptTokens + candidateTokens + thinkingTokens));

    var isPro = modelName === "gemini-2.5-pro";
    var inRate = isPro ? 1.25 : 0.30;
    var outRate = isPro ? 10.00 : 2.50;
    var costUsd = Number((
        (promptTokens / 1000000.0) * inRate +
        ((candidateTokens + thinkingTokens) / 1000000.0) * outRate
    ).toFixed(8));

    return {
        text: text,
        usage: {
            model: modelName,
            prompt_tokens: promptTokens,
            candidate_tokens: candidateTokens,
            thinking_tokens: thinkingTokens,
            total_tokens: totalTokens,
            cost_usd: costUsd
        }
    };
}

var preData = {};
try {
    preData = JSON.parse(context.getVariable("ai.jev_pre_telemetry_json") || "{}");
} catch (e) {
    preData = {};
}

var zeroUsage = {
    model: "none",
    prompt_tokens: 0,
    candidate_tokens: 0,
    thinking_tokens: 0,
    total_tokens: 0,
    cost_usd: 0.0
};

var parsedL1Usage = zeroUsage;
try {
    parsedL1Usage = JSON.parse(context.getVariable("ai.l1_usage_json") || "null") || zeroUsage;
} catch (e) {
    parsedL1Usage = zeroUsage;
}

var stage2Data = {};
try {
    stage2Data = JSON.parse(context.getVariable("ai.stage2_telemetry_json") || "{}");
} catch (e) {
    stage2Data = {};
}

var jPre = preData.jev_pre_route || {};
var resolvedProvider = preData.system1_provider || jPre.provider || context.getVariable("ai.system1_provider") || "gemini_decision_1";
var isGemini = resolvedProvider === "gemini_decision_1";
var resolvedProviderLabel = preData.system1_provider_label || jPre.provider_label || (isGemini ? "Google Gemini Decision 1" : "TypeSafe Jev");
var shortLabel = isGemini ? "Gemini Decision 1" : "Jev";
var defaultS1Model = isGemini ? "gemini-decision-1" : "jev-latest";
var defaultEndpoint = isGemini
    ? "https://generativelanguage.googleapis.com/v1beta/decisions"
    : "https://api.typesafe.ai/v1/systemone";

var routingDecision = context.getVariable("ai.routing_decision") || "GEMINI_2_5_FLASH";
var initialTargetModel = preData.target_model || context.getVariable("ai.target_model") || "gemini-2.5-flash";
var directToPro = routingDecision === "GEMINI_2_5_PRO" || initialTargetModel === "gemini-2.5-pro";
var postVerifierExecuted = Boolean(stage2Data.executed);
var escalatedToPro = context.getVariable("ai.escalate_to_pro") === "true";

var l1Text = context.getVariable("ai.l1_response_text") || "";
var candidateText = context.getVariable("ai.candidate_text_for_verification") || l1Text;
var l1LatencyMs = Number(context.getVariable("ai.l1_vertex_latency_ms") || 0);

var l1Usage = directToPro ? zeroUsage : parsedL1Usage;
var l2Usage = directToPro ? parsedL1Usage : null;
var l2LatencyMs = 0;
var finalResponseText = candidateText;
var finalModelUsed;
var routePath;
var escalationReason;
var l1ResponsePreview = "";

var policiesExecuted = [
    "KVM-GetSystem1Keys",
    "JS-PrepareJevPreRoute",
    isGemini ? "SC-GeminiDecisionPreRoute" : "SC-TypeSafeJevPreRoute",
    "JS-ProcessJevPreRoute",
    directToPro ? "Route-VertexPro" : "Route-VertexFlash",
    "JS-PrepareJevPostVerify"
];

if (postVerifierExecuted) {
    policiesExecuted.push(isGemini ? "SC-GeminiDecisionPostVerify" : "SC-TypeSafeJevPostVerify");
    policiesExecuted.push("JS-EvaluateNoulBattery");
}

if (directToPro) {
    finalResponseText = l1Text;
    finalModelUsed = "gemini-2.5-pro (Direct System 2 Fast-Track via " + shortLabel + ")";
    routePath = shortLabel + " Pre-Router (Apigee SC) -> Direct Gemini 2.5 Pro (Skipped L1 Flash)";
    escalationReason = "Stage 1 fast-tracked directly to System 2 Pro via Apigee Route-VertexPro.";
} else if (escalatedToPro) {
    policiesExecuted.push("SC-EscalateVertexPro");
    var l2StartMs = Number(context.getVariable("ai.l2_start_ms") || totalEndMs);
    l2LatencyMs = Math.max(1, totalEndMs - l2StartMs);
    var l2RawStr = context.getVariable("l2ProResponse.content") || "{}";
    var l2Raw = {};
    try {
        l2Raw = JSON.parse(l2RawStr);
    } catch (e) {
        l2Raw = {};
    }
    var parsedL2 = parseVertexResponse(l2Raw, "gemini-2.5-pro");
    finalResponseText = parsedL2.text;
    l2Usage = parsedL2.usage;
    finalModelUsed = "gemini-2.5-flash -> gemini-2.5-pro (" + shortLabel + " SDE Cascade Escalated)";
    routePath = shortLabel + " Pre-Router -> L1 Flash -> " + shortLabel + " Noul Battery (FIRED) -> Apigee SC-EscalateVertexPro";
    escalationReason = stage2Data.escalation_reason || "Noul battery fired; escalated to Gemini 2.5 Pro.";
    l1ResponsePreview = candidateText.substring(0, 500);
} else if (postVerifierExecuted) {
    finalModelUsed = "gemini-2.5-flash (Verified by " + shortLabel + " Noul Battery)";
    routePath = shortLabel + " Pre-Router -> L1 Gemini 2.5 Flash -> " + shortLabel + " Noul Battery (ACCEPTED)";
    escalationReason = "All 5 Noul heads <= fire_threshold; L1 Gemini 2.5 Flash response accepted.";
} else {
    finalModelUsed = "gemini-2.5-flash";
    routePath = shortLabel + " Pre-Router -> L1 Gemini 2.5 Flash (Verifier Disabled)";
    escalationReason = "Post-Verifier Disabled; L1 Gemini 2.5 Flash response returned.";
}
policiesExecuted.push("JS-BuildJevFinalResponse");

var jevStage1InputTokens = Number(jPre.input_tokens || 0);
var jevStage1OutputTokens = Number(jPre.output_tokens || 0);
var jevStage1CostUsd = Number(jPre.cost_usd || 0);

var st2Usage = stage2Data.usage || {};
var jevStage2InputTokens = Number(st2Usage.input_tokens || 0);
var jevStage2OutputTokens = Number(st2Usage.output_tokens || 0);
var jevStage2CostUsd = Number(st2Usage.cost_usd || 0);

var totalJevInputTokens = jevStage1InputTokens + jevStage2InputTokens;
var totalJevOutputTokens = jevStage1OutputTokens + jevStage2OutputTokens;
var totalJevCostUsd = Number((jevStage1CostUsd + jevStage2CostUsd).toFixed(8));

var llmPromptTokens = Number(l1Usage.prompt_tokens || 0) + (l2Usage ? Number(l2Usage.prompt_tokens || 0) : 0);
var llmCandidateTokens = Number(l1Usage.candidate_tokens || 0) + (l2Usage ? Number(l2Usage.candidate_tokens || 0) : 0);
var llmThinkingTokens = Number(l1Usage.thinking_tokens || 0) + (l2Usage ? Number(l2Usage.thinking_tokens || 0) : 0);
var llmTotalTokens = Number(l1Usage.total_tokens || 0) + (l2Usage ? Number(l2Usage.total_tokens || 0) : 0);
var llmCostUsd = Number(l1Usage.cost_usd || 0) + (l2Usage ? Number(l2Usage.cost_usd || 0) : 0);
var totalCostUsd = Number((llmCostUsd + totalJevCostUsd).toFixed(8));

var apigeeOrgName = context.getVariable("organization.name") || "apac-cs-5g-demo5";
var apigeeEnvName = context.getVariable("environment.name") || "demo";
var tierObj = jPre.target_tier || {};
var compObj = jPre.complexity || {};

var stage1Normalized = {
    provider: resolvedProvider,
    provider_label: resolvedProviderLabel,
    endpoint: jPre.endpoint || defaultEndpoint,
    pricing_per_million_usd: Number(jPre.pricing_per_million_usd || (isGemini ? 0.10 : 0.042)),
    model: jPre.model || defaultS1Model,
    latency_ms: Number(jPre.latency_ms || 0),
    confidence_threshold: Number(jPre.confidence_threshold || 0.75),
    target_tier_choice: tierObj.choice || "flash_with_verifier",
    target_tier_confidence: Number(tierObj.confidence || 0),
    target_tier_probabilities: tierObj.probabilities || {},
    complexity_score: Number(compObj.score || 0),
    complexity_normalized: Number(((compObj.score || 0) / 2.0).toFixed(4)),
    complexity_probabilities: compObj.probabilities || {},
    pre_nouls: jPre.pre_nouls || {},
    usage: {
        input_tokens: jevStage1InputTokens,
        output_tokens: jevStage1OutputTokens,
        cost_usd: jevStage1CostUsd
    }
};

var stage2Normalized = {
    provider: resolvedProvider,
    provider_label: resolvedProviderLabel,
    endpoint: stage2Data.endpoint || defaultEndpoint,
    pricing_per_million_usd: Number(stage2Data.pricing_per_million_usd || (isGemini ? 0.10 : 0.042)),
    executed: postVerifierExecuted,
    skipped_reason: directToPro
        ? "Direct System 2 Pro Fast-Track (No L1 Flash call)"
        : (!postVerifierExecuted ? "Post-Verifier Disabled" : null),
    model: stage2Data.model || defaultS1Model,
    latency_ms: Number(stage2Data.latency_ms || 0),
    fire_threshold: Number(stage2Data.fire_threshold || Number(context.getVariable("ai.jev_fire_threshold") || 0.70)),
    max_noul_value: Number(stage2Data.max_noul_value || 0),
    any_flag_fired: Boolean(stage2Data.any_flag_fired),
    firing_heads: stage2Data.firing_heads || [],
    holistic_escalate_judge: Number(stage2Data.holistic_escalate_judge || 0),
    response_quality_score: Number(stage2Data.response_quality_score || 0),
    noul_battery_table: stage2Data.noul_battery_table || [],
    usage: {
        input_tokens: jevStage2InputTokens,
        output_tokens: jevStage2OutputTokens,
        cost_usd: jevStage2CostUsd
    }
};

var finalEnvelope = {
    gateway: "Apigee X (" + apigeeOrgName + " / env: " + apigeeEnvName + " / australia-southeast1)",
    execution_architecture: "Pure Apigee X Native ServiceCallout (Zero Cloud Run)",
    apigee_policies_executed: policiesExecuted,
    apigee_organization: apigeeOrgName,
    apigee_environment: apigeeEnvName,
    system1_provider: resolvedProvider,
    system1_provider_label: resolvedProviderLabel,
    system1_model: stage1Normalized.model,
    response_text: finalResponseText,
    final_model_used: finalModelUsed,
    route_path: routePath,
    initial_routing_decision: routingDecision,
    initial_target_model: initialTargetModel,
    apigee_route_rule_taken: directToPro ? "Route-VertexPro (vertex-pro-global)" : "Route-VertexFlash (vertex-flash-au)",
    routing_reason: preData.routing_reason || "",
    cascade_evaluated: postVerifierExecuted,
    escalated_to_pro: escalatedToPro,
    escalation_reason: escalationReason,
    l1_response_preview: l1ResponsePreview,
    latency_ms: totalGatewayLatencyMs,
    latency_breakdown_ms: {
        stage1_jev_pre_route_ms: stage1Normalized.latency_ms,
        l1_vertex_inference_ms: l1LatencyMs,
        stage2_jev_post_verify_ms: stage2Normalized.latency_ms,
        l2_vertex_escalation_ms: l2LatencyMs,
        total_gateway_ms: totalGatewayLatencyMs
    },
    token_accounting: {
        jev_stage1_input_tokens: jevStage1InputTokens,
        jev_stage1_output_tokens: jevStage1OutputTokens,
        jev_stage2_input_tokens: jevStage2InputTokens,
        jev_stage2_output_tokens: jevStage2OutputTokens,
        total_jev_input_tokens: totalJevInputTokens,
        total_jev_output_tokens: totalJevOutputTokens,
        llm_prompt_tokens: llmPromptTokens,
        llm_candidate_tokens: llmCandidateTokens,
        llm_thinking_tokens: llmThinkingTokens,
        total_llm_tokens: llmTotalTokens,
        grand_total_tokens: llmTotalTokens + totalJevInputTokens
    },
    cost_accounting: {
        jev_stage1_cost_usd: Number(jevStage1CostUsd.toFixed(8)),
        jev_stage2_cost_usd: Number(jevStage2CostUsd.toFixed(8)),
        total_jev_system1_cost_usd: totalJevCostUsd,
        l1_vertex_cost_usd: Number((l1Usage.cost_usd || 0).toFixed(8)),
        l2_vertex_cost_usd: Number((l2Usage ? l2Usage.cost_usd : 0).toFixed(8)),
        total_llm_inference_cost_usd: Number(llmCostUsd.toFixed(8)),
        total_cost_usd: totalCostUsd
    },
    stage1_jev: stage1Normalized,
    stage2_jev: stage2Normalized,
    l1_usage: l1Usage,
    l2_usage: l2Usage
};

context.setVariable("response.content", JSON.stringify(finalEnvelope));
context.setVariable("response.header.Content-Type", "application/json");
