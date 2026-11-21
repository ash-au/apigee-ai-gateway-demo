// Pure ES5 Apigee X Policy: Tab 2b — Agent Loop Circuit Breaker (Step 1: Compute Session + Intent Hash Key)
(function () {
  var raw = context.getVariable("request.content") || "{}";
  var body = {};
  try { body = JSON.parse(raw); } catch (e) { body = {}; }

  var sessionId = String(body.session_id || "sess-default").replace(/[^A-Za-z0-9_-]/g, "");
  var spiffeId = String(body.spiffe_id || "spiffe://apac-cs-5g-demo5.svc.id.goog/ns/support/sa/tier1-support-agent");
  var promptText = String(body.prompt || "retry_billing_query");
  var toolName = String(body.tool_name || "agent_step");
  var mode = String(context.getVariable("request.header.X-Loop-Mode") || "enforce").toLowerCase();
  var maxRepeats = parseInt(context.getVariable("request.header.X-Loop-Max-Repeats") || "3", 10);
  if (isNaN(maxRepeats) || maxRepeats < 2) maxRepeats = 3;

  // Normalize prompt + tool into a deterministic djb2 signature hash (detects repeated intent, ignores whitespace/case)
  var normalized = (toolName + "|" + promptText).toLowerCase().replace(/\s+/g, " ").trim();
  var hash = 5381;
  for (var i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    hash = hash & 0x7fffffff;
  }
  var sigHash = hash.toString(16);

  context.setVariable("ai.loop_start_ms", String(new Date().getTime()));
  context.setVariable("ai.loop_session_id", sessionId);
  context.setVariable("ai.loop_spiffe_id", spiffeId);
  context.setVariable("ai.loop_tool_name", toolName);
  context.setVariable("ai.loop_prompt", promptText);
  context.setVariable("ai.loop_sig_hash", sigHash);
  context.setVariable("ai.loop_cache_key", "loop_" + sessionId + "_" + sigHash);
  context.setVariable("ai.loop_mode", mode === "observe" ? "observe" : "enforce");
  context.setVariable("ai.loop_max_repeats", String(maxRepeats));
  context.setVariable("ai.loop_tripped", "false");
})();
