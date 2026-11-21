// Pure ES5 Apigee X Policy: Tab 7 — Translate Vertex AI Response -> Standard OpenAI Chat Completion JSON
(function () {
  var raw = context.getVariable("response.content") || "{}";
  var parsed = {};
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    parsed = {};
  }

  var startMs = parseInt(context.getVariable("ai.resilient_start_ms") || "0", 10);
  var elapsedMs = startMs > 0 ? Math.max(1, new Date().getTime() - startMs) : 0;

  var replyText = "";
  try {
    var parts = parsed.candidates[0].content.parts || [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].text && !parts[i].thought) {
        replyText += parts[i].text;
      }
    }
  } catch (e) {
    replyText = raw;
  }

  var usage = parsed.usageMetadata || {};
  var promptTok = Number(usage.promptTokenCount || 0);
  var candTok = Number(usage.candidatesTokenCount || 0);
  var totalTok = Number(usage.totalTokenCount || (promptTok + candTok));

  var requestedModel = context.getVariable("ai.resilient_requested_model") || "gpt-4o";
  var servedModel = context.getVariable("ai.resilient_served_model") || "gemini-2.5-flash";
  var servedRegion = context.getVariable("ai.resilient_served_region") || "australia-southeast1";
  var failoverTriggered = context.getVariable("ai.resilient_failover") === "true";
  var canarySelected = context.getVariable("ai.resilient_canary") === "true";
  var canaryPct = parseInt(context.getVariable("ai.resilient_canary_pct") || "0", 10);

  var openaiResp = {
    id: "chatcmpl-apigee-" + String(new Date().getTime()),
    object: "chat.completion",
    created: Math.floor(new Date().getTime() / 1000),
    model: servedModel,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: replyText },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: promptTok,
      completion_tokens: candTok,
      total_tokens: totalTok
    },
    apigee_resilience_telemetry: {
      enforced_by: "Apigee X Native Proxy (ai-gateway-v1)",
      openai_facade_translated: true,
      client_requested_model: requestedModel,
      served_model: servedModel,
      served_region: servedRegion,
      primary_target_status: context.getVariable("ai.resilient_primary_status") || "200 OK",
      failover_triggered: failoverTriggered,
      canary_selected: canarySelected,
      canary_weight_pct: canaryPct,
      route_decision: context.getVariable("ai.resilient_route") || "STABLE_FLASH_AU",
      gateway_latency_ms: elapsedMs
    }
  };

  context.setVariable("response.content", JSON.stringify(openaiResp));
  context.setVariable("response.header.Content-Type", "application/json");
  context.setVariable("response.header.X-Apigee-OpenAI-Facade", "true");
  context.setVariable("response.header.X-Apigee-Failover-Triggered", failoverTriggered ? "true" : "false");
  context.setVariable("response.header.X-Apigee-Served-Model", servedModel);
  context.setVariable("response.header.X-Apigee-Served-Region", servedRegion);
})();
