// Pure ES5 Apigee X Policy: Tab 8 — Reversible PII Tokenization Vault (Pre-LLM Masking)
// Detects sensitive PII inside Apigee X and replaces with deterministic tokens BEFORE Vertex AI sees the prompt.
(function () {
  var raw = context.getVariable("request.content") || "{}";
  var body = {};
  try {
    body = JSON.parse(raw);
  } catch (e) {
    body = {};
  }

  context.setVariable("ai.pii_start_ms", String(new Date().getTime()));
  var originalPrompt = String(body.prompt || "");
  var rehydrate = String(context.getVariable("request.header.X-Pii-Rehydrate") || "true").toLowerCase() !== "false";
  var enableVault = String(context.getVariable("request.header.X-Enable-Pii-Vault") || "true").toLowerCase() !== "false";

  var vaultMap = {};
  var entities = [];
  var maskedPrompt = originalPrompt;

  function maskPattern(regex, label) {
    var count = 0;
    maskedPrompt = maskedPrompt.replace(regex, function (match) {
      count += 1;
      var token = "<" + label + "_" + count + ">";
      vaultMap[token] = match;
      entities.push({ token: token, type: label, preview: match.substring(0, 3) + "***" });
      return token;
    });
  }

  if (enableVault) {
    // Credit Card / PAN (13-19 digits with spaces or dashes)
    maskPattern(/\b(?:\d[ -]*?){13,19}\b/g, "CARD");
    // Email addresses
    maskPattern(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "EMAIL");
    // SSN / TFN (XXX-XX-XXXX or XXX-XXX-XXX)
    maskPattern(/\b\d{3}-\d{2,3}-\d{3,4}\b/g, "GOV_ID");
    // Phone numbers (+61 / +1 / local 10-digit)
    maskPattern(/(?:\+?\d{1,3}[\s-]?)?\(?\d{3,4}\)?[\s-]?\d{3}[\s-]?\d{3,4}\b/g, "PHONE");
  }

  context.setVariable("ai.pii_vault_enabled", enableVault ? "true" : "false");
  context.setVariable("ai.pii_rehydrate", rehydrate ? "true" : "false");
  context.setVariable("ai.pii_vault_map_json", JSON.stringify(vaultMap));
  context.setVariable("ai.pii_entities_json", JSON.stringify(entities));
  context.setVariable("ai.pii_entities_count", String(entities.length));
  context.setVariable("ai.pii_sanitized_prompt", maskedPrompt);

  var sysInstr =
    "You are an enterprise banking/healthcare assistant. " +
    "The user prompt contains privacy placeholders like <EMAIL_1>, <CARD_1>, <GOV_ID_1>, <PHONE_1>. " +
    "Treat them as valid customer identifiers and preserve the exact placeholder tokens verbatim in your concise reply.";

  var vertexReq = {
    systemInstruction: { parts: [{ text: sysInstr }] },
    contents: [{ role: "user", parts: [{ text: maskedPrompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
  };

  context.setVariable("request.content", JSON.stringify(vertexReq));
  context.setVariable("request.header.Content-Type", "application/json");
})();
