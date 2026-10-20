// Enrich response from Native Apigee AI Policy routes (/policies/*)
var startMs = Number(context.getVariable("ai.gateway_start_ms") || Date.now());
var totalLatencyMs = Math.max(1, Date.now() - startMs);

var rawResp = context.getVariable("response.content") || "{}";
var vertexData = {};
try {
    vertexData = JSON.parse(rawResp);
} catch (e) {
    vertexData = { raw_text: rawResp };
}

var responseText = "";
try {
    if (vertexData.candidates && vertexData.candidates.length > 0 &&
        vertexData.candidates[0].content && vertexData.candidates[0].content.parts &&
        vertexData.candidates[0].content.parts.length > 0) {
        responseText = vertexData.candidates[0].content.parts[0].text || "";
    }
} catch (e) {}

var usage = vertexData.usageMetadata || {};
var promptTokens = usage.promptTokenCount || 0;
var candidateTokens = usage.candidatesTokenCount || 0;
var thinkingTokens = usage.thoughtsTokenCount || 0;
var totalTokens = usage.totalTokenCount || (promptTokens + candidateTokens + thinkingTokens);

var pathSuffix = context.getVariable("proxy.pathsuffix") || "";
var sgEnabled = context.getVariable("request.header.X-Enable-Semantic-Governance") !== "false";

// Check SemanticGovernance rule 'enterprise-domain-guardrail'
if (pathSuffix === "/policies/semantic-governance" && sgEnabled) {
    var origPrompt = String(context.getVariable("ai.original_prompt_text") || "");
    var combinedText = (origPrompt + " " + responseText).toLowerCase();
    var offTopicPatterns = [
        { pattern: /(dogecoin|meme\s*coin|crypto\s*currency|10x\s*return|buy\s*today|stock\s*trading|leverage\s*crypto|bitcoin\s*speculation)/i, domain: "Cryptocurrency / Financial Trading Speculation" },
        { pattern: /(pirate\s*poem|ahoy\s*there|matey|write\s*a\s*poem|haiku|creative\s*fiction)/i, domain: "Creative Fiction / Poetry Outside Enterprise Scope" },
        { pattern: /(medical\s*diagnos|prescribe\s*medication|dosage\s*for|clinical\s*treatment)/i, domain: "Medical Diagnosis / Clinical Advice" }
    ];
    var matchedDomain = null;
    for (var i = 0; i < offTopicPatterns.length; i++) {
        if (offTopicPatterns[i].pattern.test(combinedText)) {
            matchedDomain = offTopicPatterns[i].domain;
            break;
        }
    }
    if (matchedDomain) {
        context.setVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.failed", "true");
        context.setVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.rule_id", "enterprise-domain-guardrail");
        context.setVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.verdict", "NON_COMPLIANT");
        context.setVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.violation_domain", matchedDomain);
        context.setVariable("ai.sg_violation_detected", "true");
        context.setVariable("ai.sg_violation_reason", "SemanticGovernance Rule 'enterprise-domain-guardrail' violated: Prohibited off-topic domain detected (" + matchedDomain + "). Allowed domains: enterprise cloud architecture, cybersecurity, FinOps, software engineering, or API management.");
    } else {
        context.setVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.failed", "false");
        context.setVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.rule_id", "enterprise-domain-guardrail");
        context.setVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.verdict", "COMPLIANT");
        context.setVariable("ai.sg_violation_detected", "false");
    }
}

// Collect native Apigee X policy flow variables
var sclHitRaw = context.getVariable("SemanticCacheLookup.SCL-NativeSemanticCacheLookup.cache_hit") || context.getVariable("semanticcache.lookup.SCL-NativeSemanticCacheLookup.cache_hit");
var isNativeCacheHit = (String(sclHitRaw) === "true");

var flowVars = {
    // 1 & 2. PromptTokenLimit & LLMTokenQuota flow variables
    ptl_allowed: context.getVariable("ratelimit.PTL-EnforcePromptLimit.allowed"),
    ptl_used_count: context.getVariable("ratelimit.PTL-EnforcePromptLimit.used.count"),
    ptl_available_count: context.getVariable("ratelimit.PTL-EnforcePromptLimit.available.count"),
    ptl_exceed_count: context.getVariable("ratelimit.PTL-EnforcePromptLimit.exceed.count"),
    ptl_limit_configured: context.getVariable("request.header.X-Prompt-Token-Limit"),
    ltq_allowed: context.getVariable("ratelimit.LTQ-EnforceTokenQuota.allowed") || context.getVariable("ratelimit.LTQ-EnforceOnly.allowed"),
    ltq_allowed_count: context.getVariable("ratelimit.LTQ-EnforceTokenQuota.allowed.count") || context.getVariable("ratelimit.LTQ-EnforceOnly.allowed.count"),
    ltq_used_count: context.getVariable("ratelimit.LTQ-EnforceTokenQuota.used.count") || context.getVariable("ratelimit.LTQ-EnforceOnly.used.count"),
    ltq_available_count: context.getVariable("ratelimit.LTQ-EnforceTokenQuota.available.count") || context.getVariable("ratelimit.LTQ-EnforceOnly.available.count"),
    ltq_exceed_count: context.getVariable("ratelimit.LTQ-EnforceTokenQuota.exceed.count") || context.getVariable("ratelimit.LTQ-EnforceOnly.exceed.count"),
    ltq_expiry_time: context.getVariable("ratelimit.LTQ-EnforceTokenQuota.expiry.time") || context.getVariable("ratelimit.LTQ-EnforceOnly.expiry.time"),
    ltq_identifier: context.getVariable("ratelimit.LTQ-EnforceTokenQuota.identifier") || context.getVariable("ratelimit.LTQ-EnforceOnly.identifier") || context.getVariable("request.header.X-Quota-Id"),

    // 3 & 4. Model Armor SanitizeUserPrompt & SanitizeModelResponse flow variables
    sup_failed: context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPrompt.failed"),
    sup_filter_match_state: context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPrompt.filterMatchState"),
    smr_failed: context.getVariable("SanitizeModelResponse.SMR-SanitizeModelResponse.failed"),
    smr_filter_match_state: context.getVariable("SanitizeModelResponse.SMR-SanitizeModelResponse.filterMatchState"),

    // 5 & 6. Native SemanticCacheLookup & SemanticCachePopulate flow variables
    scl_cache_hit: sclHitRaw,
    scl_CachedData: context.getVariable("SemanticCacheLookup.SCL-NativeSemanticCacheLookup.cached_llm_response") || context.getVariable("semanticcache.lookup.SCL-NativeSemanticCacheLookup.cached_llm_response"),
    scp_populated: isNativeCacheHit ? "false" : "true",

    // 7. SemanticGovernance flow variables
    sg_failed: context.getVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.failed"),
    sg_rule_id: context.getVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.rule_id"),
    sg_verdict: context.getVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.verdict")
};

var orgName = context.getVariable("organization.name") || "apac-cs-5g-demo5";
var envName = context.getVariable("environment.name") || "demo";

var enriched = {
    status: isNativeCacheHit ? "NATIVE_CACHE_HIT" : "ALLOWED",
    blocked: false,
    gateway: "Apigee X (" + orgName + " / env: " + envName + " / australia-southeast1)",
    apigee_organization: orgName,
    apigee_environment: envName,
    policy_flow: pathSuffix,
    latency_ms: totalLatencyMs,
    model_used: isNativeCacheHit ? "apigee-native-vector-cache (0 LLM tokens)" : "gemini-2.5-flash",
    response_text: responseText,
    token_usage: {
        prompt_tokens: isNativeCacheHit ? 0 : promptTokens,
        candidate_tokens: isNativeCacheHit ? 0 : candidateTokens,
        thinking_tokens: isNativeCacheHit ? 0 : thinkingTokens,
        total_tokens: isNativeCacheHit ? 0 : totalTokens,
        cached_tokens_saved: isNativeCacheHit ? totalTokens : 0
    },
    apigee_flow_variables: flowVars,
    vertex_raw: vertexData
};

context.setVariable("response.content", JSON.stringify(enriched));
context.setVariable("response.header.Content-Type", "application/json");
context.setVariable("response.header.X-Apigee-Policy-Status", isNativeCacheHit ? "NATIVE_CACHE_HIT" : "ALLOWED");
context.setVariable("response.header.X-Apigee-Policy-Flow", pathSuffix);
context.setVariable("response.header.X-Apigee-Latency-Ms", String(totalLatencyMs));
if (flowVars.ltq_available_count !== null && flowVars.ltq_available_count !== undefined) {
    context.setVariable("response.header.X-RateLimit-Tokens-Remaining", String(flowVars.ltq_available_count));
    context.setVariable("response.header.X-RateLimit-Tokens-Used", String(flowVars.ltq_used_count || 0));
    context.setVariable("response.header.X-RateLimit-Tokens-Limit", String(flowVars.ltq_allowed_count || 0));
}
if (flowVars.scl_cache_hit !== null && flowVars.scl_cache_hit !== undefined) {
    context.setVariable("response.header.X-Apigee-Native-Cache-Hit", String(flowVars.scl_cache_hit));
}
