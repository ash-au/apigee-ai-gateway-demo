// Apigee X PostFlow Step 3: Build final response + auditable x-apigee-ai-telemetry envelope
var totalEndMs = Date.now();
var gatewayStartMs = Number(context.getVariable("ai.gateway_start_ms") || totalEndMs);
var totalGatewayLatencyMs = Math.max(1, totalEndMs - gatewayStartMs);

var preData = {};
try {
    preData = JSON.parse(context.getVariable("ai.pre_telemetry_json") || "{}");
} catch (e) {
    preData = {};
}

var toggles = {};
try {
    toggles = JSON.parse(context.getVariable("ai.toggles_json") || "{}");
} catch (e) {
    toggles = {};
}

var routingDecision = context.getVariable("ai.routing_decision") || "GEMINI_2_5_PRO";
var responseText = "";
var modelUsed = "";
var cascadeEvaluated = false;
var escalatedToPro = false;
var reliabilityScore = 1.0;
var reliabilityThreshold = 0.80;
var reliabilitySignals = {};
var escalationReason = null;
var l1ResponsePreview = null;
var l1Usage = {
    model: "none",
    prompt_tokens: 0,
    candidate_tokens: 0,
    thinking_tokens: 0,
    total_tokens: 0,
    cost_usd: 0.0
};
var l2Usage = null;
var l2LatencyMs = 0.0;
var l1LatencyMs = Number(context.getVariable("ai.l1_vertex_latency_ms") || 0);

if (routingDecision === "CACHE_SHORT_CIRCUIT") {
    responseText = preData.cached_response_text || "";
    modelUsed = "semantic-cache (origin: " + (preData.cached_model_used || "gemini-2.5-flash") + ")";
} else {
    var cascadeRawStr = context.getVariable("cascadeEvalResponse.content") || "{}";
    var cascadeData = {};
    try {
        cascadeData = JSON.parse(cascadeRawStr);
    } catch (e) {
        cascadeData = {};
    }
    responseText = cascadeData.final_response_text || "";
    modelUsed = cascadeData.final_model_used || preData.target_model || "gemini-2.5-pro";
    cascadeEvaluated = Boolean(cascadeData.cascade_evaluated);
    escalatedToPro = Boolean(cascadeData.escalated_to_pro);
    reliabilityScore = cascadeData.reliability_score !== undefined ? cascadeData.reliability_score : 1.0;
    reliabilityThreshold = cascadeData.reliability_threshold !== undefined ? cascadeData.reliability_threshold : 0.80;
    reliabilitySignals = cascadeData.reliability_signals || {};
    escalationReason = cascadeData.escalation_reason || null;
    l1ResponsePreview = cascadeData.l1_response_preview || null;
    if (cascadeData.l1_usage) {
        l1Usage = cascadeData.l1_usage;
    }
    if (cascadeData.l2_usage) {
        l2Usage = cascadeData.l2_usage;
    }
    l2LatencyMs = Number(cascadeData.l2_latency_ms || 0);
}

// Compute exact total tokens and total USD cost including all gateway overhead
var llmPromptTokens = Number(l1Usage.prompt_tokens || 0) + (l2Usage ? Number(l2Usage.prompt_tokens || 0) : 0);
var llmCandidateTokens = Number(l1Usage.candidate_tokens || 0) + (l2Usage ? Number(l2Usage.candidate_tokens || 0) : 0);
var llmThinkingTokens = Number(l1Usage.thinking_tokens || 0) + (l2Usage ? Number(l2Usage.thinking_tokens || 0) : 0);
var llmTotalTokens = Number(l1Usage.total_tokens || 0) + (l2Usage ? Number(l2Usage.total_tokens || 0) : 0);

var embeddingTokens = Number(preData.embedding_tokens_used || 0);
var pruningFlashTokens = Number(preData.pruning_flash_input_tokens || 0) + Number(preData.pruning_flash_output_tokens || 0) + Number(preData.pruning_flash_thinking_tokens || 0);

var llmCostUsd = Number(l1Usage.cost_usd || 0) + (l2Usage ? Number(l2Usage.cost_usd || 0) : 0);
var overheadCostUsd = Number(preData.embedding_cost_usd || 0) + Number(preData.pruning_overhead_cost_usd || 0);
var totalCostUsd = Number((llmCostUsd + overheadCostUsd).toFixed(8));

var apigeeOrgName = context.getVariable("organization.name") || "apac-cs-5g-demo5";
var apigeeEnvName = context.getVariable("environment.name") || "demo";

var finalEnvelope = {
    gateway: "Apigee X (" + apigeeOrgName + " / env: " + apigeeEnvName + " / australia-southeast1)",
    apigee_organization: apigeeOrgName,
    apigee_environment: apigeeEnvName,
    response_text: responseText,
    model_used: modelUsed,
    latency_ms: totalGatewayLatencyMs,
    toggles_active: toggles,
    token_accounting: {
        prompt_tokens: llmPromptTokens,
        candidate_tokens: llmCandidateTokens,
        thinking_tokens: llmThinkingTokens,
        total_llm_tokens: llmTotalTokens,
        embedding_overhead_tokens: embeddingTokens,
        pruning_summarizer_overhead_tokens: pruningFlashTokens,
        grand_total_billed_tokens: llmTotalTokens + embeddingTokens + pruningFlashTokens
    },
    cost_accounting: {
        llm_inference_cost_usd: Number(llmCostUsd.toFixed(8)),
        embedding_lookup_cost_usd: Number((preData.embedding_cost_usd || 0).toFixed(8)),
        pruning_summarizer_cost_usd: Number((preData.pruning_overhead_cost_usd || 0).toFixed(8)),
        total_cost_usd: totalCostUsd
    },
    optimizations: {
        semantic_cache: {
            enabled: Boolean(toggles.semantic_cache),
            hit: Boolean(preData.cache_hit),
            similarity_score: preData.cache_similarity,
            matched_query: preData.cached_matched_query,
            embedding_tokens: embeddingTokens,
            latency_ms: preData.embedding_latency_ms || 0
        },
        context_pruning: {
            enabled: Boolean(toggles.context_pruning),
            applied: Boolean(preData.pruning_applied),
            turns_before: preData.turns_before_pruning || 0,
            turns_after: preData.turns_after_pruning || 0,
            tokens_before: preData.tokens_before_pruning || 0,
            tokens_after: preData.tokens_after_pruning || 0,
            summary_generated: preData.pruning_summary_text || null,
            summarizer_overhead_tokens: pruningFlashTokens,
            latency_ms: preData.pruning_latency_ms || 0
        },
        prompt_compression: {
            enabled: Boolean(toggles.prompt_compression),
            applied: Boolean(preData.compression_applied),
            method: preData.compression_method || "NONE",
            tokens_before: preData.tokens_before_compression || 0,
            tokens_after: preData.tokens_after_compression || 0,
            compression_ratio: preData.compression_ratio_achieved || 1.0,
            budget_allocation: preData.budget_allocation || {},
            original_prompt: preData.original_assembled_prompt || "",
            compressed_prompt: preData.compressed_assembled_prompt || "",
            latency_ms: preData.compression_latency_ms || 0
        },
        model_routing_cascade: {
            enabled: Boolean(toggles.model_routing),
            initial_decision: routingDecision,
            initial_target_model: preData.target_model || "gemini-2.5-pro",
            routing_reason: preData.routing_reason || "",
            complexity_score: preData.complexity_score || 0,
            complexity_signals: preData.complexity_signals || [],
            cascade_evaluated: cascadeEvaluated,
            escalated_to_pro: escalatedToPro,
            reliability_score: reliabilityScore,
            reliability_threshold: reliabilityThreshold,
            reliability_signals: reliabilitySignals,
            escalation_reason: escalationReason,
            l1_response_preview: l1ResponsePreview,
            l1_usage: l1Usage,
            l1_latency_ms: l1LatencyMs,
            l2_usage: l2Usage,
            l2_latency_ms: l2LatencyMs
        }
    }
};

var cacheStatusStr = preData.cache_hit ? "HIT" : "MISS";
var cascadeEscalatedStr = String(escalatedToPro);
var tokensBeforeStr = String(preData.tokens_before_compression || 0);
var tokensAfterStr = String(preData.tokens_after_compression || 0);
var totalCostStr = String(totalCostUsd);
var totalLatencyStr = String(totalGatewayLatencyMs);

context.setVariable("ai.hdr_cache_status", cacheStatusStr);
context.setVariable("ai.hdr_model_used", modelUsed);
context.setVariable("ai.hdr_cascade_escalated", cascadeEscalatedStr);
context.setVariable("ai.hdr_tokens_before", tokensBeforeStr);
context.setVariable("ai.hdr_tokens_after", tokensAfterStr);
context.setVariable("ai.hdr_total_cost_usd", totalCostStr);
context.setVariable("ai.hdr_total_latency_ms", totalLatencyStr);

context.setVariable("response.content", JSON.stringify(finalEnvelope));
context.setVariable("response.header.Content-Type", "application/json");

