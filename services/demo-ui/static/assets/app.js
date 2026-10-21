/* ==========================================================================
   Apigee X as an AI Gateway — Frontend Controller (app.js)
   All telemetry comes from live Vertex AI usageMetadata and Apigee X headers.
   ========================================================================== */

(function () {
  "use strict";

  const API_PREFIX = window.location.pathname.startsWith("/v1/ai-economics")
    ? "/v1/ai-economics"
    : "";

  const state = {
    scenarios: [],
    activeScenario: null,
    sessionLedger: {
      runs: 0,
      directTokens: 0,
      gatewayTokens: 0,
      directCostUsd: 0.0,
      gatewayCostUsd: 0.0,
    },
    isRunning: false,
    policiesCatalog: [],
    policyScenarios: {},
    tab4Submode: "semantic-governance", // "semantic-governance" | "native-cache"
  };

  // DOM Elements (Tab 1)
  const elScenarioList = document.getElementById("scenario-list");
  const elActiveScenarioMeta = document.getElementById("active-scenario-meta");
  const elPresenterNote = document.getElementById("presenter-note");
  const elInputSystem = document.getElementById("input-system");
  const elInputHistory = document.getElementById("input-history");
  const elInputRag = document.getElementById("input-rag");
  const elInputPrompt = document.getElementById("input-prompt");
  const elMetaHistoryTurns = document.getElementById("meta-history-turns");
  const elMetaRagLen = document.getElementById("meta-rag-len");

  const elToggleCache = document.getElementById("toggle-cache");
  const elToggleCompress = document.getElementById("toggle-compress");
  const elToggleRoute = document.getElementById("toggle-route");
  const elTogglePrune = document.getElementById("toggle-prune");

  const elBtnExecute = document.getElementById("btn-execute-compare");
  const elBtnRunSequence = document.getElementById("btn-run-sequence");
  const elBtnReset = document.getElementById("btn-reset-state");
  const elRunStatus = document.getElementById("run-status-indicator");
  const elScaleSlider = document.getElementById("scale-slider");

  // Format helpers
  function fmtInt(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function fmtUsd(val, decimals = 6) {
    const num = Number(val || 0);
    if (num === 0) return "$0.000000";
    if (Math.abs(num) < 0.000001) return "$" + num.toFixed(8);
    return "$" + num.toFixed(decimals);
  }

  function fmtCurrencyLarge(val) {
    const num = Number(val || 0);
    return "$" + Math.round(num).toLocaleString("en-US");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Primary Multi-Tab Navigation
  document.querySelectorAll(".primary-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".primary-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.dataset.maintab;
      [
        "main-tab-economics",
        "main-tab-token-finops",
        "main-tab-model-armor",
        "main-tab-semantic-gov",
        "main-tab-system1-jev",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === targetId ? "block" : "none";
      });
      if (targetId === "main-tab-semantic-gov") {
        refreshVectorSearchStatus();
      }
    });
  });

  // Sync toggle cards & header tags (Tab 1)
  function syncToggleUI() {
    const map = [
      { input: elToggleCache, cardId: "card-toggle-cache", header: "X-Opt-Cache" },
      { input: elToggleCompress, cardId: "card-toggle-compress", header: "X-Opt-Compress" },
      { input: elToggleRoute, cardId: "card-toggle-route", header: "X-Opt-Route" },
      { input: elTogglePrune, cardId: "card-toggle-prune", header: "X-Opt-Prune" },
    ];
    map.forEach((item) => {
      const card = document.getElementById(item.cardId);
      const tag = card.querySelector(".toggle-header-tag");
      const on = item.input.checked;
      card.classList.toggle("enabled", on);
      tag.textContent = `${item.header}: ${on ? "true" : "false"}`;
    });
  }

  // Update Cumulative Session Ledger & Enterprise Scale Projection
  function updateSessionLedgerUI() {
    const L = state.sessionLedger;
    document.getElementById("ledger-direct-cost").textContent = fmtUsd(L.directCostUsd, 6);
    document.getElementById("ledger-direct-tokens").textContent =
      `${fmtInt(L.directTokens)} tokens across ${L.runs} run${L.runs === 1 ? "" : "s"}`;

    document.getElementById("ledger-gateway-cost").textContent = fmtUsd(L.gatewayCostUsd, 6);
    document.getElementById("ledger-gateway-tokens").textContent =
      `${fmtInt(L.gatewayTokens)} billed tokens (incl. overhead)`;

    const tokSaved = L.directTokens - L.gatewayTokens;
    const tokPct = L.directTokens > 0 ? ((tokSaved / L.directTokens) * 100).toFixed(1) : null;
    document.getElementById("ledger-token-pct").textContent =
      tokPct !== null ? `${tokSaved >= 0 ? "-" : "+"}${Math.abs(tokPct)}%` : "—";
    document.getElementById("ledger-tokens-saved").textContent =
      `${fmtInt(tokSaved)} net tokens saved`;

    const costSaved = L.directCostUsd - L.gatewayCostUsd;
    const costPct = L.directCostUsd > 0 ? ((costSaved / L.directCostUsd) * 100).toFixed(1) : null;
    document.getElementById("ledger-cost-pct").textContent =
      costPct !== null ? `${costSaved >= 0 ? "-" : "+"}${Math.abs(costPct)}%` : "—";
    document.getElementById("ledger-cost-saved").textContent =
      `${fmtUsd(costSaved, 6)} net saved`;

    updateAnnualProjectionUI();
  }

  function updateAnnualProjectionUI() {
    const millionsPerMonth = Number(elScaleSlider.value || 10);
    document.getElementById("scale-slider-label").textContent =
      `At ${millionsPerMonth}M requests/month (${millionsPerMonth * 12}M/yr)`;

    const L = state.sessionLedger;
    if (L.runs === 0) {
      document.getElementById("ledger-annual-savings").textContent = "$0 / yr";
      return;
    }
    const avgSavedPerReq = (L.directCostUsd - L.gatewayCostUsd) / L.runs;
    const annualSaved = avgSavedPerReq * (millionsPerMonth * 1_000_000) * 12;
    document.getElementById("ledger-annual-savings").textContent =
      `${fmtCurrencyLarge(annualSaved)} / yr`;
  }

  // Select a preset scenario (Tab 1)
  function selectScenario(scen) {
    state.activeScenario = scen;
    document.querySelectorAll("#scenario-list .scenario-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === scen.id);
    });

    elActiveScenarioMeta.textContent = `${scen.title} • Session: ${scen.session_id}`;
    elPresenterNote.innerHTML = `<strong>Presenter Note (${escapeHtml(scen.optimization_focus)}):</strong> ${escapeHtml(scen.presenter_note)}`;

    elInputSystem.value = scen.system_instruction || "";
    elInputRag.value = scen.rag_context || "";
    elInputHistory.value = JSON.stringify(scen.conversation_history || [], null, 2);
    elInputPrompt.value = scen.user_prompt || "";

    const turns = (scen.conversation_history || []).length;
    elMetaHistoryTurns.textContent = `${turns} prior turn${turns === 1 ? "" : "s"}`;
    elMetaRagLen.textContent = scen.rag_context ? `${scen.rag_context.length} chars` : "None";

    elToggleCache.checked = Boolean(scen.recommended_toggles.semantic_cache);
    elToggleCompress.checked = Boolean(scen.recommended_toggles.prompt_compression);
    elToggleRoute.checked = Boolean(scen.recommended_toggles.model_routing);
    elTogglePrune.checked = Boolean(scen.recommended_toggles.context_pruning);
    syncToggleUI();
  }

  function renderScenarioList() {
    elScenarioList.innerHTML = "";
    state.scenarios.forEach((scen) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scenario-item";
      btn.dataset.id = scen.id;
      btn.innerHTML = `
        <div>
          <div class="scenario-item-title">${escapeHtml(scen.title)}</div>
          <div class="scenario-item-sub">${escapeHtml(scen.subtitle)}</div>
        </div>
        <span class="scenario-badge">${escapeHtml(scen.optimization_focus)}</span>
      `;
      btn.addEventListener("click", () => selectScenario(scen));
      elScenarioList.appendChild(btn);
    });
    if (state.scenarios.length > 0) {
      selectScenario(state.scenarios[0]);
    }
  }

  // Execute Side-by-Side Comparison (Tab 1)
  async function executeComparison() {
    if (state.isRunning) return;
    state.isRunning = true;
    elBtnExecute.disabled = true;
    elBtnRunSequence.disabled = true;
    elRunStatus.textContent = "Calling Vertex AI Gemini 2.5 Pro + Apigee X Gateway in parallel...";

    let parsedHistory = [];
    try {
      parsedHistory = JSON.parse(elInputHistory.value || "[]");
      if (!Array.isArray(parsedHistory)) parsedHistory = [];
    } catch (e) {
      parsedHistory = [];
    }

    const scen = state.activeScenario || {};
    const payload = {
      session_id: scen.session_id || "custom-session",
      scenario_id: scen.scenario_id || "custom-scenario",
      system_instruction: elInputSystem.value,
      rag_context: elInputRag.value,
      few_shot_examples: scen.few_shot_examples || [],
      conversation_history: parsedHistory,
      user_prompt: elInputPrompt.value,
      toggles: {
        semantic_cache: elToggleCache.checked,
        prompt_compression: elToggleCompress.checked,
        model_routing: elToggleRoute.checked,
        context_pruning: elTogglePrune.checked,
      },
      compression_target_ratio: scen.compression_target_ratio || 0.38,
      similarity_threshold: scen.similarity_threshold || 0.85,
    };

    try {
      const resp = await fetch(`${API_PREFIX}/api/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }
      const data = await resp.json();
      renderComparisonResult(data);

      state.sessionLedger.runs += 1;
      state.sessionLedger.directTokens += data.comparison.direct_total_tokens;
      state.sessionLedger.gatewayTokens += data.comparison.gateway_grand_total_tokens;
      state.sessionLedger.directCostUsd += data.comparison.direct_cost_usd;
      state.sessionLedger.gatewayCostUsd += data.comparison.gateway_cost_usd;
      updateSessionLedgerUI();

      elRunStatus.textContent = `Completed at ${data.timestamp_utc}`;
    } catch (err) {
      elRunStatus.textContent = `Error: ${err.message}`;
    } finally {
      state.isRunning = false;
      elBtnExecute.disabled = false;
      elBtnRunSequence.disabled = false;
    }
  }

  function renderComparisonResult(data) {
    const direct = data.direct_baseline;
    const gw = data.apigee_gateway;
    const cmp = data.comparison;

    document.getElementById("direct-model-pill").textContent = direct.model_used;
    document.getElementById("direct-total-tokens").textContent = fmtInt(
      direct.token_accounting.grand_total_billed_tokens
    );
    document.getElementById("direct-total-cost").textContent = fmtUsd(
      direct.cost_accounting.total_cost_usd,
      6
    );
    document.getElementById("direct-thinking-tokens").textContent = fmtInt(
      direct.token_accounting.thinking_tokens
    );
    document.getElementById("direct-latency").textContent = `${fmtInt(direct.latency_ms)} ms`;
    document.getElementById("direct-finish-reason").textContent = `finishReason: ${direct.finish_reason}`;

    document.getElementById("direct-prompt-tok").textContent = fmtInt(
      direct.token_accounting.prompt_tokens
    );
    document.getElementById("direct-cand-tok").textContent = fmtInt(
      direct.token_accounting.candidate_tokens
    );
    document.getElementById("direct-thought-tok").textContent = fmtInt(
      direct.token_accounting.thinking_tokens
    );
    document.getElementById("direct-response-body").textContent = direct.response_text;

    document.getElementById("gateway-model-pill").textContent = gw.model_used;
    document.getElementById("gateway-total-tokens").textContent = fmtInt(
      gw.token_accounting.grand_total_billed_tokens
    );

    const tokSign = cmp.tokens_saved >= 0 ? "-" : "+";
    document.getElementById("gateway-token-delta").textContent =
      `${tokSign}${Math.abs(cmp.token_reduction_pct)}% (${fmtInt(cmp.tokens_saved)} saved)`;

    document.getElementById("gateway-total-cost").textContent = fmtUsd(
      gw.cost_accounting.total_cost_usd,
      6
    );
    const costSign = cmp.cost_saved_usd >= 0 ? "-" : "+";
    document.getElementById("gateway-cost-delta").textContent =
      `${costSign}${Math.abs(cmp.cost_reduction_pct)}% (${fmtUsd(cmp.cost_saved_usd, 6)} saved)`;

    const overheadTok =
      Number(gw.token_accounting.embedding_overhead_tokens || 0) +
      Number(gw.token_accounting.pruning_summarizer_overhead_tokens || 0);
    const overheadCost =
      Number(gw.cost_accounting.embedding_lookup_cost_usd || 0) +
      Number(gw.cost_accounting.pruning_summarizer_cost_usd || 0);
    document.getElementById("gateway-overhead-tokens").textContent = `${fmtInt(overheadTok)} tok`;
    document.getElementById("gateway-overhead-cost").textContent = `Overhead: ${fmtUsd(overheadCost, 7)}`;

    document.getElementById("gateway-latency").textContent = `${fmtInt(gw.latency_ms)} ms`;
    const cacheOpt = gw.optimizations.semantic_cache;
    document.getElementById("gateway-cache-badge").textContent = cacheOpt.hit
      ? `CACHE HIT (sim=${cacheOpt.similarity_score})`
      : cacheOpt.enabled
      ? "CACHE MISS (indexed)"
      : "Cache Bypassed";

    document.getElementById("gw-prompt-tok").textContent = fmtInt(gw.token_accounting.prompt_tokens);
    document.getElementById("gw-cand-tok").textContent = fmtInt(gw.token_accounting.candidate_tokens);
    document.getElementById("gw-thought-tok").textContent = fmtInt(gw.token_accounting.thinking_tokens);
    document.getElementById("gw-embed-tok").textContent = fmtInt(
      gw.token_accounting.embedding_overhead_tokens
    );
    document.getElementById("gw-prune-tok").textContent = fmtInt(
      gw.token_accounting.pruning_summarizer_overhead_tokens
    );
    document.getElementById("gateway-response-body").textContent = gw.response_text;

    const comp = gw.optimizations.prompt_compression;
    document.getElementById("comp-method-label").textContent = comp.method || "NONE";
    const compDropPct =
      comp.tokens_before > 0
        ? (((comp.tokens_before - comp.tokens_after) / comp.tokens_before) * 100).toFixed(1)
        : "0.0";
    document.getElementById("comp-stats-summary").innerHTML =
      `Tokens Before: <strong>${fmtInt(comp.tokens_before)}</strong> | ` +
      `Tokens After: <strong>${fmtInt(comp.tokens_after)}</strong> | ` +
      `Prompt Reduction: <span class="savings-number">-${compDropPct}% (${comp.compression_ratio}x)</span>`;

    document.getElementById("comp-before-count").textContent = `${fmtInt(comp.tokens_before)} tokens`;
    document.getElementById("comp-after-count").textContent =
      `${fmtInt(comp.tokens_after)} tokens (-${compDropPct}%)`;
    document.getElementById("comp-original-box").textContent =
      comp.original_prompt || "(Short-circuited by Semantic Cache before compression)";
    document.getElementById("comp-compressed-box").textContent =
      comp.compressed_prompt || "(Short-circuited by Semantic Cache before compression)";

    const rc = gw.optimizations.model_routing_cascade;
    const sigs = rc.reliability_signals || {};
    document.getElementById("cascade-audit-body").innerHTML = `
      <table class="editorial-table">
        <thead>
          <tr>
            <th>Stage</th>
            <th>Decision / Metric</th>
            <th>Details &amp; Signals</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Pre-Inference Complexity Router</strong></td>
            <td><code>${escapeHtml(rc.initial_decision)}</code> &rarr; <code>${escapeHtml(rc.initial_target_model)}</code></td>
            <td>
              Complexity Score: <code>${rc.complexity_score}</code> &bull;
              ${escapeHtml(rc.routing_reason)}<br/>
              Signals: <code>${escapeHtml((rc.complexity_signals || []).join(", "))}</code>
            </td>
          </tr>
          <tr>
            <td><strong>Stage L<sub>1</sub> Execution</strong></td>
            <td>Model: <code>${escapeHtml((rc.l1_usage || {}).model || "none")}</code></td>
            <td>
              Prompt: <code>${fmtInt((rc.l1_usage || {}).prompt_tokens)}</code> &bull;
              Candidate: <code>${fmtInt((rc.l1_usage || {}).candidate_tokens)}</code> &bull;
              Thinking: <code>${fmtInt((rc.l1_usage || {}).thinking_tokens)}</code> &bull;
              Cost: <code>${fmtUsd((rc.l1_usage || {}).cost_usd, 7)}</code> &bull;
              Latency: <code>${fmtInt(rc.l1_latency_ms)} ms</code>
            </td>
          </tr>
          <tr>
            <td><strong>Post-Generation Scorer <em>g(q, a)</em></strong></td>
            <td>
              Score: <code>${rc.reliability_score}</code> vs Threshold <code>${rc.reliability_threshold}</code><br/>
              Escalated to Pro: <strong>${rc.escalated_to_pro ? "YES (Cascaded to L2)" : "NO (L1 Accepted)"}</strong>
            </td>
            <td>
              avgLogprobs: <code>${sigs.avg_logprobs !== undefined ? sigs.avg_logprobs : "N/A"}</code> &bull;
              finishReason: <code>${escapeHtml(sigs.finish_reason || "N/A")}</code> &bull;
              Uncertainty Markers: <code>${escapeHtml((sigs.detected_uncertainty_markers || []).join(", ") || "none")}</code>
              ${rc.escalation_reason ? `<br/><strong>Escalation Reason:</strong> ${escapeHtml(rc.escalation_reason)}` : ""}
            </td>
          </tr>
          ${
            rc.l2_usage
              ? `<tr>
                  <td><strong>Stage L<sub>2</sub> Escalation (Gemini 2.5 Pro)</strong></td>
                  <td>Model: <code>${escapeHtml(rc.l2_usage.model)}</code></td>
                  <td>
                    Prompt: <code>${fmtInt(rc.l2_usage.prompt_tokens)}</code> &bull;
                    Candidate: <code>${fmtInt(rc.l2_usage.candidate_tokens)}</code> &bull;
                    Thinking: <code>${fmtInt(rc.l2_usage.thinking_tokens)}</code> &bull;
                    L<sub>2</sub> Cost: <code>${fmtUsd(rc.l2_usage.cost_usd, 7)}</code> &bull;
                    L<sub>2</sub> Latency: <code>${fmtInt(rc.l2_latency_ms)} ms</code><br/>
                    <em>Note: Both L<sub>1</sub> and L<sub>2</sub> calls are billed in Grand Total Tokens &amp; Cost.</em>
                  </td>
                </tr>`
              : ""
          }
        </tbody>
      </table>
    `;

    const sc = gw.optimizations.semantic_cache;
    const cp = gw.optimizations.context_pruning;
    document.getElementById("cache-prune-audit-body").innerHTML = `
      <table class="editorial-table">
        <thead>
          <tr>
            <th>Optimization Layer</th>
            <th>Status</th>
            <th>Live Telemetry &amp; Artifacts</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>1. FrugalGPT Semantic Completion Cache</strong><br/>(<code>text-embedding-005</code> in Sydney)</td>
            <td>
              Enabled: <code>${sc.enabled}</code><br/>
              Cache Hit: <strong>${sc.hit ? "HIT (Short-Circuited)" : "MISS"}</strong>
            </td>
            <td>
              Cosine Similarity: <code>${sc.similarity_score !== null ? sc.similarity_score : "N/A (No prior match)"}</code> (Threshold &ge; <code>0.85</code>)<br/>
              Matched Cached Query: <code>${escapeHtml(sc.matched_query || "—")}</code><br/>
              Embedding Tokens Billed: <code>${fmtInt(sc.embedding_tokens)}</code> (${fmtUsd(gw.cost_accounting.embedding_lookup_cost_usd, 8)}) &bull;
              Lookup Latency: <code>${sc.latency_ms} ms</code>
            </td>
          </tr>
          <tr>
            <td><strong>4. Multi-Turn Context Pruning &amp; Dedup</strong><br/>(Rolling state distillation via Flash)</td>
            <td>
              Enabled: <code>${cp.enabled}</code><br/>
              Applied: <strong>${cp.applied ? "YES" : "NO"}</strong>
            </td>
            <td>
              Turns: <code>${cp.turns_before} &rarr; ${cp.turns_after}</code> &bull;
              History Tokens: <code>${fmtInt(cp.tokens_before)} &rarr; ${fmtInt(cp.tokens_after)}</code> &bull;
              Summarizer Overhead: <code>${fmtInt(cp.summarizer_overhead_tokens)} tokens</code> (${fmtUsd(gw.cost_accounting.pruning_summarizer_cost_usd, 7)})<br/>
              ${
                cp.summary_generated
                  ? `<div style="margin-top:8px;"><strong>Generated Rolling State Summary:</strong><div class="code-block" style="margin-top:4px;max-height:140px;">${escapeHtml(cp.summary_generated)}</div></div>`
                  : "<em>No multi-turn summarization required for this turn count.</em>"
              }
            </td>
          </tr>
        </tbody>
      </table>
    `;

    const headerLines = [
      `POST ${gw.apigee_proxy_url || "/v1/ai-economics/chat"}`,
      "--- Request Headers Sent to Apigee X ---",
      ...Object.entries(gw.request_headers_sent || {}).map(([k, v]) => `${k}: ${v}`),
      "",
      "--- Response Headers Returned by Apigee X ---",
      ...Object.entries(gw.response_headers_received || {}).map(([k, v]) => `${k}: ${v}`),
    ];
    document.getElementById("raw-headers-box").textContent = headerLines.join("\n");
    document.getElementById("raw-json-box").textContent = JSON.stringify(data, null, 2);
  }

  async function runAllScenariosSequentially() {
    if (state.isRunning) return;
    for (let i = 0; i < state.scenarios.length; i++) {
      selectScenario(state.scenarios[i]);
      await executeComparison();
    }
  }

  async function resetGatewayState() {
    elBtnReset.disabled = true;
    elRunStatus.textContent = "Resetting Apigee X semantic cache & session summaries...";
    try {
      await fetch(`${API_PREFIX}/api/reset`, { method: "POST" });
      state.sessionLedger = {
        runs: 0,
        directTokens: 0,
        gatewayTokens: 0,
        directCostUsd: 0.0,
        gatewayCostUsd: 0.0,
      };
      updateSessionLedgerUI();
      elRunStatus.textContent = "Gateway semantic cache & session ledger reset.";
    } catch (err) {
      elRunStatus.textContent = `Reset error: ${err.message}`;
    } finally {
      elBtnReset.disabled = false;
    }
  }

  // ===========================================================================
  // TABS 2, 3, 4: NATIVE APIGEE X AI POLICIES & VECTOR SEARCH CONTROL
  // ===========================================================================
  function getPolicyXmlByIds(ids) {
    return state.policiesCatalog
      .filter((p) => ids.includes(p.id))
      .map((p) => `<!-- ${p.policy_name} (${p.flow}) -->\n${p.xml}`)
      .join("\n\n");
  }

  function renderPolicyTabs() {
    // Tab 2: Token Governance
    const tgList = document.getElementById("tg-scenario-list");
    const tgScens = state.policyScenarios["token-governance"] || [];
    tgList.innerHTML = "";
    tgScens.forEach((scen, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scenario-item" + (idx === 0 ? " active" : "");
      btn.innerHTML = `
        <div>
          <div class="scenario-item-title">${escapeHtml(scen.title)}</div>
          <div class="scenario-item-sub">${escapeHtml(scen.description)}</div>
        </div>
        <span class="scenario-badge">${escapeHtml(scen.badge)}</span>
      `;
      btn.addEventListener("click", () => {
        tgList.querySelectorAll(".scenario-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("tg-prompt").value = scen.prompt;
        document.getElementById("tg-prompt-limit").value = scen.prompt_token_limit;
        document.getElementById("tg-quota-limit").value = scen.quota_limit;
        document.getElementById("tg-quota-id").value = scen.quota_id;
      });
      tgList.appendChild(btn);
    });
    if (tgScens.length > 0) {
      document.getElementById("tg-prompt").value = tgScens[0].prompt;
      document.getElementById("tg-prompt-limit").value = tgScens[0].prompt_token_limit;
      document.getElementById("tg-quota-limit").value = tgScens[0].quota_limit;
      document.getElementById("tg-quota-id").value = tgScens[0].quota_id;
    }
    document.getElementById("tg-xml-box").textContent = getPolicyXmlByIds([
      "PromptTokenLimit",
      "LLMTokenQuota",
    ]);

    // Tab 3: Model Armor
    const maList = document.getElementById("ma-scenario-list");
    const maScens = state.policyScenarios["model-armor"] || [];
    maList.innerHTML = "";
    maScens.forEach((scen, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scenario-item" + (idx === 0 ? " active" : "");
      btn.innerHTML = `
        <div>
          <div class="scenario-item-title">${escapeHtml(scen.title)}</div>
          <div class="scenario-item-sub">${escapeHtml(scen.description)}</div>
        </div>
        <span class="scenario-badge">${escapeHtml(scen.badge)}</span>
      `;
      btn.addEventListener("click", () => {
        maList.querySelectorAll(".scenario-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("ma-prompt").value = scen.prompt;
        document.getElementById("ma-enable-prompt").checked = scen.enable_sanitize_prompt;
        document.getElementById("ma-enable-response").checked = scen.enable_sanitize_response;
      });
      maList.appendChild(btn);
    });
    if (maScens.length > 0) {
      document.getElementById("ma-prompt").value = maScens[0].prompt;
    }
    document.getElementById("ma-xml-box").textContent = getPolicyXmlByIds([
      "SanitizeUserPrompt",
      "SanitizeModelResponse",
    ]);

    // Tab 4: Semantic Governance & Native Cache
    renderTab4Submode();
  }

  function renderTab4Submode() {
    const mode = state.tab4Submode;
    const btnSg = document.getElementById("btn-submode-sg");
    const btnNc = document.getElementById("btn-submode-nc");
    btnSg.className = mode === "semantic-governance" ? "btn btn-primary" : "btn btn-outline";
    btnNc.className = mode === "native-cache" ? "btn btn-primary" : "btn btn-outline";

    const sgList = document.getElementById("sg-scenario-list");
    const scens = state.policyScenarios[mode] || [];
    sgList.innerHTML = "";
    scens.forEach((scen, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scenario-item" + (idx === 0 ? " active" : "");
      btn.innerHTML = `
        <div>
          <div class="scenario-item-title">${escapeHtml(scen.title)}</div>
          <div class="scenario-item-sub">${escapeHtml(scen.description)}</div>
        </div>
        <span class="scenario-badge">${escapeHtml(scen.badge)}</span>
      `;
      btn.addEventListener("click", () => {
        sgList.querySelectorAll(".scenario-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("sg-prompt").value = scen.prompt;
      });
      sgList.appendChild(btn);
    });
    if (scens.length > 0) {
      document.getElementById("sg-prompt").value = scens[0].prompt;
    }

    if (mode === "semantic-governance") {
      document.getElementById("sg-composer-title").innerHTML =
        'Test Prompt &amp; Live Apigee Execution (<code>/v1/ai-economics/policies/semantic-governance</code>)';
      document.getElementById("sg-flow-footer").innerHTML =
        'Apigee Flow: <strong>Policy-Semantic-Governance (Vertex Flash &rarr; SG-EnforceEnterpriseDomain)</strong>';
      document.getElementById("sg-gw-heading").textContent = "Via Apigee X Semantic Governance";
      document.getElementById("sg-xml-box").textContent = getPolicyXmlByIds(["SemanticGovernance"]);
      document.getElementById("sg-policy-explanation").innerHTML = `
        <p style="margin-top: 0;">
          <strong><code>SG-EnforceEnterpriseDomain</code> (<code>&lt;SemanticGovernance&gt;</code>):</strong>
          Uses Vertex AI Gemini (<code>gemini-2.5-flash</code>) natively inside the Apigee Response Flow to verify that model completions strictly adhere to declarative domain rules:
        </p>
        <div class="code-block" style="max-height: 140px;">Rule id="enterprise-domain-guardrail":
"The response must only provide enterprise cloud architecture, cybersecurity, FinOps, software engineering, or API management guidance. It must NOT provide personal stock trading recommendations, cryptocurrency speculation, medical diagnoses, creative fiction/poetry, or competitor disparagement."</div>
      `;
    } else {
      document.getElementById("sg-composer-title").innerHTML =
        'Test Prompt &amp; Live Apigee Execution (<code>/v1/ai-economics/policies/native-cache</code>)';
      document.getElementById("sg-flow-footer").innerHTML =
        'Apigee Flow: <strong>Policy-Native-Semantic-Cache (SCL-NativeSemanticCacheLookup &rarr; Vertex Flash &rarr; SCP-NativeSemanticCachePopulate)</strong>';
      document.getElementById("sg-gw-heading").textContent = "Via Apigee X Native Semantic Cache";
      document.getElementById("sg-xml-box").textContent = getPolicyXmlByIds([
        "SemanticCacheLookup",
        "SemanticCachePopulate",
      ]);
      document.getElementById("sg-policy-explanation").innerHTML = `
        <p style="margin-top: 0;">
          <strong><code>SCL-NativeSemanticCacheLookup</code> &amp; <code>SCP-NativeSemanticCachePopulate</code>:</strong>
          Zero-code native Apigee X XML policies backed by <code>text-embedding-005</code> and Vertex AI Vector Search (<code>SHARD_SIZE_MEDIUM</code> / <code>e2-standard-16</code>).
        </p>
        <div class="code-block" style="max-height: 140px;">Index: projects/1019413155504/locations/australia-southeast1/indexes/8419013310438965248
IndexEndpoint: projects/1019413155504/locations/australia-southeast1/indexEndpoints/3216599276826132480
Public Domain: 958897680.australia-southeast1-1019413155504.vdb.vertexai.goog</div>
      `;
    }
  }

  // Execute Tab 2: Token Governance
  document.getElementById("btn-run-tg").addEventListener("click", async () => {
    const btn = document.getElementById("btn-run-tg");
    const statusEl = document.getElementById("tg-status");
    btn.disabled = true;
    statusEl.textContent = "Executing Direct Vertex AI vs. Apigee X Token Governance...";
    try {
      const resp = await fetch(`${API_PREFIX}/api/policies/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_group: "token-governance",
          prompt: document.getElementById("tg-prompt").value,
          prompt_token_limit: document.getElementById("tg-prompt-limit").value,
          quota_limit: Number(document.getElementById("tg-quota-limit").value || 500),
          quota_id: document.getElementById("tg-quota-id").value || "tier-standard-app",
          enable_prompt_limit: document.getElementById("tg-enable-ptl").checked,
          enable_token_quota: document.getElementById("tg-enable-ltq").checked,
        }),
      });
      const data = await resp.json();
      const d = data.direct_baseline || {};
      const g = data.apigee_gateway || {};
      const fv = g.apigee_flow_variables || {};

      document.getElementById("tg-direct-prompt-tok").textContent = fmtInt((d.token_usage || {}).prompt_tokens);
      document.getElementById("tg-direct-total-tok").textContent = fmtInt((d.token_usage || {}).total_tokens);
      document.getElementById("tg-direct-cost").textContent = fmtUsd(d.cost_usd, 6);
      document.getElementById("tg-direct-lat").textContent = `${fmtInt(d.latency_ms)} ms`;
      document.getElementById("tg-direct-body").textContent = d.response_text || "";

      const pill = document.getElementById("tg-gw-pill");
      if (g.blocked) {
        pill.textContent = `BLOCKED (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-blocked";
        document.getElementById("tg-gw-verdict").textContent = `BLOCKED (${g.fault_name || "RateLimit"})`;
        document.getElementById("tg-gw-body").textContent =
          `[APIGEE X POLICY CIRCUIT BREAKER TRIGGERED]\n` +
          `HTTP Status: ${g.http_status_code}\n` +
          `Apigee Fault Name: ${g.fault_name}\n` +
          `Reason: ${g.error_message}\n\n` +
          `Details: ${JSON.stringify(g.error_details || {}, null, 2)}`;
      } else {
        pill.textContent = `ALLOWED (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-allowed";
        document.getElementById("tg-gw-verdict").textContent = "ALLOWED";
        document.getElementById("tg-gw-body").textContent = g.response_text || "";
      }
      document.getElementById("tg-gw-quota-used").textContent =
        `${fv.ltq_used_count !== null && fv.ltq_used_count !== undefined ? fv.ltq_used_count : "—"} / ${fv.ltq_allowed_count || document.getElementById("tg-quota-limit").value}`;
      document.getElementById("tg-gw-quota-rem").textContent =
        fv.ltq_available_count !== null && fv.ltq_available_count !== undefined ? fmtInt(fv.ltq_available_count) : "—";
      document.getElementById("tg-gw-tok").textContent = fmtInt((g.token_usage || {}).total_tokens || 0);
      document.getElementById("tg-telemetry-box").textContent = JSON.stringify(g, null, 2);
      statusEl.textContent = `Completed at ${data.timestamp_utc}`;
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  // Execute Tab 3: Model Armor
  document.getElementById("btn-run-ma").addEventListener("click", async () => {
    const btn = document.getElementById("btn-run-ma");
    const statusEl = document.getElementById("ma-status");
    btn.disabled = true;
    statusEl.textContent = "Executing Direct Vertex AI vs. Apigee X + Model Armor...";
    try {
      const resp = await fetch(`${API_PREFIX}/api/policies/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_group: "model-armor",
          prompt: document.getElementById("ma-prompt").value,
          enable_sanitize_prompt: document.getElementById("ma-enable-prompt").checked,
          enable_sanitize_response: document.getElementById("ma-enable-response").checked,
        }),
      });
      const data = await resp.json();
      const d = data.direct_baseline || {};
      const g = data.apigee_gateway || {};

      document.getElementById("ma-direct-prompt-tok").textContent = fmtInt((d.token_usage || {}).prompt_tokens);
      document.getElementById("ma-direct-total-tok").textContent = fmtInt((d.token_usage || {}).total_tokens);
      document.getElementById("ma-direct-cost").textContent = fmtUsd(d.cost_usd, 6);
      document.getElementById("ma-direct-lat").textContent = `${fmtInt(d.latency_ms)} ms`;
      document.getElementById("ma-direct-body").textContent = d.response_text || "";

      const pill = document.getElementById("ma-gw-pill");
      if (g.blocked) {
        pill.textContent = `BLOCKED BY MODEL ARMOR (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-blocked";
        document.getElementById("ma-gw-verdict").textContent = "BLOCKED AT GATEWAY";
        document.getElementById("ma-gw-fault").textContent = g.fault_name || "ModelArmorViolation";
        document.getElementById("ma-gw-body").textContent =
          `[BLOCKED BY APIGEE X + GOOGLE CLOUD MODEL ARMOR]\n` +
          `Template: projects/apac-cs-5g-demo5/locations/us-central1/templates/apigee-ai-safety-template\n` +
          `HTTP Status: ${g.http_status_code}\n` +
          `Apigee Fault: ${g.fault_name}\n` +
          `Message: ${g.error_message}\n\n` +
          `Details: ${JSON.stringify(g.error_details || {}, null, 2)}`;
      } else {
        pill.textContent = `PASSED MODEL ARMOR (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-allowed";
        document.getElementById("ma-gw-verdict").textContent = "SANITIZED & ALLOWED";
        document.getElementById("ma-gw-fault").textContent = "None (Clean)";
        document.getElementById("ma-gw-body").textContent = g.response_text || "";
      }
      document.getElementById("ma-gw-tok").textContent = fmtInt((g.token_usage || {}).total_tokens || 0);
      document.getElementById("ma-gw-lat").textContent = `${fmtInt(g.latency_ms || g.client_observed_latency_ms)} ms`;
      document.getElementById("ma-telemetry-box").textContent = JSON.stringify(g, null, 2);
      statusEl.textContent = `Completed at ${data.timestamp_utc}`;
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  // Execute Tab 4: Semantic Governance / Native Cache
  document.getElementById("btn-submode-sg").addEventListener("click", () => {
    state.tab4Submode = "semantic-governance";
    renderTab4Submode();
  });
  document.getElementById("btn-submode-nc").addEventListener("click", () => {
    state.tab4Submode = "native-cache";
    renderTab4Submode();
  });

  document.getElementById("btn-run-sg").addEventListener("click", async () => {
    const btn = document.getElementById("btn-run-sg");
    const statusEl = document.getElementById("sg-status");
    btn.disabled = true;
    statusEl.textContent = `Executing Apigee X (${state.tab4Submode})...`;
    try {
      const resp = await fetch(`${API_PREFIX}/api/policies/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_group: state.tab4Submode,
          prompt: document.getElementById("sg-prompt").value,
        }),
      });
      const data = await resp.json();
      const d = data.direct_baseline || {};
      const g = data.apigee_gateway || {};
      const fv = g.apigee_flow_variables || {};

      document.getElementById("sg-direct-prompt-tok").textContent = fmtInt((d.token_usage || {}).prompt_tokens);
      document.getElementById("sg-direct-total-tok").textContent = fmtInt((d.token_usage || {}).total_tokens);
      document.getElementById("sg-direct-cost").textContent = fmtUsd(d.cost_usd, 6);
      document.getElementById("sg-direct-lat").textContent = `${fmtInt(d.latency_ms)} ms`;
      document.getElementById("sg-direct-body").textContent = d.response_text || "";

      const pill = document.getElementById("sg-gw-pill");
      if (g.blocked) {
        pill.textContent = `BLOCKED (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-blocked";
        document.getElementById("sg-gw-verdict").textContent = "BLOCKED BY POLICY";
        document.getElementById("sg-gw-fault").textContent = g.fault_name || "PolicyViolation";
        document.getElementById("sg-gw-body").textContent =
          `[APIGEE X NATIVE POLICY INTERCEPTED REQUEST/RESPONSE]\n` +
          `Policy Flow: /v1/ai-economics/policies/${state.tab4Submode}\n` +
          `HTTP Status: ${g.http_status_code}\n` +
          `Fault Name: ${g.fault_name}\n` +
          `Message: ${g.error_message}\n\n` +
          `Details: ${JSON.stringify(g.error_details || {}, null, 2)}`;
      } else {
        pill.textContent = `ALLOWED (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-allowed";
        document.getElementById("sg-gw-verdict").textContent = "ALLOWED";
        document.getElementById("sg-gw-fault").textContent =
          state.tab4Submode === "native-cache"
            ? `Native Cache Hit: ${fv.scl_cache_hit || false}`
            : "Rule Verified (Compliant)";
        document.getElementById("sg-gw-body").textContent = g.response_text || "";
      }
      document.getElementById("sg-gw-tok").textContent = fmtInt((g.token_usage || {}).total_tokens || 0);
      document.getElementById("sg-gw-lat").textContent = `${fmtInt(g.latency_ms || g.client_observed_latency_ms)} ms`;
      document.getElementById("sg-telemetry-box").textContent = JSON.stringify(g, null, 2);
      statusEl.textContent = `Completed at ${data.timestamp_utc}`;
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  // Vector Search Node Status & Toggle Controls
  async function refreshVectorSearchStatus() {
    try {
      const resp = await fetch(`${API_PREFIX}/api/vector-search/status`);
      const st = await resp.json();
      renderVectorSearchState(st);
    } catch (e) {
      document.getElementById("vs-resource-details").textContent = `Status check error: ${e.message}`;
    }
  }

  function renderVectorSearchState(st) {
    if (!st) return;
    const badge = document.getElementById("vs-state-badge");
    const costBadge = document.getElementById("vs-cost-badge");
    badge.textContent = st.node_state || "UNKNOWN";
    costBadge.textContent = `$${Number(st.hourly_cost_usd || 0).toFixed(2)}/hr`;

    if (st.node_state === "ACTIVE") {
      badge.className = "model-pill pill-allowed";
    } else if (st.node_state === "SUSPENDED") {
      badge.className = "model-pill";
    } else {
      badge.className = "model-pill pill-deploying";
    }

    document.getElementById("vs-shard-label").textContent = `${st.shard_size} / ${st.machine_type}`;
    document.getElementById("vs-resource-details").innerHTML =
      `Index: <code>${escapeHtml(st.index_resource)}</code> &bull; ` +
      `Deployed ID: <code>${escapeHtml(st.deployed_index_id)}</code> (Deployed: <strong>${st.is_deployed}</strong>)`;
    if (st.public_endpoint_domain) {
      document.getElementById("vs-domain-label").innerHTML =
        `Public Endpoint: <code>${escapeHtml(st.public_endpoint_domain)}</code>`;
    }
  }

  document.getElementById("btn-vs-refresh").addEventListener("click", refreshVectorSearchStatus);
  document.getElementById("btn-vs-wake").addEventListener("click", async () => {
    const btn = document.getElementById("btn-vs-wake");
    btn.disabled = true;
    try {
      const resp = await fetch(`${API_PREFIX}/api/vector-search/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "on" }),
      });
      const res = await resp.json();
      renderVectorSearchState(res.state);
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById("btn-vs-suspend").addEventListener("click", async () => {
    const btn = document.getElementById("btn-vs-suspend");
    btn.disabled = true;
    try {
      const resp = await fetch(`${API_PREFIX}/api/vector-search/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "off" }),
      });
      const res = await resp.json();
      renderVectorSearchState(res.state);
    } finally {
      btn.disabled = false;
    }
  });

  // Wire Event Listeners (Tab 1)
  [elToggleCache, elToggleCompress, elToggleRoute, elTogglePrune].forEach((input) => {
    input.addEventListener("change", syncToggleUI);
  });

  document.getElementById("btn-toggles-all-on").addEventListener("click", () => {
    elToggleCache.checked = true;
    elToggleCompress.checked = true;
    elToggleRoute.checked = true;
    elTogglePrune.checked = true;
    syncToggleUI();
  });

  document.getElementById("btn-toggles-all-off").addEventListener("click", () => {
    elToggleCache.checked = false;
    elToggleCompress.checked = false;
    elToggleRoute.checked = false;
    elTogglePrune.checked = false;
    syncToggleUI();
  });

  elBtnExecute.addEventListener("click", executeComparison);
  elBtnRunSequence.addEventListener("click", runAllScenariosSequentially);
  elBtnReset.addEventListener("click", resetGatewayState);
  elScaleSlider.addEventListener("input", updateAnnualProjectionUI);

  // Audit Drawer Tabs (Tab 1)
  document.querySelectorAll(".audit-tab").forEach((tabBtn) => {
    tabBtn.addEventListener("click", () => {
      document.querySelectorAll(".audit-tab").forEach((b) => b.classList.remove("active"));
      tabBtn.classList.add("active");
      const targetId = tabBtn.dataset.tab;
      ["tab-compression", "tab-cascade", "tab-cache-prune", "tab-headers-raw"].forEach((id) => {
        document.getElementById(id).style.display = id === targetId ? "block" : "none";
      });
    });
  });

  // Modal ("About")
  const elModal = document.getElementById("about-modal");
  document.getElementById("btn-open-about").addEventListener("click", () => {
    elModal.classList.add("open");
  });
  document.getElementById("btn-close-about").addEventListener("click", () => {
    elModal.classList.remove("open");
  });
  elModal.addEventListener("click", (e) => {
    if (e.target === elModal) elModal.classList.remove("open");
  });

  // Initialize from /api/scenarios and /api/policies/presets
  async function init() {
    try {
      const [scenResp, polResp] = await Promise.all([
        fetch(`${API_PREFIX}/api/scenarios`),
        fetch(`${API_PREFIX}/api/policies/presets`),
      ]);
      const data = await scenResp.json();
      state.scenarios = data.scenarios || [];
      if (data.apigee_gateway_url) {
        document.getElementById("footer-apigee-url").textContent = `${data.apigee_gateway_url}/chat`;
      }
      renderScenarioList();
      updateSessionLedgerUI();

      if (polResp.ok) {
        const polData = await polResp.json();
        state.policiesCatalog = polData.policies_catalog || [];
        state.policyScenarios = polData.policy_scenarios || {};
        state.system1Scenarios = polData.system1_scenarios || [];
        renderPolicyTabs();
        renderSystem1Tab();
      }
      refreshVectorSearchStatus();
    } catch (err) {
      elRunStatus.textContent = `Initialization error: ${err.message}`;
    }
  }

  // ===========================================================================
  // TAB 5: SYSTEM 1 (TYPESAFE JEV) & SYSTEM 2 (VERTEX AI GEMINI) ROUTING
  // ===========================================================================
  function selectSystem1Scenario(scen) {
    state.activeSystem1Scenario = scen;
    document.getElementById("s1-sys").value = scen.system_instruction || "";
    document.getElementById("s1-rag").value = scen.rag_context || "";
    document.getElementById("s1-query").value = scen.user_query || "";
    document.getElementById("s1-conf-threshold").value =
      scen.confidence_threshold !== undefined ? scen.confidence_threshold : 0.75;
    document.getElementById("s1-fire-threshold").value =
      scen.fire_threshold !== undefined ? scen.fire_threshold : 0.70;
    document.getElementById("s1-enable-fast-track").checked =
      scen.enable_direct_pro_fast_track !== false;
    document.getElementById("s1-enable-verifier").checked =
      scen.enable_post_verifier !== false;
    document.getElementById("s1-simulate-defect").checked = Boolean(scen.simulate_l1_defect);
  }

  function renderSystem1Tab() {
    const s1List = document.getElementById("s1-scenario-list");
    if (!s1List) return;
    const scens = state.system1Scenarios || [];
    s1List.innerHTML = "";
    scens.forEach((scen, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scenario-item" + (idx === 0 ? " active" : "");
      btn.innerHTML = `
        <div>
          <div class="scenario-item-title">${escapeHtml(scen.title)}</div>
          <div class="scenario-item-sub">${escapeHtml(scen.description)}</div>
        </div>
        <span class="scenario-badge">${escapeHtml(scen.badge)}</span>
      `;
      btn.addEventListener("click", () => {
        s1List.querySelectorAll(".scenario-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        selectSystem1Scenario(scen);
      });
      s1List.appendChild(btn);
    });
    if (scens.length > 0) {
      selectSystem1Scenario(scens[0]);
    }
  }

  const btnRunS1 = document.getElementById("btn-run-s1");
  if (btnRunS1) {
    btnRunS1.addEventListener("click", async () => {
      const statusEl = document.getElementById("s1-status");
      btnRunS1.disabled = true;
      statusEl.textContent = "Calling TypeSafe Jev (System 1) + Apigee X + Vertex AI Gemini...";
      try {
        const payload = {
          session_id: "jev-demo-session",
          scenario_id: (state.activeSystem1Scenario && state.activeSystem1Scenario.id) || "jev-custom",
          system_instruction: document.getElementById("s1-sys").value,
          rag_context: document.getElementById("s1-rag").value,
          user_query: document.getElementById("s1-query").value,
          confidence_threshold: Number(document.getElementById("s1-conf-threshold").value || 0.75),
          fire_threshold: Number(document.getElementById("s1-fire-threshold").value || 0.70),
          enable_direct_pro_fast_track: document.getElementById("s1-enable-fast-track").checked,
          enable_post_verifier: document.getElementById("s1-enable-verifier").checked,
          simulate_l1_defect: document.getElementById("s1-simulate-defect").checked,
        };

        const resp = await fetch(`${API_PREFIX}/api/system1/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${errText}`);
        }
        const data = await resp.json();
        const d = data.direct_baseline || {};
        const g = data.apigee_gateway || {};
        const cmp = data.comparison || {};

        // 1. Direct Baseline Card
        const dTok = d.token_accounting || {};
        const dCost = d.cost_accounting || {};
        document.getElementById("s1-direct-prompt-tok").textContent = fmtInt(dTok.prompt_tokens);
        document.getElementById("s1-direct-out-tok").textContent = fmtInt(
          (dTok.candidate_tokens || 0) + (dTok.thinking_tokens || 0)
        );
        document.getElementById("s1-direct-cost").textContent = fmtUsd(dCost.total_cost_usd, 6);
        document.getElementById("s1-direct-lat").textContent = `${fmtInt(d.latency_ms)} ms`;
        document.getElementById("s1-direct-body").textContent = d.response_text || "";

        // 2. Apigee X + TypeSafe Jev Card
        const gCost = g.cost_accounting || {};
        const pill = document.getElementById("s1-gw-pill");
        pill.textContent = g.final_model_used || "gemini-2.5-flash";
        pill.className = g.escalated_to_pro
          ? "model-pill pill-deploying"
          : "model-pill pill-allowed";

        document.getElementById("s1-gw-route").textContent =
          g.initial_routing_decision === "GEMINI_2_5_PRO"
            ? "Direct Pro Fast-Track"
            : g.escalated_to_pro
            ? "L1 Flash -> Escalated L2 Pro"
            : "L1 Flash Accepted";
        document.getElementById("s1-gw-jev-cost").textContent = fmtUsd(
          gCost.total_jev_system1_cost_usd,
          8
        );
        document.getElementById("s1-gw-total-cost").textContent = fmtUsd(gCost.total_cost_usd, 6);
        document.getElementById("s1-gw-savings").textContent =
          `${cmp.cost_reduction_pct >= 0 ? "+" : ""}${cmp.cost_reduction_pct}% (${fmtUsd(cmp.cost_saved_usd, 6)})`;

        let gwBodyText = g.response_text || "";
        if (g.escalated_to_pro && g.l1_response_preview) {
          gwBodyText =
            `[JEV STAGE 2 NOUL BATTERY INTERCEPTED DEFECTIVE L1 FLASH RESPONSE & ESCALATED TO GEMINI 2.5 PRO]\n` +
            `Escalation Reason: ${g.escalation_reason}\n` +
            `Rejected L1 Flash Preview: "${g.l1_response_preview}"\n` +
            `------------------------------------------------------------------------\n` +
            `[RECOVERED SYSTEM 2 (GEMINI 2.5 PRO) FINAL RESPONSE]:\n` +
            gwBodyText;
        }
        document.getElementById("s1-gw-body").textContent = gwBodyText;

        // 3. Stage 1 Jev Telemetry Box
        const st1 = g.stage1_jev || {};
        const st1Usage = st1.usage || {};
        document.getElementById("s1-stage1-meta").textContent =
          `Model: ${st1.model || "jev-latest"} | Latency: ${st1.latency_ms || 0} ms | In: ${st1Usage.input_tokens || 0} tok (${fmtUsd(st1Usage.cost_usd, 8)})`;

        const st1Lines = [
          `=== STAGE 1: TYPESAFE JEV PRE-FLIGHT ROUTER (${st1.model || "jev-latest"}) ===`,
          `Apigee RouteRule Selected : ${g.apigee_route_rule_taken}`,
          `Routing Decision          : ${g.initial_routing_decision} (${g.initial_target_model})`,
          `Routing Reason            : ${g.routing_reason}`,
          ``,
          `--- 1. Jev Choice Primitive (target_tier) ---`,
          `Selected Tier             : ${st1.target_tier_choice} (Confidence: ${st1.target_tier_confidence} vs Gate: ${st1.confidence_threshold})`,
          `Calibrated Softmax Probs  : ${JSON.stringify(st1.target_tier_probabilities || {})}`,
          ``,
          `--- 2. Jev Score Primitive (complexity 0..2) ---`,
          `Expected Value E[Score]   : ${st1.complexity_score} / 2.0 (Normalized: ${st1.complexity_normalized})`,
          `Score Level Probabilities : ${JSON.stringify(st1.complexity_probabilities || {})}`,
          ``,
          `--- 3. Jev Pre-Flight Noul Primitives ---`,
          `requires_formal_proof     : ${st1.pre_nouls ? st1.pre_nouls.requires_formal_proof : 0}`,
          `has_strict_multi_constr.  : ${st1.pre_nouls ? st1.pre_nouls.has_strict_multi_constraints : 0}`,
        ];
        document.getElementById("s1-stage1-box").textContent = st1Lines.join("\n");

        // 4. Stage 2 Jev 5-Head Noul Battery Telemetry Box
        const st2 = g.stage2_jev || {};
        const st2Usage = st2.usage || {};
        document.getElementById("s1-stage2-meta").textContent = st2.executed
          ? `Model: ${st2.model || "jev-latest"} | Latency: ${st2.latency_ms || 0} ms | In: ${st2Usage.input_tokens || 0} tok (${fmtUsd(st2Usage.cost_usd, 8)})`
          : `Skipped (${st2.skipped_reason || "Direct System 2 Pro Fast-Track"})`;

        if (!st2.executed) {
          document.getElementById("s1-stage2-box").textContent =
            `Stage 2 Post-Verifier was skipped: ${st2.skipped_reason}\n\n` +
            `Because Jev Stage 1 routed directly to System 2 (gemini-2.5-pro), Apigee X avoided a wasted L1 Flash call and returned the frontier Pro completion directly.`;
        } else {
          const batteryRows = (st2.noul_battery_table || []).map((row) => {
            const pStr = Number(row.probability || 0).toFixed(4);
            const flagStr = row.fired ? "  <== FIRES (> " + st2.fire_threshold + ")" : "";
            return `  ${row.question.padEnd(38, " ")} : ${pStr}${flagStr}`;
          });
          const st2Lines = [
            `=== STAGE 2: JEV DECOMPOSED 5-HEAD NOUL BATTERY (${st2.model || "jev-latest"}) ===`,
            `Gate Rule (any_flag)      : max(noul_battery) = ${st2.max_noul_value} (Threshold: > ${st2.fire_threshold})`,
            `Gate Verdict              : ${st2.any_flag_fired ? "FIRED -> ESCALATE TO GEMINI 2.5 PRO" : "ALL CLEAR -> ACCEPT L1 GEMINI 2.5 FLASH"}`,
            `Firing Heads              : ${(st2.firing_heads || []).length > 0 ? st2.firing_heads.join(", ") : "None"}`,
            `Holistic Single-Judge Noul: ${st2.holistic_escalate_judge} (Notice how single-question judges under-react vs decomposed battery)`,
            `Jev Response Quality Score: ${st2.response_quality_score} / 2.0`,
            ``,
            `--- 5-Head Noul Battery Probabilities ---`,
            ...batteryRows,
            ``,
            `Escalation Summary        : ${g.escalation_reason}`,
          ];
          document.getElementById("s1-stage2-box").textContent = st2Lines.join("\n");
        }

        statusEl.textContent = `Completed at ${data.timestamp_utc}`;
      } catch (e) {
        statusEl.textContent = `Error: ${e.message}`;
      } finally {
        btnRunS1.disabled = false;
      }
    });
  }

  init();
})();
