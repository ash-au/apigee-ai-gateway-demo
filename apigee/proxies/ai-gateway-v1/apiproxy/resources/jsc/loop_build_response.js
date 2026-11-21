// Pure ES5 Apigee X Policy: Tab 2b — Agent Loop Circuit Breaker Response Enricher
(function () {
  var raw = context.getVariable("response.content") || "{}";
  var parsed = {};
  try { parsed = JSON.parse(raw); } catch (e) { parsed = {}; }

  var startMs = parseInt(context.getVariable("ai.loop_start_ms") || "0", 10);
  var elapsedMs = startMs > 0 ? Math.max(1, new Date().getTime() - startMs) : 0;

  var replyText = "";
  try {
    var parts = parsed.candidates[0].content.parts || [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].text && !parts[i].thought) replyText += parts[i].text;
    }
  } catch (e) {
    replyText = "";
  }

  var verdict = context.getVariable("ai.loop_verdict") || "ALLOW";
  var breakerState = context.getVariable("ai.loop_breaker_state") || "CLOSED";
  var wouldBlock = context.getVariable("ai.loop_would_block") === "true";
  var repeatCount = parseInt(context.getVariable("ai.loop_repeat_count") || "1", 10);
  var maxRepeats = parseInt(context.getVariable("ai.loop_max_repeats") || "3", 10);

  var out = {
    response_text: replyText,
    usageMetadata: parsed.usageMetadata || {},
    apigee_loop_breaker: {
      enforced_by: "Apigee X Native Cache + Circuit Breaker (ai-gateway-v1)",
      session_id: context.getVariable("ai.loop_session_id") || "",
      spiffe_id: context.getVariable("ai.loop_spiffe_id") || "",
      tool_name: context.getVariable("ai.loop_tool_name") || "",
      signature_hash: context.getVariable("ai.loop_sig_hash") || "",
      repeat_count: repeatCount,
      max_repeats: maxRepeats,
      mode: context.getVariable("ai.loop_mode") || "enforce",
      verdict: verdict,
      breaker_state: breakerState,
      would_block: wouldBlock,
      gateway_latency_ms: elapsedMs
    }
  };

  context.setVariable("response.content", JSON.stringify(out));
  context.setVariable("response.header.Content-Type", "application/json");
  context.setVariable("response.header.X-Apigee-Breaker-State", breakerState);
  if (verdict === "WARN") {
    context.setVariable("response.header.X-Apigee-Loop-Warning", "DUPLICATE_TURN_" + repeatCount);
  }
  if (wouldBlock) {
    context.setVariable("response.header.X-Apigee-Would-Block", "true");
  }
})();
