// Format Apigee X Native AI Policy Faults into rich JSON telemetry for the Demo UI
var startMs = Number(context.getVariable("ai.gateway_start_ms") || Date.now());
var totalLatencyMs = Math.max(1, Date.now() - startMs);

var faultName = context.getVariable("fault.name") || "PolicyViolation";
var errorMessage = context.getVariable("error.message") || "";
var errorContent = context.getVariable("error.content") || "";
var errorStatusCode = Number(context.getVariable("error.status.code") || 400);
var pathSuffix = context.getVariable("proxy.pathsuffix") || "";
var orgName = context.getVariable("organization.name") || "apac-cs-5g-demo5";
var envName = context.getVariable("environment.name") || "demo";

if (context.getVariable("ai.sg_violation_detected") === "true") {
    faultName = "steps.semanticgovernance.RuleViolation";
    errorMessage = context.getVariable("ai.sg_violation_reason") || "SemanticGovernance rule violation";
    errorStatusCode = 422;
}

var flowVars = {
    ptl_allowed: context.getVariable("ratelimit.PTL-EnforcePromptLimit.allowed"),
    ptl_used_count: context.getVariable("ratelimit.PTL-EnforcePromptLimit.used.count"),
    ptl_available_count: context.getVariable("ratelimit.PTL-EnforcePromptLimit.available.count"),
    ptl_exceed_count: context.getVariable("ratelimit.PTL-EnforcePromptLimit.exceed.count"),
    ptl_limit_configured: context.getVariable("request.header.X-Prompt-Token-Limit"),
    ltq_allowed: context.getVariable("ratelimit.LTQ-EnforceOnly.allowed") || context.getVariable("ratelimit.LTQ-EnforceTokenQuota.allowed"),
    ltq_allowed_count: context.getVariable("ratelimit.LTQ-EnforceOnly.allowed.count") || context.getVariable("ratelimit.LTQ-EnforceTokenQuota.allowed.count"),
    ltq_used_count: context.getVariable("ratelimit.LTQ-EnforceOnly.used.count") || context.getVariable("ratelimit.LTQ-EnforceTokenQuota.used.count"),
    ltq_available_count: context.getVariable("ratelimit.LTQ-EnforceOnly.available.count") || context.getVariable("ratelimit.LTQ-EnforceTokenQuota.available.count"),
    ltq_exceed_count: context.getVariable("ratelimit.LTQ-EnforceOnly.exceed.count") || context.getVariable("ratelimit.LTQ-EnforceTokenQuota.exceed.count"),
    ltq_expiry_time: context.getVariable("ratelimit.LTQ-EnforceOnly.expiry.time") || context.getVariable("ratelimit.LTQ-EnforceTokenQuota.expiry.time"),
    ltq_identifier: context.getVariable("ratelimit.LTQ-EnforceOnly.identifier") || context.getVariable("ratelimit.LTQ-EnforceTokenQuota.identifier") || context.getVariable("request.header.X-Quota-Id"),
    sup_failed: context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPrompt.failed"),
    sup_filter_match_state: context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPrompt.filterMatchState"),
    sup_pi_confidence: context.getVariable("SanitizeUserPrompt.SUP-SanitizeUserPrompt.promptInjectionConfidence"),
    smr_failed: context.getVariable("SanitizeModelResponse.SMR-SanitizeModelResponse.failed"),
    smr_filter_match_state: context.getVariable("SanitizeModelResponse.SMR-SanitizeModelResponse.filterMatchState"),
    scl_cache_hit: context.getVariable("SemanticCacheLookup.SCL-NativeSemanticCacheLookup.cache_hit"),
    sg_failed: context.getVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.failed"),
    sg_rule_id: context.getVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.rule_id"),
    sg_verdict: context.getVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.verdict"),
    sg_violation_domain: context.getVariable("SemanticGovernance.SG-EnforceEnterpriseDomain.violation_domain")
};

var parsedErrorContent = null;
try {
    if (errorContent) {
        parsedErrorContent = JSON.parse(errorContent);
    }
} catch (e) {
    parsedErrorContent = errorContent;
}

var payload = {
    status: "BLOCKED_BY_APIGEE_POLICY",
    blocked: true,
    http_status_code: errorStatusCode,
    fault_name: faultName,
    error_message: errorMessage,
    error_details: parsedErrorContent,
    gateway: "Apigee X (" + orgName + " / env: " + envName + " / australia-southeast1)",
    apigee_organization: orgName,
    apigee_environment: envName,
    policy_flow: pathSuffix,
    latency_ms: totalLatencyMs,
    apigee_flow_variables: flowVars
};

context.setVariable("error.content", JSON.stringify(payload));
context.setVariable("error.header.Content-Type", "application/json");
context.setVariable("error.header.X-Apigee-Policy-Status", "BLOCKED");
context.setVariable("error.header.X-Apigee-Fault-Name", String(faultName));
context.setVariable("error.header.X-Apigee-Policy-Flow", String(pathSuffix));
context.setVariable("error.header.Access-Control-Allow-Origin", "*");
