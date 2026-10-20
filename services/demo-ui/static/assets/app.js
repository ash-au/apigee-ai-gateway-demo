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
  };

  // DOM Elements
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

  // Sync toggle cards & header tags
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

  // Select a preset scenario
  function selectScenario(scen) {
    state.activeScenario = scen;
    document.querySelectorAll(".scenario-item").forEach((el) => {
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

  // Render Scenario List
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

  // Execute Side-by-Side Comparison
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

      // Update cumulative ledger
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

  // Render Side-by-Side Comparison Cards & Staff Engineer Audit Drawer
  function renderComparisonResult(data) {
    const direct = data.direct_baseline;
    const gw = data.apigee_gateway;
    const cmp = data.comparison;

    // 1. Direct Baseline Card
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

    // 2. Apigee X Gateway Card
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

    // 3. Populate Staff Engineer Inspection Drawer Tabs
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

    // Tab 2: FrugalGPT Routing & Cascade Audit
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

    // Tab 3: Semantic Cache & Context Pruning State
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

    // Tab 4: Live HTTP Headers & Raw JSON
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

  // Run all 5 scenarios sequentially
  async function runAllScenariosSequentially() {
    if (state.isRunning) return;
    for (let i = 0; i < state.scenarios.length; i++) {
      selectScenario(state.scenarios[i]);
      await executeComparison();
    }
  }

  // Reset Gateway State & Session Ledger
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

  // Wire Event Listeners
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

  // Audit Drawer Tabs
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

  // Initialize from /api/scenarios
  async function init() {
    try {
      const resp = await fetch(`${API_PREFIX}/api/scenarios`);
      const data = await resp.json();
      state.scenarios = data.scenarios || [];
      if (data.apigee_gateway_url) {
        document.getElementById("footer-apigee-url").textContent = `${data.apigee_gateway_url}/chat`;
      }
      renderScenarioList();
      updateSessionLedgerUI();
    } catch (err) {
      elRunStatus.textContent = `Initialization error: ${err.message}`;
    }
  }

  init();
})();
