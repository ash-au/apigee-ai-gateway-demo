// Pure ES5 Apigee X Policy: Tab 6 — MCP Governance & SPIFFE Identity Response Enricher
(function () {
  var raw = context.getVariable("response.content") || "{}";
  var parsed = {};
  try { parsed = JSON.parse(raw); } catch (e) { parsed = { raw_response: raw }; }

  var startMs = parseInt(context.getVariable("ai.mcp_start_ms") || "0", 10);
  var elapsedMs = startMs > 0 ? Math.max(1, new Date().getTime() - startMs) : 0;
  var spiffeId = context.getVariable("ai.spiffe_id") || "";

  parsed.apigee_mcp_governance = {
    enforced_by: "Apigee X Native Proxy (ai-gateway-v1)",
    spiffe_identity: {
      verified: context.getVariable("ai.spiffe_verified") === "true",
      spiffe_id: spiffeId,
      trusted_domain: context.getVariable("ai.spiffe_trust_domain") || "apac-cs-5g-demo5.svc.id.goog"
    },
    jsonrpc_method: context.getVariable("ai.mcp_method") || "tools/call",
    tool_name: context.getVariable("ai.mcp_tool_name") || "",
    agent_role: context.getVariable("ai.mcp_agent_role") || "",
    rbac_verdict: "ALLOWED",
    allowed_tools_for_role: context.getVariable("ai.mcp_allowed_tools") || "",
    model_armor_indirect_scan: String(context.getVariable("request.header.X-Enable-Mcp-Armor") || "true") !== "false" ? "PASSED" : "DISABLED",
    simulated_poisoned_tool: context.getVariable("ai.mcp_simulate_poison") === "true",
    gateway_latency_ms: elapsedMs
  };

  context.setVariable("response.content", JSON.stringify(parsed));
  context.setVariable("response.header.Content-Type", "application/json");
  context.setVariable("response.header.X-Apigee-MCP-Verdict", "ALLOWED");
  context.setVariable("response.header.X-Apigee-MCP-Tool", parsed.apigee_mcp_governance.tool_name);
  context.setVariable("response.header.X-Apigee-Verified-SPIFFE-ID", spiffeId);
})();
