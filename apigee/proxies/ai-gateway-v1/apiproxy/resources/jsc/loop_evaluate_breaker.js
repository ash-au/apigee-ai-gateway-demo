// Pure ES5 Apigee X Policy: Tab 2b — Agent Loop Circuit Breaker (Step 2: Evaluate Repetition & Escalation)
(function () {
  var prevStr = context.getVariable("ai.loop_cached_count");
  var prevCount = parseInt(prevStr || "0", 10);
  if (isNaN(prevCount) || prevCount < 0) prevCount = 0;

  var repeatCount = prevCount + 1;
  var maxRepeats = parseInt(context.getVariable("ai.loop_max_repeats") || "3", 10);
  var mode = context.getVariable("ai.loop_mode") || "enforce";

  var verdict = "ALLOW";
  var breakerState = "CLOSED";
  var wouldBlock = false;
  var tripped = false;

  if (repeatCount >= maxRepeats) {
    wouldBlock = true;
    if (mode === "observe") {
      verdict = "OBSERVE_WOULD_BLOCK";
      breakerState = "OBSERVE";
      tripped = false;
    } else {
      verdict = "TRIPPED";
      breakerState = "OPEN";
      tripped = true;
    }
  } else if (repeatCount === maxRepeats - 1) {
    verdict = "WARN";
    breakerState = "HALF_WARN";
  }

  context.setVariable("ai.loop_repeat_count", String(repeatCount));
  context.setVariable("ai.loop_verdict", verdict);
  context.setVariable("ai.loop_breaker_state", breakerState);
  context.setVariable("ai.loop_would_block", wouldBlock ? "true" : "false");
  context.setVariable("ai.loop_tripped", tripped ? "true" : "false");

  if (!tripped) {
    var promptText = context.getVariable("ai.loop_prompt") || "Proceed with step.";
    var vertexReq = {
      contents: [{ role: "user", parts: [{ text: "Respond in 1 concise sentence (under 15 words): " + promptText }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 64 }
    };
    context.setVariable("request.content", JSON.stringify(vertexReq));
    context.setVariable("request.header.Content-Type", "application/json");
  }
})();
