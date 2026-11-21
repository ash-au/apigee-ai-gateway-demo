// Pure ES5 Apigee X Policy: Tab 7 — Unified OpenAI Facade + 429 Failover + Canary Split
(function () {
  var raw = context.getVariable("request.content") || "{}";
  var body = {};
  try {
    body = JSON.parse(raw);
  } catch (e) {
    body = {};
  }

  var startMs = new Date().getTime();
  context.setVariable("ai.resilient_start_ms", String(startMs));

  var requestedModel = String(body.model || "gpt-4o");
  var simulate429 = String(context.getVariable("request.header.X-Simulate-429") || "false").toLowerCase() === "true";
  var canaryPct = parseInt(context.getVariable("request.header.X-Canary-Pct") || "0", 10);
  if (isNaN(canaryPct) || canaryPct < 0) canaryPct = 0;
  if (canaryPct > 100) canaryPct = 100;

  // Translate standard OpenAI messages[] -> Vertex AI Gemini contents[]
  var messages = body.messages || [];
  var contents = [];
  var systemParts = [];
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i] || {};
    var txt = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
    if (m.role === "system") {
      systemParts.push({ text: txt });
    } else {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: txt }]
      });
    }
  }
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: String(body.prompt || "Explain Apigee X multi-region failover in 2 sentences.") }] });
  }

  var vertexReq = {
    contents: contents,
    generationConfig: {
      temperature: typeof body.temperature === "number" ? body.temperature : 0.2,
      maxOutputTokens: typeof body.max_tokens === "number" ? body.max_tokens : 300
    }
  };
  if (systemParts.length > 0) {
    vertexReq.systemInstruction = { parts: systemParts };
  }

  // Determine routing decision: 429 Failover vs Canary Pro vs Stable Flash
  var routeDecision = "STABLE_FLASH_AU";
  var servedModel = "gemini-2.5-flash";
  var servedRegion = "australia-southeast1";
  var primaryStatus = "200 OK";
  var failoverTriggered = false;
  var canarySelected = false;

  if (simulate429) {
    // Primary us-central1 / global quota exhausted -> Apigee X fails over seamlessly to australia-southeast1 Flash
    failoverTriggered = true;
    primaryStatus = "429 RESOURCE_EXHAUSTED (us-central1)";
    routeDecision = "FAILOVER_FLASH_AU";
    servedModel = "gemini-2.5-flash";
    servedRegion = "australia-southeast1 (Failover)";
  } else if (canaryPct > 0 && Math.random() * 100 < canaryPct) {
    canarySelected = true;
    routeDecision = "CANARY_PRO_GLOBAL";
    servedModel = "gemini-2.5-pro";
    servedRegion = "global (Canary)";
  }

  context.setVariable("ai.resilient_requested_model", requestedModel);
  context.setVariable("ai.resilient_route", routeDecision);
  context.setVariable("ai.resilient_served_model", servedModel);
  context.setVariable("ai.resilient_served_region", servedRegion);
  context.setVariable("ai.resilient_primary_status", primaryStatus);
  context.setVariable("ai.resilient_failover", failoverTriggered ? "true" : "false");
  context.setVariable("ai.resilient_canary", canarySelected ? "true" : "false");
  context.setVariable("ai.resilient_canary_pct", String(canaryPct));
  context.setVariable("ai.resilient_vertex_req_preview", JSON.stringify(vertexReq));

  context.setVariable("request.content", JSON.stringify(vertexReq));
  context.setVariable("request.header.Content-Type", "application/json");
})();
