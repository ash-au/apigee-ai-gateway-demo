// Pure ES5 Apigee X Policy: Tab 6 — MCP Governance & RFC 8693 Identity Provenance Response Enricher
(function () {
  var raw = context.getVariable("response.content") || "{}";
  var parsed = {};
  try { parsed = JSON.parse(raw); } catch (e) { parsed = { raw_response: raw }; }

  var startMs = parseInt(context.getVariable("ai.mcp_start_ms") || "0", 10);
  var elapsedMs = startMs > 0 ? Math.max(1, new Date().getTime() - startMs) : 0;
  var spiffeId = context.getVariable("ai.spiffe_id") || "";
  var parentId = context.getVariable("ai.spiffe_parent_id") || "";
  var humanSub = context.getVariable("ai.human_sub") || "";

  parsed.apigee_mcp_governance = {
    enforced_by: "Apigee X Native Proxy (ai-gateway-v1)",
    identity_provenance: {
      standard: "OAuth 2.0 Token Exchange (RFC 8693) + SPIFFE",
      human_principal_sub: humanSub,
      human_scopes: context.getVariable("ai.user_scopes") || "",
      acting_agent_spiffe: spiffeId,
      delegating_orchestrator_spiffe: parentId,
      permission_intersection_rule: "Effective = User Permissions ∩ Agent Capabilities",
      user_allowed_tools: context.getVariable("ai.mcp_user_tools") || "",
      agent_allowed_tools: context.getVariable("ai.mcp_agent_tools") || "",
      effective_intersection_tools: context.getVariable("ai.mcp_allowed_tools") || ""
    },
    spiffe_identity: {
      verified: context.getVariable("ai.spiffe_verified") === "true",
      spiffe_id: spiffeId,
      trusted_domain: context.getVariable("ai.spiffe_trust_domain") || "apac-cs-5g-demo5.svc.id.goog"
    },
    jsonrpc_method: context.getVariable("ai.mcp_method") || "tools/call",
    tool_name: context.getVariable("ai.mcp_tool_name") || "",
    agent_role: context.getVariable("ai.mcp_agent_role") || "",
    rbac_verdict: "ALLOWED",
    model_armor_indirect_scan: String(context.getVariable("request.header.X-Enable-Mcp-Armor") || "true") !== "false" ? "PASSED" : "DISABLED",
    gateway_latency_ms: elapsedMs
  };

  context.setVariable("response.content", JSON.stringify(parsed));
  context.setVariable("response.header.Content-Type", "application/json");
  context.setVariable("response.header.X-Apigee-MCP-Verdict", "ALLOWED");
  context.setVariable("response.header.X-Apigee-Verified-SPIFFE-ID", spiffeId);
  context.setVariable("response.header.X-Apigee-Human-Principal", humanSub);
})();
