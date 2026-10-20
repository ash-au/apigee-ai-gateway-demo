// Prepare request for Native Apigee AI Policy routes (/policies/*)
context.setVariable("ai.gateway_start_ms", String(Date.now()));
context.setVariable("target.copy.pathsuffix", false);
context.setVariable("target.copy.queryparams", false);

// Preserve original user prompt text for response-phase governance telemetry
try {
    var reqBody = JSON.parse(context.getVariable("request.content") || "{}");
    if (reqBody.contents && reqBody.contents.length > 0 &&
        reqBody.contents[0].parts && reqBody.contents[0].parts.length > 0) {
        context.setVariable("ai.original_prompt_text", String(reqBody.contents[0].parts[0].text || ""));
    }
} catch (e) {}

// Ensure X-Quota-Id has a default if not passed
var quotaId = context.getVariable("request.header.X-Quota-Id");
if (!quotaId) {
    context.setVariable("request.header.X-Quota-Id", "default-enterprise-consumer");
}
var quotaLimit = context.getVariable("request.header.X-Quota-Limit");
if (!quotaLimit) {
    context.setVariable("request.header.X-Quota-Limit", "500");
}
var promptLimit = context.getVariable("request.header.X-Prompt-Token-Limit");
if (!promptLimit) {
    context.setVariable("request.header.X-Prompt-Token-Limit", "250pm");
} else if (!/[0-9]+(pm|ps)$/i.test(String(promptLimit).trim())) {
    context.setVariable("request.header.X-Prompt-Token-Limit", String(promptLimit).trim() + "pm");
}
if (!context.getVariable("request.header.X-Model-Name")) {
    context.setVariable("request.header.X-Model-Name", "gemini-2.5-flash");
}
context.setVariable("sgpEnforcementMode", "ENFORCE");
