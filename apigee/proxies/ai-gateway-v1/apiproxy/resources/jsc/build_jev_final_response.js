// Apigee X PostFlow (Tab 5): Build final System 1 (Jev) + System 2 (Gemini) response & telemetry envelope
var totalEndMs = Date.now();
var gatewayStartMs = Number(context.getVariable("ai.gateway_start_ms") || totalEndMs);
var totalGatewayLatencyMs = Math.max(1, totalEndMs - gatewayStartMs);

var preData = {};
try {
    preData = JSON.parse(context.getVariable("ai.jev_pre_telemetry_json") || "{}");
} catch (e) {
    preData = {};
}

var verifyRawStr = context.getVariable("jevPostVerifyResponse.content") || "{}";
var verifyData = {};
try {
    verifyData = JSON.parse(verifyRawStr);
} catch (e) {
    verifyData = {};
}

var zeroUsage = {
    model: "none",
    prompt_tokens: 0,
    candidate_tokens: 0,
    thinking_tokens: 0,
    total_tokens: 0,
    cost_usd: 0.0
};

var l1Usage = verifyData.l1_usage || zeroUsage;
var l2Usage = verifyData.l2_usage || null;
var l1LatencyMs = Number(context.getVariable("ai.l1_vertex_latency_ms") || 0);
var l2LatencyMs = Number(verifyData.l2_latency_ms || 0);

var jPre = preData.jev_pre_route || {};
var jPost = verifyData.jev_post_verify || null;

var jevStage1InputTokens = Number(jPre.input_tokens || 0);
var jevStage1OutputTokens = Number(jPre.output_tokens || 0);
var jevStage1CostUsd = Number(jPre.cost_usd || 0);

var jevStage2InputTokens = Number((jPost && jPost.input_tokens) || 0);
var jevStage2OutputTokens = Number((jPost && jPost.output_tokens) || 0);
var jevStage2CostUsd = Number((jPost && jPost.cost_usd) || 0);

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
var routingDecision = context.getVariable("ai.routing_decision") || "GEMINI_2_5_FLASH";

var tierObj = jPre.target_tier || {};
var compObj = jPre.complexity || {};
var stage1Normalized = {
    model: jPre.model || "jev-latest",
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

var noulTable = [];
var firingHeadsList = [];
var holisticVal = 0;
if (jPost && jPost.noul_battery) {
    var nb = jPost.noul_battery;
    var fThresh = Number(jPost.fire_threshold || 0.70);
    for (var k in nb) {
        if (Object.prototype.hasOwnProperty.call(nb, k)) {
            var pVal = Number(nb[k] || 0);
            if (k.indexOf("__overall__") === 0) {
                holisticVal = pVal;
            } else {
                var didFire = pVal > fThresh;
                if (didFire) {
                    firingHeadsList.push(k + "=" + pVal.toFixed(2));
                }
                noulTable.push({
                    question: k,
                    probability: pVal,
                    fired: didFire
                });
            }
        }
    }
}

var stage2Normalized = {
    executed: Boolean(verifyData.post_verifier_executed),
    skipped_reason: verifyData.direct_to_pro ? "Direct System 2 Pro Fast-Track (No L1 Flash call)" : (!verifyData.post_verifier_executed ? "Post-Verifier Disabled" : null),
    model: (jPost && jPost.model) || "jev-latest",
    latency_ms: Number((jPost && jPost.latency_ms) || 0),
    fire_threshold: Number((jPost && jPost.fire_threshold) || 0.70),
    max_noul_value: Number((jPost && jPost.max_defect_noul) || 0),
    any_flag_fired: Boolean(verifyData.escalated_to_pro),
    firing_heads: firingHeadsList,
    holistic_escalate_judge: holisticVal,
    response_quality_score: Number((jPost && jPost.response_quality && jPost.response_quality.score) || 0),
    noul_battery_table: noulTable,
    usage: {
        input_tokens: jevStage2InputTokens,
        output_tokens: jevStage2OutputTokens,
        cost_usd: jevStage2CostUsd
    }
};

var finalEnvelope = {
    gateway: "Apigee X (" + apigeeOrgName + " / env: " + apigeeEnvName + " / australia-southeast1)",
    apigee_organization: apigeeOrgName,
    apigee_environment: apigeeEnvName,
    response_text: verifyData.final_response_text || "",
    final_model_used: verifyData.final_model_used || preData.target_model || "gemini-2.5-flash",
    route_path: verifyData.route_path || "",
    initial_routing_decision: routingDecision,
    initial_target_model: preData.target_model || "gemini-2.5-flash",
    apigee_route_rule_taken: routingDecision === "GEMINI_2_5_PRO" ? "Route-VertexPro (vertex-pro-global)" : "Route-VertexFlash (vertex-flash-au)",
    routing_reason: preData.routing_reason || "",
    cascade_evaluated: Boolean(verifyData.post_verifier_executed),
    escalated_to_pro: Boolean(verifyData.escalated_to_pro),
    escalation_reason: verifyData.escalation_reason || "All 5 Noul heads <= fire_threshold; L1 Gemini 2.5 Flash response accepted.",
    l1_response_preview: verifyData.l1_response_preview || "",
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
