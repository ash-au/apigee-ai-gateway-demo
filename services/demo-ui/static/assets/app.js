/* ==========================================================================
   Apigee X as an AI Gateway — Frontend Controller (app.js)
   All telemetry comes from live Vertex AI usageMetadata and Apigee X headers.
   ========================================================================== */

(function () {
  "use strict";

  const API_PREFIX = window.location.pathname.startsWith("/v1/ai-economics")
    ? "/v1/ai-economics"
    : "";
  const PUBLIC_XLB_BASE = "https://eval-group.34-120-155-152.nip.io/v1/ai-economics";
  let usePublicXlbFallback = false;

  async function apiFetch(endpointPath, options = {}) {
    if (!usePublicXlbFallback) {
      try {
        const primaryResp = await fetch(`${API_PREFIX}${endpointPath}`, {
          credentials: "same-origin",
          ...options,
        });
        if (primaryResp.status !== 401 && primaryResp.status !== 403) {
          return primaryResp;
        }
        console.warn(
          `[Apigee Demo UI] Primary endpoint returned HTTP ${primaryResp.status} (IAP token expired/missing); switching to Public Apigee X XLB.`
        );
        usePublicXlbFallback = true;
      } catch (primaryErr) {
        console.warn(
          "[Apigee Demo UI] Primary endpoint network error; switching to Public Apigee X XLB:",
          primaryErr
        );
        usePublicXlbFallback = true;
      }
    }
    return fetch(`${PUBLIC_XLB_BASE}${endpointPath}`, {
      mode: "cors",
      credentials: "omit",
      ...options,
    });
  }

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
    system1Provider: "gemini_decision_1", // "gemini_decision_1" | "typesafe_jev"
  };

  // DOM Elements (Tab 1)
  const elScenarioList = document.getElementById("scenario-list");
  const elActiveScenarioMeta = document.getElementById("active-scenario-meta");
  const elPresenterNote = document.getElementById("presenter-note");
  const elInputSystem = document.getElementById("input-system");
  const elInputHistory = document.getElementById("input-history");
  const elInputRag = document.getElementById("input-rag");
  const elInputPrompt = document.getElementById("input-prompt");
  const elMetaSystemLen = document.getElementById("meta-system-len");
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

  function setDeltaClass(el, isPositiveSavings) {
    if (!el) return;
    el.classList.remove("savings-number", "cost-increase");
    if (isPositiveSavings === true) {
      el.classList.add("savings-number");
    } else if (isPositiveSavings === false) {
      el.classList.add("cost-increase");
    }
  }

  function updateComposerCounters() {
    if (elMetaSystemLen) {
      const len = (elInputSystem.value || "").length;
      elMetaSystemLen.textContent = len > 0 ? `${fmtInt(len)} chars` : "None";
    }
    if (elMetaRagLen) {
      const len = (elInputRag.value || "").length;
      elMetaRagLen.textContent = len > 0 ? `${fmtInt(len)} chars` : "None";
    }
    if (elMetaHistoryTurns) {
      try {
        const parsed = JSON.parse(elInputHistory.value || "[]");
        const turns = Array.isArray(parsed) ? parsed.length : 0;
        elMetaHistoryTurns.textContent = `${fmtInt(turns)} prior turn${turns === 1 ? "" : "s"}`;
      } catch (e) {
        elMetaHistoryTurns.textContent = "Invalid JSON";
      }
    }
  }

  function wireTablistKeyboardNav() {
    document.querySelectorAll('[role="tablist"]').forEach((tablist) => {
      tablist.addEventListener("keydown", (e) => {
        const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
        if (!tabs.length) return;
        const idx = tabs.indexOf(document.activeElement);
        if (idx === -1) return;
        let nextIdx = -1;
        if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
        else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = tabs.length - 1;
        if (nextIdx !== -1) {
          e.preventDefault();
          tabs[nextIdx].focus();
          tabs[nextIdx].click();
        }
      });
    });
  }

  // Theme Switcher (Dark-First Obsidian Command Center <-> Crisp Cloud Light)
  function initThemeSwitcher() {
    const btn = document.getElementById("btn-theme-toggle");
    if (!btn) return;
    const label = document.getElementById("theme-toggle-label");
    const iconMoon = document.getElementById("theme-icon-moon");
    const iconSun = document.getElementById("theme-icon-sun");

    function getCurrentTheme() {
      const explicit = document.documentElement.getAttribute("data-theme");
      if (explicit === "light" || explicit === "dark") return explicit;
      return "dark";
    }

    function applyThemeUI(theme) {
      const isDark = theme === "dark";
      btn.setAttribute("aria-pressed", isDark ? "true" : "false");
      if (label) label.textContent = isDark ? "Light" : "Dark";
      if (iconMoon) iconMoon.style.display = isDark ? "none" : "block";
      if (iconSun) iconSun.style.display = isDark ? "block" : "none";
    }

    applyThemeUI(getCurrentTheme());

    btn.addEventListener("click", () => {
      const nextTheme = getCurrentTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", nextTheme);
      try {
        localStorage.setItem("apigee-demo-theme", nextTheme);
      } catch (e) {}
      applyThemeUI(nextTheme);
    });
  }

  // Slide-Over Details Drawer (DOM-portals active tab's deep-dive cleanly without duplicating IDs)
  let _drawerActiveNode = null;
  let _drawerOriginalParent = null;

  function closeKeynoteDrawer() {
    const drawer = document.getElementById("keynote-drawer");
    const scrim = document.getElementById("drawer-scrim");
    if (!drawer || !scrim) return;
    drawer.classList.remove("open");
    scrim.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    scrim.setAttribute("aria-hidden", "true");
    if (_drawerActiveNode && _drawerOriginalParent) {
      _drawerActiveNode.style.display = "";
      _drawerOriginalParent.appendChild(_drawerActiveNode);
      _drawerActiveNode = null;
      _drawerOriginalParent = null;
    }
  }

  function openKeynoteDrawer(targetId, titleText) {
    const drawer = document.getElementById("keynote-drawer");
    const scrim = document.getElementById("drawer-scrim");
    const slot = document.getElementById("drawer-slot");
    const titleEl = document.getElementById("drawer-title-text");
    const target = document.getElementById(targetId);
    if (!drawer || !scrim || !slot || !target) return;

    if (_drawerActiveNode && _drawerActiveNode !== target) {
      closeKeynoteDrawer();
    }
    _drawerActiveNode = target;
    _drawerOriginalParent = target.parentNode;
    if (titleEl && titleText) titleEl.textContent = titleText;
    target.style.display = "flex";
    slot.appendChild(target);

    drawer.classList.add("open");
    scrim.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    scrim.setAttribute("aria-hidden", "false");
  }

  function initKeynoteDrawer() {
    document.querySelectorAll("[data-open-drawer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openKeynoteDrawer(btn.dataset.openDrawer, btn.dataset.drawerTitle || "Live Responses & Telemetry");
      });
    });
    const btnClose = document.getElementById("btn-close-drawer");
    const scrim = document.getElementById("drawer-scrim");
    if (btnClose) btnClose.addEventListener("click", closeKeynoteDrawer);
    if (scrim) scrim.addEventListener("click", closeKeynoteDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeKeynoteDrawer();
    });
  }

  // Executive View <-> Architect Inspector Switcher
  function initViewModeSwitcher() {
    const btnExec = document.getElementById("btn-view-executive");
    const btnArch = document.getElementById("btn-view-architect");
    if (!btnExec || !btnArch) return;

    function applyViewMode(mode) {
      const normalized = mode === "architect" ? "architect" : "executive";
      if (normalized === "architect") closeKeynoteDrawer();
      document.documentElement.setAttribute("data-view", normalized);
      btnExec.classList.toggle("active", normalized === "executive");
      btnExec.setAttribute("aria-pressed", normalized === "executive" ? "true" : "false");
      btnArch.classList.toggle("active", normalized === "architect");
      btnArch.setAttribute("aria-pressed", normalized === "architect" ? "true" : "false");
      const eyebrow = document.getElementById("stage-eyebrow-text");
      if (eyebrow) {
        eyebrow.textContent =
          normalized === "architect"
            ? "Architect Workbench · Prompts, Policies & Raw XML Telemetry"
            : "Live Executive Keynote · Apigee X + Vertex AI";
      }
      try {
        localStorage.setItem("apigee-demo-view", normalized);
      } catch (e) {}
    }

    const current = document.documentElement.getAttribute("data-view") || "executive";
    applyViewMode(current);

    btnExec.addEventListener("click", () => applyViewMode("executive"));
    btnArch.addEventListener("click", () => applyViewMode("architect"));
  }

  // Kinetic Metric Pop Micro-Animation
  function popMetric(el) {
    if (!el) return;
    el.classList.remove("metric-pop");
    void el.offsetWidth;
    el.classList.add("metric-pop");
  }

  // Live SVG Pipeline Helpers
  function setPipeRunning(svgId, running) {
    const svg = document.getElementById(svgId);
    if (!svg) return;
    svg.classList.toggle("is-running", Boolean(running));
    svg.classList.toggle("pipe-running", Boolean(running));
  }

  function resetPipeSvg(svgId) {
    const svg = document.getElementById(svgId);
    if (!svg) return;
    svg.querySelectorAll(".pipe-node").forEach((el) => {
      el.classList.remove(
        "state-active",
        "state-savings",
        "state-alert",
        "state-amber",
        "state-jev",
        "state-bypass"
      );
    });
    svg.querySelectorAll(".pipe-edge").forEach((el) => {
      el.classList.remove("edge-active", "edge-savings", "edge-alert", "edge-amber", "edge-jev");
    });
  }

  function setNodeState(nodeId, stateClass, subId, subText) {
    const node = document.getElementById(nodeId);
    if (node && stateClass) node.classList.add(stateClass);
    if (subId && subText !== undefined) {
      const sub = document.getElementById(subId);
      if (sub) sub.textContent = subText;
    }
  }

  function setEdgeState(edgeId, edgeClass) {
    const edge = document.getElementById(edgeId);
    if (edge && edgeClass) edge.classList.add(edgeClass);
  }

  function updateTab1Pipeline(gw) {
    resetPipeSvg("t1-pipeline-svg");
    const sc = (gw.optimizations || {}).semantic_cache || {};
    const comp = (gw.optimizations || {}).prompt_compression || {};
    const cp = (gw.optimizations || {}).context_pruning || {};
    const rc = (gw.optimizations || {}).model_routing_cascade || {};
    const statusPill = document.getElementById("t1-pipe-status");

    setNodeState("t1-node-client", "state-active");
    setEdgeState("t1-edge-1", "edge-active");

    if (sc.hit) {
      const simFmt = sc.similarity_score !== null && sc.similarity_score !== undefined ? Number(sc.similarity_score).toFixed(2) : "—";
      setNodeState("t1-node-cache", "state-savings", "t1-sub-cache", `HIT (${simFmt})`);
      setEdgeState("t1-edge-shortcircuit", "edge-savings");
      setNodeState("t1-node-compress", "state-bypass", "t1-sub-compress", "Short-circuited");
      setNodeState("t1-node-prune", "state-bypass", "t1-sub-prune", "Short-circuited");
      setNodeState("t1-node-router", "state-bypass", "t1-sub-router", "Short-circuited");
      setNodeState("t1-node-llm", "state-savings", "t1-sub-llm", "0 LLM tokens");
      if (statusPill) {
        statusPill.textContent = `CACHE SHORT-CIRCUIT (sim=${simFmt})`;
        statusPill.className = "model-pill pill-allowed";
      }
      return;
    }

    setNodeState(
      "t1-node-cache",
      sc.enabled ? "state-active" : "state-bypass",
      "t1-sub-cache",
      sc.enabled ? "MISS (indexed)" : "Bypassed"
    );
    setEdgeState("t1-edge-2", "edge-active");

    const compReduced = Number(comp.tokens_before || 0) > Number(comp.tokens_after || 0);
    const compPct =
      comp.tokens_before > 0
        ? (((comp.tokens_before - comp.tokens_after) / comp.tokens_before) * 100).toFixed(0)
        : "0";
    setNodeState(
      "t1-node-compress",
      compReduced ? "state-savings" : comp.enabled ? "state-active" : "state-bypass",
      "t1-sub-compress",
      compReduced ? `-${compPct}% pruned` : comp.enabled ? "0% delta" : "Disabled"
    );
    setEdgeState("t1-edge-3", "edge-active");

    setNodeState(
      "t1-node-prune",
      cp.applied ? "state-savings" : cp.enabled ? "state-active" : "state-bypass",
      "t1-sub-prune",
      cp.applied ? `${cp.turns_before}→${cp.turns_after} turns` : cp.enabled ? "Under 800 tok" : "Disabled"
    );
    setEdgeState("t1-edge-4", "edge-active");

    const isDirectPro = rc.initial_decision === "PRO_DIRECT_HIGH_COMPLEXITY" || !rc.enabled;
    const cxFmt = rc.complexity_score !== null && rc.complexity_score !== undefined ? Number(rc.complexity_score).toFixed(2) : "—";
    if (rc.escalated_to_pro) {
      setNodeState("t1-node-router", "state-amber", "t1-sub-router", "L1→L2 Escalated");
      setEdgeState("t1-edge-5", "edge-amber");
      setNodeState("t1-node-llm", "state-amber", "t1-sub-llm", "Flash + Pro");
      if (statusPill) {
        statusPill.textContent = "ESCALATED TO L2 PRO (BOTH BILLED)";
        statusPill.className = "model-pill pill-deploying";
      }
    } else if (isDirectPro || String(gw.model_used || "").includes("pro")) {
      setNodeState("t1-node-router", "state-amber", "t1-sub-router", `Direct Pro (${cxFmt})`);
      setEdgeState("t1-edge-5", "edge-amber");
      setNodeState("t1-node-llm", "state-amber", "t1-sub-llm", "gemini-2.5-pro");
      if (statusPill) {
        statusPill.textContent = rc.enabled ? "PRO DIRECT (HIGH COMPLEXITY)" : "ROUTING OFF (PRO)";
        statusPill.className = "model-pill pill-deploying";
      }
    } else {
      setNodeState("t1-node-router", "state-savings", "t1-sub-router", `Flash (${cxFmt})`);
      setEdgeState("t1-edge-5", "edge-savings");
      setNodeState("t1-node-llm", "state-savings", "t1-sub-llm", "gemini-2.5-flash");
      if (statusPill) {
        statusPill.textContent = "OPTIMIZED ON L1 FLASH";
        statusPill.className = "model-pill pill-allowed";
      }
    }
  }

  function updateTab1Visuals(data) {
    const direct = data.direct_baseline;
    const gw = data.apigee_gateway;
    const cmp = data.comparison;
    const comp = (gw.optimizations || {}).prompt_compression || {};
    const sc = (gw.optimizations || {}).semantic_cache || {};

    const dCost = Number(direct.cost_accounting.total_cost_usd || 0);
    const gCost = Number(gw.cost_accounting.total_cost_usd || 0);
    const maxCost = Math.max(dCost, gCost, 0.000001);

    document.getElementById("viz-cost-direct-val").textContent = fmtUsd(dCost, 6);
    document.getElementById("viz-cost-gw-val").textContent = fmtUsd(gCost, 6);
    document.getElementById("viz-cost-direct-bar").style.transform = `scaleX(${Math.max(dCost > 0 ? 0.02 : 0, dCost / maxCost).toFixed(4)})`;

    const gwBar = document.getElementById("viz-cost-gw-bar");
    gwBar.style.transform = `scaleX(${Math.max(gCost > 0 ? 0.02 : 0, gCost / maxCost).toFixed(4)})`;
    gwBar.className = `viz-fill viz-fill-scale ${cmp.cost_saved_usd >= 0 ? "viz-fill-savings" : "viz-fill-alert"}`;

    const deltaPill = document.getElementById("viz-cost-delta-pill");
    const isSavings = cmp.cost_saved_usd >= 0;
    deltaPill.textContent = `${isSavings ? "-" : "+"}${Math.abs(cmp.cost_reduction_pct)}% ${isSavings ? "saved" : "added"}`;
    deltaPill.className = `model-pill tabular-nums ${isSavings ? "pill-allowed" : "pill-blocked"}`;

    // Compression ratio bar
    const compBar = document.getElementById("viz-comp-bar");
    const compVal = document.getElementById("viz-comp-val");
    if (sc.hit) {
      compBar.style.transform = "scaleX(0)";
      compVal.textContent = "0 tok (Cache hit short-circuit)";
    } else if (Number(comp.tokens_before || 0) > 0) {
      const keptFrac = Math.min(1, comp.tokens_after / comp.tokens_before);
      const dropPct = ((1 - keptFrac) * 100).toFixed(1);
      compBar.style.transform = `scaleX(${keptFrac.toFixed(4)})`;
      compVal.textContent = `${fmtInt(comp.tokens_after)} / ${fmtInt(comp.tokens_before)} tok (-${dropPct}%)`;
    } else {
      compBar.style.transform = "scaleX(1)";
      compVal.textContent = "Not compressed";
    }

    // Stacked Token Composition Bars
    const dTok = direct.token_accounting;
    const gTok = gw.token_accounting;
    const dGrand = Number(dTok.grand_total_billed_tokens || 0);
    const gGrand = Number(gTok.grand_total_billed_tokens || 0);
    const maxTok = Math.max(dGrand, gGrand, 1);

    const overheadTok =
      Number(gTok.embedding_overhead_tokens || 0) +
      Number(gTok.pruning_summarizer_overhead_tokens || 0);

    document.getElementById("viz-tok-direct-val").textContent = `${fmtInt(dGrand)} tokens`;
    document.getElementById("viz-tok-gw-val").textContent = `${fmtInt(gGrand)} tokens`;

    const pct = (v) => `${Math.max(0, (Number(v || 0) / maxTok) * 100).toFixed(2)}%`;
    document.getElementById("viz-tok-direct-prompt").style.width = pct(dTok.prompt_tokens);
    document.getElementById("viz-tok-direct-out").style.width = pct(dTok.candidate_tokens);
    document.getElementById("viz-tok-direct-think").style.width = pct(dTok.thinking_tokens);

    document.getElementById("viz-tok-gw-prompt").style.width = pct(gTok.prompt_tokens);
    document.getElementById("viz-tok-gw-out").style.width = pct(gTok.candidate_tokens);
    document.getElementById("viz-tok-gw-think").style.width = pct(gTok.thinking_tokens);
    document.getElementById("viz-tok-gw-overhead").style.width = pct(overheadTok);
  }

  function updateTab2Visuals(g, fv) {
    resetPipeSvg("t2-pipeline-svg");
    const statusPill = document.getElementById("t2-pipe-status");
    const faultLow = String(g.fault_name || "").toLowerCase();
    const blockedAtPtl = g.blocked && (faultLow.includes("prompt") || Number((g.token_usage || {}).total_tokens || 0) === 0);

    setNodeState("t2-node-client", "state-active");
    setEdgeState("t2-edge-1", blockedAtPtl ? "edge-alert" : "edge-active");

    if (blockedAtPtl) {
      setNodeState("t2-node-ptl", "state-alert", "t2-sub-ptl", `BLOCKED ${g.http_status_code}`);
      setNodeState("t2-node-llm", "state-bypass", "t2-sub-llm", "Skipped (0 tok)");
      setNodeState("t2-node-ltq", "state-bypass", "t2-sub-ltq", "Skipped");
      if (statusPill) {
        statusPill.textContent = "ARRESTED AT PRE-FLIGHT (PTL)";
        statusPill.className = "model-pill pill-blocked";
      }
    } else if (g.blocked) {
      setNodeState("t2-node-ptl", "state-savings", "t2-sub-ptl", "Passed");
      setEdgeState("t2-edge-2", "edge-active");
      setNodeState("t2-node-llm", "state-amber", "t2-sub-llm", "Ran inference");
      setEdgeState("t2-edge-3", "edge-alert");
      setNodeState("t2-node-ltq", "state-alert", "t2-sub-ltq", `QUOTA ${g.http_status_code}`);
      if (statusPill) {
        statusPill.textContent = "BLOCKED BY QUOTA (LTQ)";
        statusPill.className = "model-pill pill-blocked";
      }
    } else {
      setNodeState("t2-node-ptl", "state-savings", "t2-sub-ptl", "Within spike cap");
      setEdgeState("t2-edge-2", "edge-savings");
      setNodeState("t2-node-llm", "state-savings", "t2-sub-llm", `${fmtInt((g.token_usage || {}).total_tokens || 0)} tok`);
      setEdgeState("t2-edge-3", "edge-savings");
      setNodeState("t2-node-ltq", "state-savings", "t2-sub-ltq", "Within budget");
      if (statusPill) {
        statusPill.textContent = "ALLOWED (WITHIN LIMITS)";
        statusPill.className = "model-pill pill-allowed";
      }
    }

    // Rolling Quota Fuel Gauge
    const used = fv.ltq_used_count !== null && fv.ltq_used_count !== undefined ? Number(fv.ltq_used_count) : null;
    const allowed = Number(fv.ltq_allowed_count || document.getElementById("tg-quota-limit").value || 500);
    const rem = fv.ltq_available_count !== null && fv.ltq_available_count !== undefined ? Number(fv.ltq_available_count) : null;
    const pct = used !== null && allowed > 0 ? Math.min(100, (used / allowed) * 100) : g.blocked && !blockedAtPtl ? 100 : 0;

    const fillEl = document.getElementById("t2-quota-fill");
    const pctEl = document.getElementById("t2-quota-pct");
    const pbEl = document.getElementById("t2-quota-progressbar");
    if (fillEl) {
      fillEl.style.transform = `scaleX(${(pct / 100).toFixed(4)})`;
      fillEl.className = "quota-fill" + (pct >= 100 || (g.blocked && !blockedAtPtl) ? " level-alert" : pct >= 75 ? " level-warn" : "");
    }
    if (pbEl) pbEl.setAttribute("aria-valuenow", String(Math.round(pct)));
    if (pctEl) {
      pctEl.textContent = used !== null ? `${pct.toFixed(0)}% used` : blockedAtPtl ? "Pre-flight block" : "—";
      pctEl.className = `model-pill tabular-nums ${pct >= 100 || g.blocked ? "pill-blocked" : pct >= 75 ? "pill-deploying" : "pill-allowed"}`;
    }
    document.getElementById("t2-quota-used-label").textContent =
      `Consumed: ${used !== null ? fmtInt(used) : "—"} / ${fmtInt(allowed)} tokens`;
    document.getElementById("t2-quota-rem-label").textContent =
      `Remaining: ${rem !== null ? fmtInt(rem) : "—"} tokens`;
  }

  function updateTab3Pipeline(g) {
    resetPipeSvg("t3-pipeline-svg");
    const statusPill = document.getElementById("t3-pipe-status");
    const faultLow = String(g.fault_name || "").toLowerCase();
    const blockedPost = g.blocked && (faultLow.includes("response") || Number((g.token_usage || {}).total_tokens || 0) > 0);
    const blockedPre = g.blocked && !blockedPost;

    setNodeState("t3-node-client", "state-active");
    if (blockedPre) {
      setEdgeState("t3-edge-1", "edge-alert");
      setNodeState("t3-node-sup", "state-alert", "t3-sub-sup", `BLOCKED ${g.http_status_code}`);
      setNodeState("t3-node-llm", "state-bypass", "t3-sub-llm", "0 LLM tokens");
      setNodeState("t3-node-smr", "state-bypass", "t3-sub-smr", "Skipped");
      setNodeState("t3-node-out", "state-bypass", "t3-sub-out", "Protected");
      if (statusPill) {
        statusPill.textContent = "BLOCKED PRE-INFERENCE (0 LLM TOKENS)";
        statusPill.className = "model-pill pill-blocked";
      }
    } else if (blockedPost) {
      setEdgeState("t3-edge-1", "edge-savings");
      setNodeState("t3-node-sup", "state-savings", "t3-sub-sup", "Prompt clean");
      setEdgeState("t3-edge-2", "edge-active");
      setNodeState("t3-node-llm", "state-amber", "t3-sub-llm", "Unsafe reply");
      setEdgeState("t3-edge-3", "edge-alert");
      setNodeState("t3-node-smr", "state-alert", "t3-sub-smr", `BLOCKED ${g.http_status_code}`);
      setNodeState("t3-node-out", "state-bypass", "t3-sub-out", "Redacted");
      if (statusPill) {
        statusPill.textContent = "BLOCKED OUTBOUND BY SMR";
        statusPill.className = "model-pill pill-blocked";
      }
    } else {
      setEdgeState("t3-edge-1", "edge-savings");
      setNodeState("t3-node-sup", "state-savings", "t3-sub-sup", "Prompt clean");
      setEdgeState("t3-edge-2", "edge-savings");
      setNodeState("t3-node-llm", "state-savings", "t3-sub-llm", `${fmtInt((g.token_usage || {}).total_tokens || 0)} tok`);
      setEdgeState("t3-edge-3", "edge-savings");
      setNodeState("t3-node-smr", "state-savings", "t3-sub-smr", "Response clean");
      setEdgeState("t3-edge-4", "edge-savings");
      setNodeState("t3-node-out", "state-savings", "t3-sub-out", "HTTP 200");
      if (statusPill) {
        statusPill.textContent = "PASSED MODEL ARMOR";
        statusPill.className = "model-pill pill-allowed";
      }
    }
  }

  function syncTab4PipelineLabels() {
    resetPipeSvg("t4-pipeline-svg");
    const isNc = state.tab4Submode === "native-cache";
    const tPre = document.getElementById("t4-title-pre");
    const sPre = document.getElementById("t4-sub-pre");
    const tPost = document.getElementById("t4-title-post");
    const sPost = document.getElementById("t4-sub-post");
    if (tPre) tPre.textContent = isNc ? "SCL-CacheLookup" : "PreFlow Passthrough";
    if (sPre) sPre.textContent = isNc ? "Vector Search cos" : "Enterprise route";
    if (tPost) tPost.textContent = isNc ? "SCP-CachePopulate" : "SG-EnterpriseDomain";
    if (sPost) sPost.textContent = isNc ? "Index embedding" : "Domain rule check";
    const statusPill = document.getElementById("t4-pipe-status");
    if (statusPill) {
      statusPill.textContent = isNc ? "READY — Native Vector Cache mode" : "READY — Semantic Governance mode";
      statusPill.className = "model-pill";
    }
  }

  function updateTab4Pipeline(g, fv) {
    resetPipeSvg("t4-pipeline-svg");
    const statusPill = document.getElementById("t4-pipe-status");
    const isNc = state.tab4Submode === "native-cache";
    const cacheHit = isNc && !g.blocked && Boolean(fv.scl_cache_hit);

    setNodeState("t4-node-client", "state-active");
    setEdgeState("t4-edge-1", "edge-active");

    if (cacheHit) {
      setNodeState("t4-node-pre", "state-savings", "t4-sub-pre", "CACHE HIT");
      setEdgeState("t4-edge-hit", "edge-savings");
      setNodeState("t4-node-llm", "state-bypass", "t4-sub-llm", "Short-circuited");
      setNodeState("t4-node-post", "state-bypass", "t4-sub-post", "Skipped");
      setNodeState("t4-node-out", "state-savings", "t4-sub-out", "0 LLM tokens");
      if (statusPill) {
        statusPill.textContent = "NATIVE VECTOR CACHE HIT";
        statusPill.className = "model-pill pill-allowed";
      }
    } else if (g.blocked) {
      setNodeState("t4-node-pre", "state-active", "t4-sub-pre", "Forwarded");
      setEdgeState("t4-edge-2", "edge-active");
      setNodeState("t4-node-llm", "state-amber", "t4-sub-llm", "Off-domain reply");
      setEdgeState("t4-edge-3", "edge-alert");
      setNodeState("t4-node-post", "state-alert", "t4-sub-post", `BLOCKED ${g.http_status_code}`);
      setNodeState("t4-node-out", "state-bypass", "t4-sub-out", "Intercepted");
      if (statusPill) {
        statusPill.textContent = `BLOCKED BY POLICY (HTTP ${g.http_status_code})`;
        statusPill.className = "model-pill pill-blocked";
      }
    } else {
      setNodeState("t4-node-pre", "state-active", "t4-sub-pre", isNc ? "Cache MISS" : "Forwarded");
      setEdgeState("t4-edge-2", "edge-active");
      setNodeState("t4-node-llm", "state-savings", "t4-sub-llm", `${fmtInt((g.token_usage || {}).total_tokens || 0)} tok`);
      setEdgeState("t4-edge-3", "edge-savings");
      setNodeState("t4-node-post", "state-savings", "t4-sub-post", isNc ? "Indexed vector" : "Compliant");
      setEdgeState("t4-edge-4", "edge-savings");
      setNodeState("t4-node-out", "state-savings", "t4-sub-out", "HTTP 200");
      if (statusPill) {
        statusPill.textContent = isNc ? "CACHE MISS → INDEXED" : "COMPLIANT (ALLOWED)";
        statusPill.className = "model-pill pill-allowed";
      }
    }
  }

  const NOUL_HEAD_TITLES = {
    hallucinated_or_contradicts_context: "1. Context Contradiction",
    missed_user_constraint: "2. Missed User Constraint",
    superficial_or_unproven: "3. Superficial / Unproven",
    internal_contradiction: "4. Internal Contradiction",
    hedging_or_refusal: "5. Hedging or Refusal",
  };

  function syncNoulThresholdLines() {
    const input = document.getElementById("s1-fire-threshold");
    const thresh = Math.min(0.99, Math.max(0.05, Number((input && input.value) || 0.70)));
    const pct = `${(thresh * 100).toFixed(1)}%`;
    document.querySelectorAll("#noul-bars-container .noul-threshold-line").forEach((line) => {
      line.style.left = pct;
    });
    const badge = document.getElementById("noul-gate-badge");
    if (badge) badge.textContent = `Gate > ${thresh.toFixed(2)}`;
    const sub = document.getElementById("t5-sub-stage2");
    if (sub && sub.textContent.startsWith("max(nouls)")) {
      sub.textContent = `max(nouls) > ${thresh.toFixed(2)}`;
    }
  }

  function renderNoulBatteryMeter(st2, fallbackThreshold) {
    const container = document.getElementById("noul-bars-container");
    const verdictPill = document.getElementById("noul-verdict-pill");
    const gateBadge = document.getElementById("noul-gate-badge");
    if (!container) return;

    const thresh = Number(st2.fire_threshold !== undefined ? st2.fire_threshold : fallbackThreshold || 0.70);
    const threshPct = `${Math.min(98, Math.max(2, thresh * 100)).toFixed(1)}%`;
    if (gateBadge) gateBadge.textContent = `Gate > ${thresh.toFixed(2)}`;

    if (!st2.executed) {
      if (verdictPill) {
        verdictPill.textContent = "SKIPPED (DIRECT PRO FAST-TRACK)";
        verdictPill.className = "model-pill pill-deploying";
      }
      container.querySelectorAll(".noul-bar-fill").forEach((bar) => {
        bar.style.transform = "scaleX(0)";
        bar.classList.remove("is-fired");
      });
      container.querySelectorAll(".noul-prob-val").forEach((v) => (v.textContent = "—"));
      container.querySelectorAll(".noul-tag").forEach((t) => {
        t.textContent = "SKIP";
        t.className = "noul-tag";
      });
      syncNoulThresholdLines();
      return;
    }

    if (verdictPill) {
      verdictPill.textContent = st2.any_flag_fired
        ? `FIRED (max=${Number(st2.max_noul_value || 0).toFixed(2)}) → L2 PRO`
        : `ALL CLEAR (max=${Number(st2.max_noul_value || 0).toFixed(2)}) → L1`;
      verdictPill.className = `model-pill tabular-nums ${st2.any_flag_fired ? "pill-blocked" : "pill-allowed"}`;
    }

    const rows = st2.noul_battery_table || [];
    const rowsHtml = rows
      .map((row, idx) => {
        const prob = Math.min(1, Math.max(0, Number(row.probability || 0)));
        const scaleVal = prob.toFixed(4);
        const fired = Boolean(row.fired);
        const title = NOUL_HEAD_TITLES[row.question] || `${idx + 1}. ${row.question}`;
        return `
          <div class="noul-row">
            <div class="noul-head-label">${escapeHtml(title)}<span class="noul-head-code">${escapeHtml(row.question)}</span></div>
            <div class="noul-bar-track">
              <div class="noul-bar-fill ${fired ? "is-fired" : ""}" data-target-scale="${scaleVal}"></div>
              <div class="noul-threshold-line" style="left: ${threshPct};"></div>
            </div>
            <div class="noul-prob-cell">
              <span class="noul-prob-val">${prob.toFixed(4)}</span>
              <span class="noul-tag ${fired ? "noul-tag-fired" : "noul-tag-clear"}">${fired ? "FIRES" : "CLEAR"}</span>
            </div>
          </div>
        `;
      })
      .join("");

    const holProb = Math.min(1, Math.max(0, Number(st2.holistic_escalate_judge || 0)));
    const holFired = holProb > thresh;
    const holMissed = Boolean(st2.any_flag_fired) && !holFired;
    const holTagClass = holFired ? "noul-tag-fired" : holMissed ? "noul-tag-missed" : "noul-tag-clear";
    const holTagText = holFired ? "FIRES" : holMissed ? "MISSED" : "CLEAR";
    const holisticHtml = `
      <div class="noul-row noul-row-holistic" id="noul-holistic-row">
        <div class="noul-head-label">Holistic Single-Judge (Reference)<span class="noul-head-code">__overall__::holistic_escalate_judge</span></div>
        <div class="noul-bar-track">
          <div class="noul-bar-fill is-holistic" id="noul-holistic-fill" data-target-scale="${holProb.toFixed(4)}"></div>
          <div class="noul-threshold-line" style="left: ${threshPct};"></div>
        </div>
        <div class="noul-prob-cell">
          <span class="noul-prob-val" id="noul-holistic-val">${holProb.toFixed(4)}</span>
          <span class="noul-tag ${holTagClass}" id="noul-holistic-tag">${holTagText}</span>
        </div>
      </div>
    `;

    container.innerHTML = rowsHtml + holisticHtml;
    requestAnimationFrame(() => {
      container.querySelectorAll(".noul-bar-fill[data-target-scale]").forEach((bar) => {
        bar.style.transform = `scaleX(${bar.dataset.targetScale})`;
      });
    });
  }

  function updateTab5Visuals(data, fireThreshold) {
    const d = data.direct_baseline || {};
    const g = data.apigee_gateway || {};
    const cmp = data.comparison || {};
    const st1 = g.stage1_jev || {};
    const st2 = g.stage2_jev || {};

    // 1. Live Pipeline
    resetPipeSvg("t5-pipeline-svg");
    const statusPill = document.getElementById("t5-pipe-status");
    const isDirectPro = g.initial_routing_decision === "GEMINI_2_5_PRO";

    setNodeState("t5-node-client", "state-active");
    setEdgeState("t5-edge-1", "edge-jev");
    setNodeState(
      "t5-node-stage1",
      "state-jev",
      "t5-sub-stage1",
      `conf=${st1.target_tier_confidence !== undefined ? Number(st1.target_tier_confidence).toFixed(2) : "—"}`
    );

    if (isDirectPro) {
      setEdgeState("t5-edge-fasttrack", "edge-amber");
      setNodeState("t5-node-flash", "state-bypass", "t5-sub-flash", "Skipped");
      setNodeState("t5-node-stage2", "state-bypass", "t5-sub-stage2", "Skipped");
      setNodeState("t5-node-pro", "state-amber", "t5-sub-pro", "Direct System 2");
      if (statusPill) {
        statusPill.textContent = "STAGE 1 DIRECT PRO FAST-TRACK";
        statusPill.className = "model-pill pill-deploying";
      }
    } else if (g.escalated_to_pro) {
      setEdgeState("t5-edge-2", "edge-active");
      setNodeState("t5-node-flash", "state-amber", "t5-sub-flash", "L1 defect caught");
      setEdgeState("t5-edge-3", "edge-jev");
      setNodeState("t5-node-stage2", "state-alert", "t5-sub-stage2", `FIRES (${Number(st2.max_noul_value || 0).toFixed(2)})`);
      setEdgeState("t5-edge-4", "edge-alert");
      setNodeState("t5-node-pro", "state-savings", "t5-sub-pro", "L2 Recovered");
      if (statusPill) {
        statusPill.textContent = "STAGE 2 NOUL FIRED → L2 PRO RECOVERY";
        statusPill.className = "model-pill pill-blocked";
      }
    } else {
      setEdgeState("t5-edge-2", "edge-savings");
      setNodeState("t5-node-flash", "state-savings", "t5-sub-flash", "L1 Accepted");
      setEdgeState("t5-edge-3", "edge-jev");
      setNodeState("t5-node-stage2", "state-savings", "t5-sub-stage2", st2.executed ? "All 5 clear" : "Fast lane");
      setNodeState("t5-node-pro", "state-bypass", "t5-sub-pro", "Not invoked");
      if (statusPill) {
        const shortEngine =
          g.system1_provider === "gemini_decision_1" ? "GEMINI DECISION 1" : "TYPESAFE JEV";
        statusPill.textContent = `L1 FLASH ACCEPTED VIA ${shortEngine}`;
        statusPill.className = "model-pill pill-allowed";
      }
    }

    // 2. 5-Head Noul Battery Visual Meter
    renderNoulBatteryMeter(st2, fireThreshold);

    // 3. System 2 Direct vs Jev Cascade Cost Bar
    const dCost = Number((d.cost_accounting || {}).total_cost_usd || 0);
    const gCost = Number((g.cost_accounting || {}).total_cost_usd || 0);
    const maxCost = Math.max(dCost, gCost, 0.000001);
    const costSaved = Number(cmp.cost_saved_usd || 0);
    const isSavings = costSaved >= 0;

    document.getElementById("s1-viz-direct-val").textContent = fmtUsd(dCost, 6);
    document.getElementById("s1-viz-gw-val").textContent = fmtUsd(gCost, 6);
    document.getElementById("s1-viz-direct-bar").style.transform = `scaleX(${Math.max(dCost > 0 ? 0.02 : 0, dCost / maxCost).toFixed(4)})`;
    const s1GwBar = document.getElementById("s1-viz-gw-bar");
    s1GwBar.style.transform = `scaleX(${Math.max(gCost > 0 ? 0.02 : 0, gCost / maxCost).toFixed(4)})`;
    s1GwBar.className = `viz-fill viz-fill-scale ${isSavings ? "viz-fill-savings" : "viz-fill-alert"}`;

    const s1DeltaPill = document.getElementById("s1-viz-delta-pill");
    s1DeltaPill.textContent = `${isSavings ? "-" : "+"}${Math.abs(Number(cmp.cost_reduction_pct || 0))}% ${isSavings ? "saved" : "added"}`;
    s1DeltaPill.className = `model-pill tabular-nums ${isSavings ? "pill-allowed" : "pill-blocked"}`;
  }

  // Primary Multi-Tab Navigation + Dynamic Topbar Context
  const STAGE_HEADERS = {
    "main-tab-economics": {
      title: "Token Cost & AI Optimization",
      subtitle: "Live Direct Vertex AI vs. Apigee X Gateway — Cache, Compress, Route & Prune",
    },
    "main-tab-token-finops": {
      title: "Token Quotas & FinOps",
      subtitle: "Native Apigee X ExtractVariables + Quota / SpikeArrest circuit breakers",
    },
    "main-tab-model-armor": {
      title: "Model Armor Safety",
      subtitle: "Zero-code Apigee X SanitizeUserPrompt & SanitizeModelResponse inspection",
    },
    "main-tab-semantic-gov": {
      title: "Semantic Cache & Safety",
      subtitle: "Native Apigee X SemanticCacheLookup / Populate + Vertex AI Vector Search",
    },
    "main-tab-system1-jev": {
      title: "System 1 / System 2 Routing",
      subtitle: "Pure Apigee X ServiceCallout pre-router & post-verifier (Gemini Decision 1 / TypeSafe Jev)",
    },
    "main-tab-mcp-gov": {
      title: "MCP Tool Governance",
      subtitle: "Native Apigee X JSON-RPC 2.0 RBAC Allowlist + Model Armor Indirect Prompt Injection Shield",
    },
    "main-tab-resilient": {
      title: "429 Failover & OpenAI Facade",
      subtitle: "Drop-in OpenAI SDK compatibility, automatic 429 multi-region failover & Canary routing in Apigee X",
    },
    "main-tab-pii-vault": {
      title: "Reversible PII Vault & SSE",
      subtitle: "Zero raw PII reaches Vertex AI — Apigee X tokenizes pre-LLM and rehydrates authorized responses",
    },
  };

  document.querySelectorAll(".primary-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".primary-tab-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      const targetId = btn.dataset.maintab;
      const meta = STAGE_HEADERS[targetId];
      if (meta) {
        const elTitle = document.getElementById("stage-active-title");
        const elSub = document.getElementById("stage-active-subtitle");
        if (elTitle) elTitle.textContent = meta.title;
        if (elSub) elSub.textContent = meta.subtitle;
      }
      [
        "main-tab-economics",
        "main-tab-token-finops",
        "main-tab-model-armor",
        "main-tab-semantic-gov",
        "main-tab-system1-jev",
        "main-tab-mcp-gov",
        "main-tab-resilient",
        "main-tab-pii-vault",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          const isTarget = id === targetId;
          el.style.display = isTarget ? "block" : "none";
          el.classList.toggle("is-active-panel", isTarget);
        }
      });
      if (targetId === "main-tab-semantic-gov") {
        refreshVectorSearchStatus();
      }
    });
  });

  // Sync toggle cards & header tags (Tabs 1, 3, and 5)
  function syncToggleUI() {
    const map = [
      { input: elToggleCache, cardId: "card-toggle-cache", header: "X-Opt-Cache" },
      { input: elToggleCompress, cardId: "card-toggle-compress", header: "X-Opt-Compress" },
      { input: elToggleRoute, cardId: "card-toggle-route", header: "X-Opt-Route" },
      { input: elTogglePrune, cardId: "card-toggle-prune", header: "X-Opt-Prune" },
    ];
    map.forEach((item) => {
      const card = document.getElementById(item.cardId);
      if (!card || !item.input) return;
      const tag = card.querySelector(".toggle-header-tag");
      const on = item.input.checked;
      card.classList.toggle("enabled", on);
      if (tag) tag.textContent = `${item.header}: ${on ? "true" : "false"}`;
    });
  }

  function syncPolicySwitches() {
    const pairs = [
      { inputId: "ma-enable-prompt", cardId: "card-ma-prompt" },
      { inputId: "ma-enable-response", cardId: "card-ma-response" },
      { inputId: "s1-enable-fast-track", cardId: "s1-card-fast-track" },
      { inputId: "s1-enable-verifier", cardId: "s1-card-verifier" },
    ];
    pairs.forEach(({ inputId, cardId }) => {
      const input = document.getElementById(inputId);
      const card = document.getElementById(cardId);
      if (input && card) {
        card.classList.toggle("enabled", input.checked);
      }
    });

    const defectInput = document.getElementById("s1-simulate-defect");
    const defectCard = document.getElementById("s1-card-defect");
    if (defectInput && defectCard) {
      const active = defectInput.checked;
      defectCard.classList.toggle("enabled", active);
      defectCard.classList.toggle("toggle-card-danger", active);
      const tag = defectCard.querySelector(".toggle-header-tag");
      if (tag) tag.textContent = `simulate_l1_defect: ${active ? "true" : "false"}`;
    }
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
    const elLedgerTokPct = document.getElementById("ledger-token-pct");
    elLedgerTokPct.textContent =
      tokPct !== null ? `${tokSaved >= 0 ? "-" : "+"}${Math.abs(tokPct)}%` : "—";
    setDeltaClass(elLedgerTokPct, tokPct === null ? null : tokSaved >= 0);
    document.getElementById("ledger-tokens-saved").textContent =
      `${fmtInt(Math.abs(tokSaved))} net tokens ${tokSaved >= 0 ? "saved" : "added"}`;

    const costSaved = L.directCostUsd - L.gatewayCostUsd;
    const costPct = L.directCostUsd > 0 ? ((costSaved / L.directCostUsd) * 100).toFixed(1) : null;
    const elLedgerCostPct = document.getElementById("ledger-cost-pct");
    const elHeroSession = document.getElementById("hero-t1-session-saved");
    if (elHeroSession) {
      elHeroSession.textContent = `${fmtUsd(Math.max(0, costSaved), 6)} (${costPct}%)`;
    }
    elLedgerCostPct.textContent =
      costPct !== null ? `${costSaved >= 0 ? "-" : "+"}${Math.abs(costPct)}%` : "—";
    setDeltaClass(elLedgerCostPct, costPct === null ? null : costSaved >= 0);
    document.getElementById("ledger-cost-saved").textContent =
      `${fmtUsd(Math.abs(costSaved), 6)} net ${costSaved >= 0 ? "saved" : "added"}`;

    updateAnnualProjectionUI();
  }

  function updateAnnualProjectionUI() {
    const millionsPerMonth = Number(elScaleSlider.value || 10);
    document.getElementById("scale-slider-label").textContent =
      `At ${millionsPerMonth}M requests/month (${millionsPerMonth * 12}M/yr)`;

    const L = state.sessionLedger;
    const elAnnual = document.getElementById("ledger-annual-savings");
    const elAnnualCell = document.getElementById("ledger-annual-cell");
    if (L.runs === 0) {
      elAnnual.textContent = "$0 / yr";
      setDeltaClass(elAnnual, null);
      if (elAnnualCell) elAnnualCell.classList.remove("ledger-cell-alert");
      return;
    }
    const avgSavedPerReq = (L.directCostUsd - L.gatewayCostUsd) / L.runs;
    const annualSaved = avgSavedPerReq * (millionsPerMonth * 1_000_000) * 12;
    elAnnual.textContent = `${annualSaved < 0 ? "-" : ""}${fmtCurrencyLarge(Math.abs(annualSaved))} / yr`;
    setDeltaClass(elAnnual, annualSaved >= 0);
    if (elAnnualCell) elAnnualCell.classList.toggle("ledger-cell-alert", annualSaved < 0);
  }

  // Select a preset scenario (Tab 1)
  function selectScenario(scen) {
    state.activeScenario = scen;
    document.querySelectorAll("#scenario-list .scenario-item").forEach((el) => {
      const isSelected = el.dataset.id === scen.id;
      el.classList.toggle("active", isSelected);
      el.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });

    elActiveScenarioMeta.textContent = scen.subtitle || `${cleanScenarioLabel(scen.title)} · ${scen.optimization_focus}`;
    elPresenterNote.innerHTML = `<strong>Presenter Note (${escapeHtml(scen.optimization_focus)}):</strong> ${escapeHtml(scen.presenter_note)}`;

    elInputSystem.value = scen.system_instruction || "";
    elInputRag.value = scen.rag_context || "";
    elInputHistory.value = JSON.stringify(scen.conversation_history || [], null, 2);
    elInputPrompt.value = scen.user_prompt || "";

    updateComposerCounters();

    elToggleCache.checked = Boolean(scen.recommended_toggles.semantic_cache);
    elToggleCompress.checked = Boolean(scen.recommended_toggles.prompt_compression);
    elToggleRoute.checked = Boolean(scen.recommended_toggles.model_routing);
    elTogglePrune.checked = Boolean(scen.recommended_toggles.context_pruning);
    syncToggleUI();
  }

  function cleanScenarioLabel(title) {
    return String(title || "").replace(/^\s*(?:Scenario\s*)?\d+\s*[.:)\-]\s*/i, "").trim();
  }

  function renderScenarioList() {
    elScenarioList.innerHTML = "";
    state.scenarios.forEach((scen) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scenario-item";
      btn.setAttribute("aria-pressed", "false");
      btn.dataset.id = scen.id;
      btn.innerHTML = `
        <div>
          <div class="scenario-item-title">${escapeHtml(cleanScenarioLabel(scen.title))}</div>
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
    setPipeRunning("t1-pipeline-svg", true);
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
      compression_target_ratio: scen.compression_target_ratio || 0.55,
      similarity_threshold: scen.similarity_threshold || 0.85,
    };

    try {
      const resp = await apiFetch(`/api/compare`, {
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
      setPipeRunning("t1-pipeline-svg", false);
      elBtnExecute.disabled = false;
      elBtnRunSequence.disabled = false;
    }
  }

  function renderComparisonResult(data) {
    const direct = data.direct_baseline;
    const gw = data.apigee_gateway;
    const cmp = data.comparison;

    updateTab1Pipeline(gw);
    updateTab1Visuals(data);

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
    const elGwTokDelta = document.getElementById("gateway-token-delta");
    elGwTokDelta.textContent =
      `${tokSign}${Math.abs(cmp.token_reduction_pct)}% (${fmtInt(Math.abs(cmp.tokens_saved))} ${cmp.tokens_saved >= 0 ? "saved" : "added"})`;
    setDeltaClass(elGwTokDelta, cmp.tokens_saved >= 0);

    document.getElementById("gateway-total-cost").textContent = fmtUsd(
      gw.cost_accounting.total_cost_usd,
      6
    );
    const costSign = cmp.cost_saved_usd >= 0 ? "-" : "+";
    const elGwCostDelta = document.getElementById("gateway-cost-delta");
    elGwCostDelta.textContent =
      `${costSign}${Math.abs(cmp.cost_reduction_pct)}% (${fmtUsd(Math.abs(cmp.cost_saved_usd), 6)} ${cmp.cost_saved_usd >= 0 ? "saved" : "added"})`;
    setDeltaClass(elGwCostDelta, cmp.cost_saved_usd >= 0);
    popMetric(elGwCostDelta);
    popMetric(document.getElementById("gateway-total-cost"));

    // Update Keynote Hero Outcome Band (Tab 1)
    const elH1Sav = document.getElementById("hero-t1-savings");
    const elH1SavSub = document.getElementById("hero-t1-savings-sub");
    const elH1Tok = document.getElementById("hero-t1-tokens");
    const elH1TokSub = document.getElementById("hero-t1-tokens-sub");
    const elH1Route = document.getElementById("hero-t1-route");
    const elH1RouteSub = document.getElementById("hero-t1-route-sub");
    if (elH1Sav) {
      elH1Sav.textContent = `${costSign}${Math.abs(cmp.cost_reduction_pct)}%`;
      elH1Sav.className = `hero-kpi-value ${cmp.cost_saved_usd >= 0 ? "tone-savings" : "tone-alert"}`;
      popMetric(elH1Sav);
    }
    if (elH1SavSub) {
      elH1SavSub.textContent = `${fmtUsd(gw.cost_accounting.total_cost_usd, 6)} via Apigee vs. ${fmtUsd(direct.cost_accounting.total_cost_usd, 6)} Direct`;
    }
    if (elH1Tok) {
      elH1Tok.textContent = `${tokSign}${Math.abs(cmp.token_reduction_pct)}%`;
      popMetric(elH1Tok);
    }
    if (elH1TokSub) {
      elH1TokSub.textContent = `${fmtInt(gw.token_accounting.grand_total_billed_tokens)} vs. ${fmtInt(direct.token_accounting.grand_total_billed_tokens)} tokens`;
    }
    if (elH1Route) {
      const hit = Boolean(gw.optimizations && gw.optimizations.semantic_cache && gw.optimizations.semantic_cache.hit);
      elH1Route.textContent = hit ? `${fmtInt(gw.latency_ms)} ms` : (gw.model_used || "Gemini").replace("gemini-", "");
      popMetric(elH1Route);
    }
    if (elH1RouteSub) {
      elH1RouteSub.textContent = `Apigee ${fmtInt(gw.latency_ms)} ms vs. Direct ${fmtInt(direct.latency_ms)} ms`;
    }

    // Update Tab 1 Live Race Strip
    const r1dCost = Number(direct.cost_accounting.total_cost_usd || 0);
    const r1gCost = Number(gw.cost_accounting.total_cost_usd || 0);
    const r1Max = Math.max(r1dCost, r1gCost, 0.000001);
    const r1dBar = document.getElementById("t1-race-direct-bar");
    const r1gBar = document.getElementById("t1-race-gw-bar");
    const r1dLbl = document.getElementById("t1-race-direct-label");
    const r1gLbl = document.getElementById("t1-race-gw-label");
    if (r1dBar) r1dBar.style.transform = `scaleX(${Math.max(0.06, r1dCost / r1Max).toFixed(4)})`;
    if (r1gBar) r1gBar.style.transform = `scaleX(${Math.max(0.03, r1gCost / r1Max).toFixed(4)})`;
    if (r1dLbl) r1dLbl.textContent = `${fmtUsd(r1dCost, 6)} · ${fmtInt(direct.latency_ms)} ms`;
    if (r1gLbl) r1gLbl.textContent = `${fmtUsd(r1gCost, 6)} · ${fmtInt(gw.latency_ms)} ms`;

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
              Lookup Latency: <code>${fmtInt(sc.latency_ms)} ms</code>
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
                  ? `<div class="summary-preview-wrap"><strong>Generated Rolling State Summary:</strong><div class="code-block code-block-compact">${escapeHtml(cp.summary_generated)}</div></div>`
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
      const resp = await apiFetch(`/api/reset`, { method: "POST" });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }
      state.sessionLedger = {
        runs: 0,
        directTokens: 0,
        gatewayTokens: 0,
        directCostUsd: 0.0,
        gatewayCostUsd: 0.0,
      };
      updateSessionLedgerUI();

      // Reset Tab 1 live pipeline and visual telemetry charts
      resetPipeSvg("t1-pipeline-svg");
      setNodeState("t1-node-cache", null, "t1-sub-cache", "cos ≥ 0.85");
      setNodeState("t1-node-compress", null, "t1-sub-compress", "ratio 0.55");
      setNodeState("t1-node-prune", null, "t1-sub-prune", "≥ 800 tok");
      setNodeState("t1-node-router", null, "t1-sub-router", "score ≥ 0.55");
      setNodeState("t1-node-llm", null, "t1-sub-llm", "Gemini 2.5");
      const t1PipePill = document.getElementById("t1-pipe-status");
      if (t1PipePill) {
        t1PipePill.textContent = "READY — Run a scenario to illuminate active hops";
        t1PipePill.className = "model-pill";
      }
      ["viz-cost-direct-bar", "viz-cost-gw-bar", "viz-comp-bar"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.transform = "scaleX(0)";
      });
      [
        "viz-tok-direct-prompt",
        "viz-tok-direct-out",
        "viz-tok-direct-think",
        "viz-tok-gw-prompt",
        "viz-tok-gw-out",
        "viz-tok-gw-think",
        "viz-tok-gw-overhead",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.width = "0%";
      });
      [
        "viz-cost-direct-val",
        "viz-cost-gw-val",
        "viz-comp-val",
        "viz-tok-direct-val",
        "viz-tok-gw-val",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = "—";
      });
      const deltaPill = document.getElementById("viz-cost-delta-pill");
      if (deltaPill) {
        deltaPill.textContent = "Awaiting run";
        deltaPill.className = "model-pill tabular-nums";
      }

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
      btn.setAttribute("aria-pressed", idx === 0 ? "true" : "false");
      btn.innerHTML = `
        <div>
          <div class="scenario-item-title">${escapeHtml(cleanScenarioLabel(scen.title))}</div>
          <div class="scenario-item-sub">${escapeHtml(scen.description)}</div>
        </div>
        <span class="scenario-badge">${escapeHtml(scen.badge)}</span>
      `;
      btn.addEventListener("click", () => {
        tgList.querySelectorAll(".scenario-item").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
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
      btn.setAttribute("aria-pressed", idx === 0 ? "true" : "false");
      btn.innerHTML = `
        <div>
          <div class="scenario-item-title">${escapeHtml(cleanScenarioLabel(scen.title))}</div>
          <div class="scenario-item-sub">${escapeHtml(scen.description)}</div>
        </div>
        <span class="scenario-badge">${escapeHtml(scen.badge)}</span>
      `;
      btn.addEventListener("click", () => {
        maList.querySelectorAll(".scenario-item").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        document.getElementById("ma-prompt").value = scen.prompt;
        document.getElementById("ma-enable-prompt").checked = scen.enable_sanitize_prompt !== false;
        document.getElementById("ma-enable-response").checked = scen.enable_sanitize_response !== false;
        syncPolicySwitches();
      });
      maList.appendChild(btn);
    });
    if (maScens.length > 0) {
      document.getElementById("ma-prompt").value = maScens[0].prompt;
      document.getElementById("ma-enable-prompt").checked = maScens[0].enable_sanitize_prompt !== false;
      document.getElementById("ma-enable-response").checked = maScens[0].enable_sanitize_response !== false;
      syncPolicySwitches();
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
    const isSg = mode === "semantic-governance";
    btnSg.className = isSg ? "btn btn-segmented btn-compact active" : "btn btn-segmented btn-compact";
    btnSg.setAttribute("aria-pressed", isSg ? "true" : "false");
    btnNc.className = !isSg ? "btn btn-segmented btn-compact active" : "btn btn-segmented btn-compact";
    btnNc.setAttribute("aria-pressed", !isSg ? "true" : "false");

    const sgList = document.getElementById("sg-scenario-list");
    const scens = state.policyScenarios[mode] || [];
    sgList.innerHTML = "";
    scens.forEach((scen, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "scenario-item" + (idx === 0 ? " active" : "");
      btn.setAttribute("aria-pressed", idx === 0 ? "true" : "false");
      btn.innerHTML = `
        <div>
          <div class="scenario-item-title">${escapeHtml(cleanScenarioLabel(scen.title))}</div>
          <div class="scenario-item-sub">${escapeHtml(scen.description)}</div>
        </div>
        <span class="scenario-badge">${escapeHtml(scen.badge)}</span>
      `;
      btn.addEventListener("click", () => {
        sgList.querySelectorAll(".scenario-item").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
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
        <p>
          <strong><code>SG-EnforceEnterpriseDomain</code> (<code>enterprise-domain-guardrail</code>):</strong>
          Enforces declarative enterprise domain rules inside the Apigee Response Flow so unauthorized off-topic completions return HTTP <code>422</code>:
        </p>
        <div class="code-block code-block-compact">Rule id="enterprise-domain-guardrail":
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
        <p>
          <strong><code>SCL-NativeSemanticCacheLookup</code> &amp; <code>SCP-NativeSemanticCachePopulate</code>:</strong>
          Zero-code native Apigee X XML policies backed by <code>text-embedding-005</code> and Vertex AI Vector Search (<code>SHARD_SIZE_MEDIUM</code> / <code>e2-standard-16</code>).
        </p>
        <div class="code-block code-block-compact">Index: projects/1019413155504/locations/australia-southeast1/indexes/8419013310438965248
IndexEndpoint: projects/1019413155504/locations/australia-southeast1/indexEndpoints/3216599276826132480
Public Domain: 958897680.australia-southeast1-1019413155504.vdb.vertexai.goog</div>
      `;
    }
    syncTab4PipelineLabels();
  }

  // Execute Tab 2: Token Governance
  document.getElementById("btn-run-tg").addEventListener("click", async () => {
    const btn = document.getElementById("btn-run-tg");
    const statusEl = document.getElementById("tg-status");
    btn.disabled = true;
    setPipeRunning("t2-pipeline-svg", true);
    statusEl.textContent = "Executing Direct Vertex AI vs. Apigee X Token Governance...";
    try {
      const resp = await apiFetch(`/api/policies/execute`, {
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
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }
      const data = await resp.json();
      const d = data.direct_baseline || {};
      const g = data.apigee_gateway || {};
      const fv = g.apigee_flow_variables || {};

      document.getElementById("tg-direct-pill").textContent = `HTTP ${d.http_status_code || 200}`;
      document.getElementById("tg-direct-prompt-tok").textContent = fmtInt((d.token_usage || {}).prompt_tokens);
      document.getElementById("tg-direct-total-tok").textContent = fmtInt((d.token_usage || {}).total_tokens);
      document.getElementById("tg-direct-cost").textContent = fmtUsd(d.cost_usd, 6);
      document.getElementById("tg-direct-lat").textContent = `${fmtInt(d.latency_ms)} ms`;
      document.getElementById("tg-direct-body").textContent = d.response_text || "";

      const pill = document.getElementById("tg-gw-pill");
      const verdictEl = document.getElementById("tg-gw-verdict");
      const verdictSubEl = document.getElementById("tg-gw-verdict-sub");
      if (g.blocked) {
        pill.textContent = `BLOCKED (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-blocked";
        verdictEl.textContent = "BLOCKED";
        setDeltaClass(verdictEl, false);
        verdictSubEl.textContent = g.fault_name || "RateLimit";
        document.getElementById("tg-gw-body").textContent =
          `[APIGEE X POLICY CIRCUIT BREAKER TRIGGERED]\n` +
          `HTTP Status: ${g.http_status_code}\n` +
          `Apigee Fault Name: ${g.fault_name}\n` +
          `Reason: ${g.error_message}\n\n` +
          `Details: ${JSON.stringify(g.error_details || {}, null, 2)}`;
      } else {
        pill.textContent = `ALLOWED (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-allowed";
        verdictEl.textContent = "ALLOWED";
        setDeltaClass(verdictEl, true);
        verdictSubEl.textContent = "Within limits";
        document.getElementById("tg-gw-body").textContent = g.response_text || "";
      }
      const usedStr =
        fv.ltq_used_count !== null && fv.ltq_used_count !== undefined
          ? fmtInt(fv.ltq_used_count)
          : "—";
      const allowedVal = fv.ltq_allowed_count || document.getElementById("tg-quota-limit").value;
      document.getElementById("tg-gw-quota-used").textContent = `${usedStr} / ${fmtInt(allowedVal)}`;
      document.getElementById("tg-gw-quota-rem").textContent =
        fv.ltq_available_count !== null && fv.ltq_available_count !== undefined ? fmtInt(fv.ltq_available_count) : "—";
      document.getElementById("tg-gw-tok").textContent = fmtInt((g.token_usage || {}).total_tokens || 0);
      document.getElementById("tg-telemetry-box").textContent = JSON.stringify(g, null, 2);
      updateTab2Visuals(g, fv);
      // Update Keynote Hero Outcome Band (Tab 2)
      const h2v = document.getElementById("hero-t2-verdict");
      const h2vs = document.getElementById("hero-t2-verdict-sub");
      const h2q = document.getElementById("hero-t2-quota");
      const h2qs = document.getElementById("hero-t2-quota-sub");
      const h2c = document.getElementById("hero-t2-cost");
      const h2cs = document.getElementById("hero-t2-cost-sub");
      if (h2v) {
        h2v.textContent = g.blocked ? `HTTP ${g.http_status_code}` : "ALLOWED";
        h2v.className = `hero-kpi-value ${g.blocked ? "tone-alert" : "tone-savings"}`;
        popMetric(h2v);
      }
      if (h2vs) h2vs.textContent = g.blocked ? (g.fault_name || "Blocked by Apigee X") : "Within tenant token budget";
      if (h2q) {
        h2q.textContent = document.getElementById("t2-quota-pct").textContent;
        popMetric(h2q);
      }
      if (h2qs) h2qs.textContent = document.getElementById("t2-quota-used-label").textContent;
      if (h2c) {
        h2c.textContent = g.blocked ? "$0.0000" : fmtUsd(d.cost_usd, 6);
        popMetric(h2c);
      }
      if (h2cs) h2cs.textContent = g.blocked ? `Blocked at edge vs. ${fmtUsd(d.cost_usd, 6)} Direct` : `Direct latency ${fmtInt(d.latency_ms)} ms`;
      statusEl.textContent = `Completed at ${data.timestamp_utc}`;
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    } finally {
      setPipeRunning("t2-pipeline-svg", false);
      btn.disabled = false;
    }
  });

  // Execute Tab 3: Model Armor
  document.getElementById("btn-run-ma").addEventListener("click", async () => {
    const btn = document.getElementById("btn-run-ma");
    const statusEl = document.getElementById("ma-status");
    btn.disabled = true;
    setPipeRunning("t3-pipeline-svg", true);
    statusEl.textContent = "Executing Direct Vertex AI vs. Apigee X + Model Armor...";
    try {
      const resp = await apiFetch(`/api/policies/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_group: "model-armor",
          prompt: document.getElementById("ma-prompt").value,
          enable_sanitize_prompt: document.getElementById("ma-enable-prompt").checked,
          enable_sanitize_response: document.getElementById("ma-enable-response").checked,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }
      const data = await resp.json();
      const d = data.direct_baseline || {};
      const g = data.apigee_gateway || {};

      document.getElementById("ma-direct-pill").textContent = `HTTP ${d.http_status_code || 200}`;
      document.getElementById("ma-direct-prompt-tok").textContent = fmtInt((d.token_usage || {}).prompt_tokens);
      document.getElementById("ma-direct-total-tok").textContent = fmtInt((d.token_usage || {}).total_tokens);
      document.getElementById("ma-direct-cost").textContent = fmtUsd(d.cost_usd, 6);
      document.getElementById("ma-direct-lat").textContent = `${fmtInt(d.latency_ms)} ms`;
      document.getElementById("ma-direct-body").textContent = d.response_text || "";

      const pill = document.getElementById("ma-gw-pill");
      const verdictEl = document.getElementById("ma-gw-verdict");
      const verdictSubEl = document.getElementById("ma-gw-verdict-sub");
      const faultEl = document.getElementById("ma-gw-fault");
      const faultSubEl = document.getElementById("ma-gw-fault-sub");
      if (g.blocked) {
        pill.textContent = `BLOCKED (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-blocked";
        verdictEl.textContent = "BLOCKED";
        setDeltaClass(verdictEl, false);
        verdictSubEl.textContent = "Stopped at gateway";
        const faultStr = String(g.fault_name || "ModelArmorViolation");
        faultEl.textContent = faultStr.toLowerCase().includes("response")
          ? "Response"
          : faultStr.toLowerCase().includes("prompt")
          ? "Prompt"
          : "Violation";
        faultSubEl.textContent = faultStr;
        document.getElementById("ma-gw-body").textContent =
          `[BLOCKED BY APIGEE X + GOOGLE CLOUD MODEL ARMOR]\n` +
          `Template: projects/apac-cs-5g-demo5/locations/us-central1/templates/apigee-ai-safety-template\n` +
          `HTTP Status: ${g.http_status_code}\n` +
          `Apigee Fault: ${g.fault_name}\n` +
          `Message: ${g.error_message}\n\n` +
          `Details: ${JSON.stringify(g.error_details || {}, null, 2)}`;
      } else {
        pill.textContent = `PASSED (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-allowed";
        verdictEl.textContent = "ALLOWED";
        setDeltaClass(verdictEl, true);
        verdictSubEl.textContent = "Sanitized response";
        faultEl.textContent = "Clean";
        faultSubEl.textContent = "No violations";
        document.getElementById("ma-gw-body").textContent = g.response_text || "";
      }
      document.getElementById("ma-gw-tok").textContent = fmtInt((g.token_usage || {}).total_tokens || 0);
      document.getElementById("ma-gw-lat").textContent = `${fmtInt(g.latency_ms || g.client_observed_latency_ms)} ms`;
      document.getElementById("ma-telemetry-box").textContent = JSON.stringify(g, null, 2);
      updateTab3Pipeline(g);
      // Update Keynote Hero Outcome Band (Tab 3)
      const h3v = document.getElementById("hero-t3-verdict");
      const h3vs = document.getElementById("hero-t3-verdict-sub");
      const h3s = document.getElementById("hero-t3-stage");
      const h3ss = document.getElementById("hero-t3-stage-sub");
      const h3l = document.getElementById("hero-t3-latency");
      const h3ls = document.getElementById("hero-t3-latency-sub");
      if (h3v) {
        h3v.textContent = g.blocked ? "BLOCKED" : "SAFE";
        h3v.className = `hero-kpi-value ${g.blocked ? "tone-alert" : "tone-savings"}`;
        popMetric(h3v);
      }
      if (h3vs) h3vs.textContent = g.blocked ? "Stopped by Model Armor at Apigee X edge" : "Passed prompt & response safety inspection";
      if (h3s) {
        h3s.textContent = document.getElementById("ma-gw-fault").textContent;
        popMetric(h3s);
      }
      if (h3ss) h3ss.textContent = document.getElementById("ma-gw-fault-sub").textContent;
      if (h3l) {
        h3l.textContent = `${fmtInt(g.latency_ms || g.client_observed_latency_ms)} ms`;
        popMetric(h3l);
      }
      if (h3ls) h3ls.textContent = g.blocked ? `0 LLM tokens billed vs. ${fmtInt((d.token_usage || {}).total_tokens)} Direct` : `Direct ${fmtInt(d.latency_ms)} ms`;
      statusEl.textContent = `Completed at ${data.timestamp_utc}`;
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    } finally {
      setPipeRunning("t3-pipeline-svg", false);
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
    setPipeRunning("t4-pipeline-svg", true);
    statusEl.textContent = `Executing Apigee X (${state.tab4Submode})...`;
    try {
      const resp = await apiFetch(`/api/policies/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_group: state.tab4Submode,
          prompt: document.getElementById("sg-prompt").value,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }
      const data = await resp.json();
      const d = data.direct_baseline || {};
      const g = data.apigee_gateway || {};
      const fv = g.apigee_flow_variables || {};

      document.getElementById("sg-direct-pill").textContent = `HTTP ${d.http_status_code || 200}`;
      document.getElementById("sg-direct-prompt-tok").textContent = fmtInt((d.token_usage || {}).prompt_tokens);
      document.getElementById("sg-direct-total-tok").textContent = fmtInt((d.token_usage || {}).total_tokens);
      document.getElementById("sg-direct-cost").textContent = fmtUsd(d.cost_usd, 6);
      document.getElementById("sg-direct-lat").textContent = `${fmtInt(d.latency_ms)} ms`;
      document.getElementById("sg-direct-body").textContent = d.response_text || "";

      const pill = document.getElementById("sg-gw-pill");
      const verdictEl = document.getElementById("sg-gw-verdict");
      const verdictSubEl = document.getElementById("sg-gw-verdict-sub");
      const faultEl = document.getElementById("sg-gw-fault");
      const faultSubEl = document.getElementById("sg-gw-fault-sub");
      if (g.blocked) {
        pill.textContent = `BLOCKED (HTTP ${g.http_status_code})`;
        pill.className = "model-pill pill-blocked";
        verdictEl.textContent = "BLOCKED";
        setDeltaClass(verdictEl, false);
        verdictSubEl.textContent = "Intercepted by policy";
        faultEl.textContent = "Violation";
        faultSubEl.textContent = g.fault_name || "PolicyViolation";
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
        verdictEl.textContent = "ALLOWED";
        setDeltaClass(verdictEl, true);
        verdictSubEl.textContent = "Policy passed";
        if (state.tab4Submode === "native-cache") {
          const hit = Boolean(fv.scl_cache_hit);
          faultEl.textContent = hit ? "Cache HIT" : "Cache MISS";
          faultSubEl.textContent = hit ? "Vector short-circuit" : "Populated vector index";
        } else {
          faultEl.textContent = "Compliant";
          faultSubEl.textContent = "Domain rule verified";
        }
        document.getElementById("sg-gw-body").textContent = g.response_text || "";
      }
      document.getElementById("sg-gw-tok").textContent = fmtInt((g.token_usage || {}).total_tokens || 0);
      document.getElementById("sg-gw-lat").textContent = `${fmtInt(g.latency_ms || g.client_observed_latency_ms)} ms`;
      document.getElementById("sg-telemetry-box").textContent = JSON.stringify(g, null, 2);
      updateTab4Pipeline(g, fv);
      // Update Keynote Hero Outcome Band (Tab 4)
      const h4v = document.getElementById("hero-t4-verdict");
      const h4vs = document.getElementById("hero-t4-verdict-sub");
      const h4l = document.getElementById("hero-t4-latency");
      const h4ls = document.getElementById("hero-t4-latency-sub");
      if (h4v) {
        h4v.textContent = g.blocked ? "BLOCKED" : document.getElementById("sg-gw-fault").textContent;
        h4v.className = `hero-kpi-value ${g.blocked ? "tone-alert" : "tone-savings"}`;
        popMetric(h4v);
      }
      if (h4vs) h4vs.textContent = g.blocked ? (g.fault_name || "Policy Violation") : document.getElementById("sg-gw-fault-sub").textContent;
      if (h4l) {
        h4l.textContent = `${fmtInt(g.latency_ms || g.client_observed_latency_ms)} ms`;
        popMetric(h4l);
      }
      if (h4ls) h4ls.textContent = `Apigee X vs. ${fmtInt(d.latency_ms)} ms Direct`;

      // Update Tab 4 Projected Annual Savings (on semantic cache hits)
      const t4SavEl = document.getElementById("t4-annual-savings");
      const t4LblEl = document.getElementById("t4-scale-label");
      const millionsMo = Number((elScaleSlider && elScaleSlider.value) || 10);
      if (t4LblEl) t4LblEl.textContent = `At ${millionsMo}M req/mo`;
      if (t4SavEl) {
        const hitSaved = Boolean(fv.scl_cache_hit) ? Number(d.cost_usd || 0) : 0;
        const annual = hitSaved * (millionsMo * 1_000_000) * 12;
        t4SavEl.textContent = `${fmtCurrencyLarge(annual)} / yr`;
        popMetric(t4SavEl);
      }
      statusEl.textContent = `Completed at ${data.timestamp_utc}`;
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
    } finally {
      setPipeRunning("t4-pipeline-svg", false);
      btn.disabled = false;
    }
  });

  // Vector Search Node Status & Toggle Controls
  async function refreshVectorSearchStatus() {
    try {
      const resp = await apiFetch(`/api/vector-search/status`);
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }
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
      const resp = await apiFetch(`/api/vector-search/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "on" }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }
      const res = await resp.json();
      renderVectorSearchState(res.state);
    } catch (e) {
      document.getElementById("vs-resource-details").textContent = `Wake node error: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById("btn-vs-suspend").addEventListener("click", async () => {
    const btn = document.getElementById("btn-vs-suspend");
    btn.disabled = true;
    try {
      const resp = await apiFetch(`/api/vector-search/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "off" }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText}`);
      }
      const res = await resp.json();
      renderVectorSearchState(res.state);
    } catch (e) {
      document.getElementById("vs-resource-details").textContent = `Suspend node error: ${e.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  // Wire Event Listeners (Tab 1, 3, and 5 switches + live composer counters)
  [elToggleCache, elToggleCompress, elToggleRoute, elTogglePrune].forEach((input) => {
    if (input) input.addEventListener("change", syncToggleUI);
  });

  [
    "ma-enable-prompt",
    "ma-enable-response",
    "s1-enable-fast-track",
    "s1-enable-verifier",
    "s1-simulate-defect",
  ].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.addEventListener("change", syncPolicySwitches);
  });

  [elInputSystem, elInputRag, elInputHistory].forEach((el) => {
    if (el) el.addEventListener("input", updateComposerCounters);
  });

  function updateTab5AnnualROI() {
    const slider = document.getElementById("t5-scale-slider");
    const lbl = document.getElementById("t5-scale-label");
    const valEl = document.getElementById("t5-annual-savings");
    if (!valEl) return;
    const millionsMo = Number((slider && slider.value) || (elScaleSlider && elScaleSlider.value) || 10);
    if (lbl) lbl.textContent = `At ${millionsMo}M req/mo`;
    const perReq = Number(state.lastS1SavedPerReq || 0);
    const annual = perReq * (millionsMo * 1_000_000) * 12;
    valEl.textContent = `${annual < 0 ? "-" : ""}${fmtCurrencyLarge(Math.abs(annual))} / yr`;
    popMetric(valEl);
  }

  function initClickableNodes() {
    const nodeMap = {
      "t1-node-cache": { drawer: "details-economics", title: "Semantic Cache & Pruning Inspection", auditTab: "tab-cache-prune" },
      "t1-node-compress": { drawer: "details-economics", title: "RAG Prompt Compression Diff", auditTab: "tab-compression" },
      "t1-node-prune": { drawer: "details-economics", title: "Context Pruning & Cache Audit", auditTab: "tab-cache-prune" },
      "t1-node-router": { drawer: "details-economics", title: "Smart Model Routing Cascade", auditTab: "tab-cascade" },
      "t1-node-llm": { drawer: "details-economics", title: "Vertex AI Outputs & Raw Headers", auditTab: "tab-headers-raw" },
      "t2-node-ptl": { drawer: "details-finops", title: "Prompt Token Limit Policy & XML" },
      "t2-node-ltq": { drawer: "details-finops", title: "Rolling Token Quota Policy & XML" },
      "t3-node-sup": { drawer: "details-armor", title: "Model Armor SanitizeUserPrompt" },
      "t3-node-smr": { drawer: "details-armor", title: "Model Armor SanitizeModelResponse" },
      "t4-node-pre": { drawer: "details-semantic", title: "Native SemanticCacheLookup" },
      "t4-node-post": { drawer: "details-semantic", title: "Native SemanticCachePopulate" },
      "t5-node-stage1": { drawer: "details-system1", title: "Stage 1 System 1 Pre-Router" },
      "t5-node-stage2": { drawer: "details-system1", title: "Stage 2 Noul Quality Verifier" },
      "t6-node-rbac": { drawer: "details-mcp", title: "MCP RBAC Allowlist & JSON-RPC" },
      "t6-node-armor": { drawer: "details-mcp", title: "Model Armor Indirect Injection Scan" },
      "t7-node-facade": { drawer: "details-resilient", title: "OpenAI Facade Schema Translation" },
      "t7-node-router": { drawer: "details-resilient", title: "429 Failover & Canary Routing" },
      "t8-node-mask": { drawer: "details-pii", title: "Pre-LLM PII Tokenization Vault" },
      "t8-node-unmask": { drawer: "details-pii", title: "Reversible PII De-Tokenization" },
    };
    Object.entries(nodeMap).forEach(([nodeId, cfg]) => {
      const node = document.getElementById(nodeId);
      if (!node) return;
      node.addEventListener("click", () => {
        if (cfg.auditTab) {
          const tabBtn = document.querySelector(`.audit-tab[data-tab="${cfg.auditTab}"]`);
          if (tabBtn) tabBtn.click();
        }
        const mode = document.documentElement.getAttribute("data-view");
        if (mode === "architect") {
          const target = document.getElementById(cfg.drawer);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          openKeynoteDrawer(cfg.drawer, cfg.title);
        }
      });
    });
  }

  function initCopyCurl() {
    const btn = document.getElementById("btn-copy-curl");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const url = (document.getElementById("footer-apigee-url") || {}).textContent || "https://eval-group.34-120-155-152.nip.io/v1/ai-economics/chat";
      const promptText = ((elInputPrompt && elInputPrompt.value) || "Explain Apigee X AI Gateway benefits in 2 sentences.").replace(/"/g, '\\"');
      const curlCmd =
        `curl -sS -X POST "${url.trim()}" \\\n` +
        `  -H "Content-Type: application/json" \\\n` +
        `  -H "X-Opt-Cache: ${elToggleCache && elToggleCache.checked ? "true" : "false"}" \\\n` +
        `  -H "X-Opt-Compress: ${elToggleCompress && elToggleCompress.checked ? "true" : "false"}" \\\n` +
        `  -H "X-Opt-Route: ${elToggleRoute && elToggleRoute.checked ? "true" : "false"}" \\\n` +
        `  -H "X-Opt-Prune: ${elTogglePrune && elTogglePrune.checked ? "true" : "false"}" \\\n` +
        `  -d '{"prompt":"${promptText}"}'`;
      try {
        await navigator.clipboard.writeText(curlCmd);
        btn.textContent = "Copied curl!";
        setTimeout(() => { btn.textContent = "Copy curl"; }, 2000);
      } catch (e) {
        btn.textContent = "Copy failed";
        setTimeout(() => { btn.textContent = "Copy curl"; }, 2000);
      }
    });
  }

  function initNewEnterpriseTabs() {
    // --- TAB 6: MCP TOOL GOVERNANCE ---
    const mcpRole = document.getElementById("mcp-role-select");
    const mcpTool = document.getElementById("mcp-tool-input");
    const mcpPoison = document.getElementById("mcp-sim-poison");
    const mcpArmor = document.getElementById("mcp-enable-armor");
    const btnRunMcp = document.getElementById("btn-run-mcp");

    document.querySelectorAll("#mcp-scenario-list .scenario-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#mcp-scenario-list .scenario-item").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        const p = btn.dataset.mcpPreset;
        if (p === "safe") {
          if (mcpRole) mcpRole.value = "support-agent";
          if (mcpTool) mcpTool.value = "search_kb";
          if (mcpPoison) mcpPoison.checked = false;
        } else if (p === "forbidden") {
          if (mcpRole) mcpRole.value = "support-agent";
          if (mcpTool) mcpTool.value = "drop_production_db";
          if (mcpPoison) mcpPoison.checked = false;
        } else if (p === "poisoned") {
          if (mcpRole) mcpRole.value = "support-agent";
          if (mcpTool) mcpTool.value = "search_kb";
          if (mcpPoison) mcpPoison.checked = true;
        }
        const hTool = document.getElementById("hero-t6-tool");
        const hToolSub = document.getElementById("hero-t6-tool-sub");
        if (hTool && mcpTool) hTool.textContent = mcpTool.value;
        if (hToolSub && mcpRole) hToolSub.textContent = `Role: ${mcpRole.value}`;
      });
    });

    if (btnRunMcp) {
      btnRunMcp.addEventListener("click", async () => {
        btnRunMcp.disabled = true;
        setPipeRunning("t6-pipeline-svg", true);
        resetPipeSvg("t6-pipeline-svg");
        const statusEl = document.getElementById("mcp-status");
        const pipeBadge = document.getElementById("t6-pipe-status");
        if (pipeBadge) pipeBadge.textContent = "RUNNING";
        if (statusEl) statusEl.textContent = "Executing live JSON-RPC 2.0 MCP call through Apigee X...";
        try {
          const resp = await apiFetch("/api/mcp/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agent_role: mcpRole ? mcpRole.value : "support-agent",
              tool_name: mcpTool ? mcpTool.value.trim() : "search_kb",
              tool_arguments: { query: "VPN SSO reset" },
              simulate_poisoned_tool: Boolean(mcpPoison && mcpPoison.checked),
              enable_model_armor: Boolean(!mcpArmor || mcpArmor.checked),
            }),
          });
          const data = await resp.json();
          const blocked = Boolean(data.blocked);
          const isRbacBlock = data.http_status_code === 403;
          setNodeState("t6-node-agent", "state-active", "t6-sub-agent", mcpRole ? mcpRole.value : "agent");
          setEdgeState("t6-edge-1", isRbacBlock ? "edge-alert" : "edge-active");
          if (isRbacBlock) {
            setNodeState("t6-node-rbac", "state-alert", "t6-sub-rbac", "BLOCKED 403");
            setNodeState("t6-node-armor", "state-bypass", "t6-sub-armor", "Skipped");
            setNodeState("t6-node-llm", "state-bypass", "t6-sub-llm", "Never called");
          } else if (blocked) {
            setNodeState("t6-node-rbac", "state-savings", "t6-sub-rbac", "Allowed");
            setEdgeState("t6-edge-2", "edge-alert");
            setNodeState("t6-node-armor", "state-alert", "t6-sub-armor", `BLOCKED ${data.http_status_code}`);
            setNodeState("t6-node-llm", "state-bypass", "t6-sub-llm", "Injection stopped");
          } else {
            setNodeState("t6-node-rbac", "state-savings", "t6-sub-rbac", "Allowed");
            setEdgeState("t6-edge-2", "edge-savings");
            setNodeState("t6-node-armor", "state-savings", "t6-sub-armor", "Clean");
            setEdgeState("t6-edge-3", "edge-savings");
            setNodeState("t6-node-llm", "state-savings", "t6-sub-llm", "Executed 200");
          }

          const hv = document.getElementById("hero-t6-verdict");
          const hvs = document.getElementById("hero-t6-verdict-sub");
          const ht = document.getElementById("hero-t6-tool");
          const hts = document.getElementById("hero-t6-tool-sub");
          const hl = document.getElementById("hero-t6-lat");
          const hls = document.getElementById("hero-t6-lat-sub");
          if (hv) {
            hv.textContent = isRbacBlock ? "403 BLOCKED" : blocked ? "ARMOR BLOCK" : "ALLOWED";
            hv.className = `hero-kpi-value ${blocked ? "tone-alert" : "tone-savings"}`;
            popMetric(hv);
          }
          if (hvs) hvs.textContent = isRbacBlock ? "Blocked by Apigee X MCP RBAC Allowlist" : blocked ? "Indirect prompt injection caught by Model Armor" : "Tool authorized & scanned clean";
          if (ht && mcpTool) ht.textContent = mcpTool.value;
          if (hts && mcpRole) hts.textContent = `Role: ${mcpRole.value}`;
          if (hl) {
            hl.textContent = `${fmtInt(data.latency_ms)} ms`;
            popMetric(hl);
          }
          if (hls) hls.textContent = `HTTP ${data.http_status_code} from Apigee X`;
          if (pipeBadge) pipeBadge.textContent = blocked ? `HTTP ${data.http_status_code}` : "HTTP 200";
          if (statusEl) statusEl.textContent = `Completed at ${data.timestamp_utc}`;
          document.getElementById("mcp-req-box").textContent = JSON.stringify(data.jsonrpc_request || {}, null, 2);
          document.getElementById("mcp-resp-box").textContent = JSON.stringify(data.apigee_response || {}, null, 2);
          const pill = document.getElementById("mcp-resp-pill");
          if (pill) {
            pill.textContent = `HTTP ${data.http_status_code}`;
            pill.className = `model-pill ${blocked ? "pill-blocked" : "pill-allowed"}`;
          }
        } catch (e) {
          if (statusEl) statusEl.textContent = `Error: ${e.message}`;
        } finally {
          setPipeRunning("t6-pipeline-svg", false);
          btnRunMcp.disabled = false;
        }
      });
    }

    // --- TAB 7: 429 FAILOVER + OPENAI FACADE + CANARY ---
    const resPrompt = document.getElementById("res-prompt-input");
    const resSim429 = document.getElementById("res-sim-429");
    const resCanary = document.getElementById("res-canary-slider");
    const resCanaryLbl = document.getElementById("res-canary-label");
    const btnRunRes = document.getElementById("btn-run-res");

    if (resCanary && resCanaryLbl) {
      resCanary.addEventListener("input", () => { resCanaryLbl.textContent = `${resCanary.value}%`; });
    }

    document.querySelectorAll("#res-scenario-list .scenario-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#res-scenario-list .scenario-item").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        const p = btn.dataset.resPreset;
        if (p === "openai") {
          if (resSim429) resSim429.checked = false;
          if (resCanary) resCanary.value = "0";
        } else if (p === "failover") {
          if (resSim429) resSim429.checked = true;
          if (resCanary) resCanary.value = "0";
        } else if (p === "canary") {
          if (resSim429) resSim429.checked = false;
          if (resCanary) resCanary.value = "50";
        }
        if (resCanaryLbl && resCanary) resCanaryLbl.textContent = `${resCanary.value}%`;
      });
    });

    if (btnRunRes) {
      btnRunRes.addEventListener("click", async () => {
        btnRunRes.disabled = true;
        setPipeRunning("t7-pipeline-svg", true);
        resetPipeSvg("t7-pipeline-svg");
        const statusEl = document.getElementById("res-status");
        const pipeBadge = document.getElementById("t7-pipe-status");
        if (pipeBadge) pipeBadge.textContent = "RUNNING";
        if (statusEl) statusEl.textContent = "Sending OpenAI gpt-4o payload to Apigee X resilient facade...";
        try {
          const resp = await apiFetch("/api/resilient/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "gpt-4o",
              prompt: resPrompt ? resPrompt.value : "Explain Apigee X LLM failover.",
              simulate_429: Boolean(resSim429 && resSim429.checked),
              canary_pct: Number(resCanary ? resCanary.value : 0),
            }),
          });
          const data = await resp.json();
          const tel = (data.openai_response && data.openai_response.apigee_resilience_telemetry) || {};
          const failover = Boolean(tel.failover_triggered);
          const canary = Boolean(tel.canary_selected);

          setNodeState("t7-node-client", "state-active", "t7-sub-client", "gpt-4o SDK");
          setEdgeState("t7-edge-1", "edge-active");
          setNodeState("t7-node-facade", "state-active", "t7-sub-facade", "Translated");
          setEdgeState("t7-edge-2", "edge-active");
          setNodeState("t7-node-router", failover ? "state-amber" : "state-savings", "t7-sub-router", failover ? "429 Failover" : canary ? "Canary Pro" : "Stable AU");
          if (canary) {
            setEdgeState("t7-edge-primary", "edge-jev");
            setNodeState("t7-node-primary", "state-jev", "t7-sub-primary", "Served 200 (Canary)");
            setNodeState("t7-node-failover", "state-bypass", "t7-sub-failover", "Standby");
          } else if (failover) {
            setEdgeState("t7-edge-primary", "edge-alert");
            setNodeState("t7-node-primary", "state-alert", "t7-sub-primary", "429 Exhausted");
            setEdgeState("t7-edge-failover", "edge-savings");
            setNodeState("t7-node-failover", "state-savings", "t7-sub-failover", "Recovered 200 OK");
          } else {
            setEdgeState("t7-edge-failover", "edge-savings");
            setNodeState("t7-node-failover", "state-savings", "t7-sub-failover", "Served 200 OK");
            setNodeState("t7-node-primary", "state-bypass", "t7-sub-primary", "Standby");
          }

          const hv = document.getElementById("hero-t7-verdict");
          const hvs = document.getElementById("hero-t7-verdict-sub");
          const hm = document.getElementById("hero-t7-model");
          const hms = document.getElementById("hero-t7-model-sub");
          const hl = document.getElementById("hero-t7-lat");
          const hls = document.getElementById("hero-t7-lat-sub");
          if (hv) {
            hv.textContent = failover ? "FAILOVER 200" : canary ? "CANARY 200" : "OPENAI 200";
            hv.className = `hero-kpi-value ${failover ? "tone-cyan" : canary ? "tone-violet" : "tone-savings"}`;
            popMetric(hv);
          }
          if (hvs) hvs.textContent = failover ? "Primary 429 auto-recovered via AU Flash" : canary ? "Routed to Gemini 2.5 Pro Canary bucket" : "Translated gpt-4o → Gemini Flash seamlessly";
          if (hm) {
            hm.textContent = String(tel.served_model || "gemini-2.5-flash").replace("gemini-", "");
            popMetric(hm);
          }
          if (hms) hms.textContent = `Region: ${tel.served_region || "australia-southeast1"}`;
          if (hl) {
            hl.textContent = `${fmtInt(data.latency_ms)} ms`;
            popMetric(hl);
          }
          if (hls) hls.textContent = "Standard OpenAI chat.completion JSON returned";
          if (pipeBadge) pipeBadge.textContent = `HTTP ${data.http_status_code}`;
          if (statusEl) statusEl.textContent = `Completed at ${data.timestamp_utc}`;
          document.getElementById("res-req-box").textContent = JSON.stringify(data.openai_request || {}, null, 2);
          document.getElementById("res-resp-box").textContent = JSON.stringify(data.openai_response || {}, null, 2);
          const pill = document.getElementById("res-resp-pill");
          if (pill) {
            pill.textContent = `HTTP ${data.http_status_code} · ${tel.served_model || "gemini"}`;
            pill.className = "model-pill pill-allowed";
          }
        } catch (e) {
          if (statusEl) statusEl.textContent = `Error: ${e.message}`;
        } finally {
          setPipeRunning("t7-pipeline-svg", false);
          btnRunRes.disabled = false;
        }
      });
    }

    // --- TAB 8: REVERSIBLE PII VAULT + SSE ---
    const piiPrompt = document.getElementById("pii-prompt-input");
    const piiEnable = document.getElementById("pii-enable-vault");
    const piiRehydrate = document.getElementById("pii-enable-rehydrate");
    const btnRunPii = document.getElementById("btn-run-pii");

    document.querySelectorAll("#pii-scenario-list .scenario-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#pii-scenario-list .scenario-item").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        const p = btn.dataset.piiPreset;
        if (piiEnable) piiEnable.checked = true;
        if (piiRehydrate) piiRehydrate.checked = p !== "redact";
      });
    });

    if (btnRunPii) {
      btnRunPii.addEventListener("click", async () => {
        btnRunPii.disabled = true;
        setPipeRunning("t8-pipeline-svg", true);
        resetPipeSvg("t8-pipeline-svg");
        const statusEl = document.getElementById("pii-status");
        const pipeBadge = document.getElementById("t8-pipe-status");
        if (pipeBadge) pipeBadge.textContent = "RUNNING";
        if (statusEl) statusEl.textContent = "Tokenizing PII inside Apigee X Vault before calling Vertex AI...";
        try {
          const resp = await apiFetch("/api/pii-vault/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: piiPrompt ? piiPrompt.value : "",
              enable_vault: Boolean(!piiEnable || piiEnable.checked),
              rehydrate_response: Boolean(!piiRehydrate || piiRehydrate.checked),
            }),
          });
          const data = await resp.json();
          const body = data.apigee_response || {};
          const tel = body.apigee_pii_vault_telemetry || {};
          const count = Number(tel.entities_masked_count || 0);
          const rehydrated = Boolean(tel.rehydration_enabled);

          setNodeState("t8-node-client", "state-active", "t8-sub-client", `${count} PII entities`);
          setEdgeState("t8-edge-1", "edge-active");
          setNodeState("t8-node-mask", "state-savings", "t8-sub-mask", `${count} Vaulted`);
          setEdgeState("t8-edge-2", "edge-savings");
          setNodeState("t8-node-llm", "state-savings", "t8-sub-llm", "0 Bytes Raw PII");
          setEdgeState("t8-edge-3", "edge-savings");
          setNodeState("t8-node-unmask", rehydrated ? "state-active" : "state-amber", "t8-sub-unmask", rehydrated ? `Rehydrated (${tel.tokens_rehydrated_count || 0})` : "Kept Masked");

          const hl = document.getElementById("hero-t8-leaks");
          const hls = document.getElementById("hero-t8-leaks-sub");
          const hc = document.getElementById("hero-t8-count");
          const hcs = document.getElementById("hero-t8-count-sub");
          const hr = document.getElementById("hero-t8-rehydrate");
          const hrs = document.getElementById("hero-t8-rehydrate-sub");
          if (hl) {
            hl.textContent = tel.vault_enabled ? "0 Bytes" : "EXPOSED";
            hl.className = `hero-kpi-value ${tel.vault_enabled ? "tone-savings" : "tone-alert"}`;
            popMetric(hl);
          }
          if (hls) hls.textContent = tel.vault_enabled ? "Vertex AI only saw opaque <TOKEN_N> placeholders" : "Vault disabled — raw PII sent to LLM";
          if (hc) {
            hc.textContent = `${count} Masked`;
            popMetric(hc);
          }
          if (hcs) hcs.textContent = (tel.entities_detected || []).map((e) => e.token).join(" ") || "No PII detected";
          if (hr) {
            hr.textContent = rehydrated ? "Rehydrated" : "Redacted";
            popMetric(hr);
          }
          if (hrs) hrs.textContent = `${fmtInt(tel.sse_chunks_inspected || 1)} SSE chunks scanned · ${fmtInt(data.latency_ms)} ms`;
          if (pipeBadge) pipeBadge.textContent = `HTTP ${data.http_status_code}`;
          if (statusEl) statusEl.textContent = `Completed at ${data.timestamp_utc}`;
          document.getElementById("pii-sent-box").textContent = body.sanitized_prompt_sent_to_llm || "";
          document.getElementById("pii-final-box").textContent = body.response_text || "";
          document.getElementById("pii-telemetry-box").textContent = JSON.stringify(
            { llm_raw_response_masked: body.llm_raw_response_masked, telemetry: tel },
            null,
            2
          );
          const pill = document.getElementById("pii-resp-pill");
          if (pill) {
            pill.textContent = rehydrated ? "REHYDRATED" : "REDACTED";
            pill.className = `model-pill ${rehydrated ? "pill-allowed" : "pill-warning"}`;
          }
        } catch (e) {
          if (statusEl) statusEl.textContent = `Error: ${e.message}`;
        } finally {
          setPipeRunning("t8-pipeline-svg", false);
          btnRunPii.disabled = false;
        }
      });
    }
  }

  wireTablistKeyboardNav();
  initThemeSwitcher();
  initKeynoteDrawer();
  initViewModeSwitcher();
  initClickableNodes();
  initCopyCurl();
  initNewEnterpriseTabs();
  syncPolicySwitches();
  const elT5Slider = document.getElementById("t5-scale-slider");
  if (elT5Slider) elT5Slider.addEventListener("input", updateTab5AnnualROI);
  syncNoulThresholdLines();

  const elFireThreshold = document.getElementById("s1-fire-threshold");
  if (elFireThreshold) elFireThreshold.addEventListener("input", syncNoulThresholdLines);

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
      document.querySelectorAll(".audit-tab").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      tabBtn.classList.add("active");
      tabBtn.setAttribute("aria-selected", "true");
      const targetId = tabBtn.dataset.tab;
      ["tab-compression", "tab-cascade", "tab-cache-prune", "tab-headers-raw"].forEach((id) => {
        document.getElementById(id).style.display = id === targetId ? "block" : "none";
      });
    });
  });

  // Modals with Focus Management
  let lastModalTrigger = null;
  function openModal(modalEl, focusTargetEl) {
    if (!modalEl) return;
    lastModalTrigger = document.activeElement;
    modalEl.classList.add("open");
    if (focusTargetEl) focusTargetEl.focus();
  }
  function closeModal(modalEl) {
    if (!modalEl || !modalEl.classList.contains("open")) return;
    modalEl.classList.remove("open");
    if (lastModalTrigger && typeof lastModalTrigger.focus === "function") {
      lastModalTrigger.focus();
      lastModalTrigger = null;
    }
  }

  const elModal = document.getElementById("about-modal");
  const btnCloseAbout = document.getElementById("btn-close-about");
  document.getElementById("btn-open-about").addEventListener("click", () => {
    openModal(elModal, btnCloseAbout);
  });
  btnCloseAbout.addEventListener("click", () => closeModal(elModal));
  elModal.addEventListener("click", (e) => {
    if (e.target === elModal) closeModal(elModal);
  });

  // Modal ("System 1 & Noul Battery Glossary")
  const elGlossaryModal = document.getElementById("jev-glossary-modal");
  const btnOpenGlossary = document.getElementById("btn-open-glossary");
  const btnOpenGlossaryTab5 = document.getElementById("btn-open-glossary-tab5");
  const btnCloseGlossary = document.getElementById("btn-close-glossary");
  if (elGlossaryModal) {
    if (btnOpenGlossary) {
      btnOpenGlossary.addEventListener("click", () => openModal(elGlossaryModal, btnCloseGlossary));
    }
    if (btnOpenGlossaryTab5) {
      btnOpenGlossaryTab5.addEventListener("click", () => openModal(elGlossaryModal, btnCloseGlossary));
    }
    if (btnCloseGlossary) {
      btnCloseGlossary.addEventListener("click", () => closeModal(elGlossaryModal));
    }
    elGlossaryModal.addEventListener("click", (e) => {
      if (e.target === elGlossaryModal) closeModal(elGlossaryModal);
    });
    document.querySelectorAll(".glossary-tab-btn").forEach((gBtn) => {
      gBtn.addEventListener("click", () => {
        document.querySelectorAll(".glossary-tab-btn").forEach((b) => {
          b.className = "btn btn-segmented btn-compact glossary-tab-btn";
          b.setAttribute("aria-selected", "false");
        });
        gBtn.className = "btn btn-segmented btn-compact active glossary-tab-btn";
        gBtn.setAttribute("aria-selected", "true");
        const targetGTab = gBtn.dataset.gtab;
        ["gtab-primitives", "gtab-system12", "gtab-ml-terms", "gtab-compare"].forEach((id) => {
          const pane = document.getElementById(id);
          if (pane) pane.style.display = id === targetGTab ? "block" : "none";
        });
      });
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal(elModal);
      closeModal(elGlossaryModal);
    }
  });

  // Initialize from /api/scenarios and /api/policies/presets
  async function init() {
    try {
      const [scenResp, polResp] = await Promise.all([
        apiFetch(`/api/scenarios`),
        apiFetch(`/api/policies/presets`),
      ]);
      if (!scenResp.ok) {
        const errText = await scenResp.text();
        throw new Error(`HTTP ${scenResp.status}: ${errText}`);
      }
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
  // TAB 5: SYSTEM 1 (GEMINI DECISION 1 / TYPESAFE JEV) & SYSTEM 2 (VERTEX AI)
  // ===========================================================================
  const SYSTEM1_PROVIDER_META = {
    gemini_decision_1: {
      id: "gemini_decision_1",
      shortName: "Gemini Decision 1",
      displayName: "Google Gemini Decision 1",
      model: "gemini-decision-1",
      endpoint: "generativelanguage.googleapis.com/v1beta/decisions",
      pricePill: "Gemini Decision 1: $0.10/1M In · $0 Out",
      rateSub: "$0.10/1M in · $0 out",
      totalSub: "Decision 1 + Gemini",
      costLabel: "Decision 1 Cost",
      svgStage1: "Stage 1: Decision 1",
      bannerDescHtml:
        'Apigee X invokes <strong>Google Gemini Decision 1</strong> (<code>$0.10/1M</code> input, <code>$0.00</code> output, 256K multimodal context, single-pass calibrated logits). ' +
        '<strong>Stage 1</strong> evaluates <code>Choice</code>, <code>Score</code>, and pre-<code>Noul</code>s to route via Apigee <code>RouteRules</code> to Flash or fast-track directly to Pro. ' +
        '<strong>Stage 2</strong> runs a decomposed 5-head <code>Noul</code> battery (<code>max(nouls) &gt; fire_threshold</code>) to escalate subtle L<sub>1</sub> defects to System 2 Pro.',
      gwSubtitleHtml: "Google <code>gemini-decision-1</code> System 1 + Vertex AI System 2",
      flowFooterHtml:
        "Apigee Flow (Zero Cloud Run): <strong>KVM-GetSystem1Keys &rarr; SC-GeminiDecisionPreRoute &rarr; RouteRule &rarr; SC-GeminiDecisionPostVerify &rarr; SC-EscalateVertexPro</strong>",
      bannerHeadingHtml:
        'Two-Stage Confidence-Gated Routing &amp; 5-Head <code>Noul</code> Battery (Google <code>gemini-decision-1</code>)',
      ctaText: "Execute Gemini Decision 1 + System 2 Routing Comparison",
    },
    typesafe_jev: {
      id: "typesafe_jev",
      shortName: "TypeSafe Jev",
      displayName: "TypeSafe Jev",
      model: "jev-latest",
      endpoint: "api.typesafe.ai/v1/systemone",
      pricePill: "Jev: $0.042/1M In · $0 Out",
      rateSub: "$0.042/1M in · $0 out",
      totalSub: "Jev + Gemini total",
      costLabel: "Jev S1 Cost",
      svgStage1: "Stage 1: Jev Router",
      bannerDescHtml:
        'Apigee X invokes <strong>TypeSafe Jev</strong> (<code>$0.042/1M</code> input, <code>$0.00</code> output, ~200ms single-pass calibrated logits). ' +
        '<strong>Stage 1</strong> evaluates <code>Choice</code>, <code>Score</code>, and pre-<code>Noul</code>s to route via Apigee <code>RouteRules</code> to Flash or fast-track directly to Pro. ' +
        '<strong>Stage 2</strong> runs a decomposed 5-head <code>Noul</code> battery (<code>max(nouls) &gt; fire_threshold</code>) to escalate subtle L<sub>1</sub> defects to System 2 Pro.',
      gwSubtitleHtml: "TypeSafe <code>jev-latest</code> System 1 + Vertex AI System 2",
      flowFooterHtml:
        "Apigee Flow (Zero Cloud Run): <strong>KVM-GetSystem1Keys &rarr; SC-TypeSafeJevPreRoute &rarr; RouteRule &rarr; SC-TypeSafeJevPostVerify &rarr; SC-EscalateVertexPro</strong>",
      bannerHeadingHtml:
        'Two-Stage Confidence-Gated Routing &amp; 5-Head <code>Noul</code> Battery (TypeSafe <code>jev-latest</code>)',
      ctaText: "Execute TypeSafe Jev + System 2 Routing Comparison",
    },
  };

  function syncSystem1ProviderUI() {
    const providerKey =
      state.system1Provider === "typesafe_jev" ? "typesafe_jev" : "gemini_decision_1";
    const meta = SYSTEM1_PROVIDER_META[providerKey];

    const btnGemini = document.getElementById("btn-s1-provider-gemini");
    const btnJev = document.getElementById("btn-s1-provider-jev");
    if (btnGemini) {
      const active = providerKey === "gemini_decision_1";
      btnGemini.classList.toggle("active", active);
      btnGemini.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (btnJev) {
      const active = providerKey === "typesafe_jev";
      btnJev.classList.toggle("active", active);
      btnJev.setAttribute("aria-pressed", active ? "true" : "false");
    }

    const setHtml = (id, html) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    };
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setHtml("s1-banner-heading", meta.bannerHeadingHtml);
    setHtml("s1-banner-desc", meta.bannerDescHtml);
    setText("s1-provider-price-pill", meta.pricePill);
    setHtml("s1-provider-endpoint-meta", `Endpoint: <code>${escapeHtml(meta.endpoint)}</code>`);
    setHtml("s1-flow-footer", meta.flowFooterHtml);
    setText("btn-run-s1", meta.ctaText);
    setHtml(
      "s1-pipeline-title",
      `Live System 1 (${escapeHtml(meta.displayName)}) &rarr; System 2 (Vertex AI) Cascade Flow`
    );
    setText("t5-title-stage1", meta.svgStage1);
    setHtml("s1-gw-subtitle", meta.gwSubtitleHtml);
    setText("s1-cost-label", meta.costLabel);
    setText("s1-cost-rate-sub", meta.rateSub);
    setText("s1-total-cost-sub", meta.totalSub);
    setText("s1-viz-title", `System 2 Direct vs. Apigee X + ${meta.shortName} Cascade Cost`);
    setText(
      "s1-viz-gw-name",
      `Via Apigee X + ${meta.displayName} Cascade (incl. System 1 Cost)`
    );
    setHtml(
      "s1-audit-title",
      `Live ${escapeHtml(meta.displayName)} (System 1) Calibrated Telemetry: Stage 1 Pre-Router &amp; Stage 2 5-Head <code>Noul</code> Battery`
    );
    setHtml(
      "s1-stage1-title",
      `Stage 1: ${escapeHtml(meta.shortName)} Pre-Flight Router (<code>Choice</code> + <code>Score</code> + Pre-<code>Noul</code>s)`
    );
    setHtml(
      "s1-stage2-title",
      `Stage 2: ${escapeHtml(meta.shortName)} 5-Head Decomposed <code>Noul</code> Battery vs. Holistic Judge`
    );
  }

  ["btn-s1-provider-gemini", "btn-s1-provider-jev"].forEach((btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener("click", () => {
      const nextProvider = btn.dataset.s1provider;
      if (nextProvider && SYSTEM1_PROVIDER_META[nextProvider]) {
        state.system1Provider = nextProvider;
        syncSystem1ProviderUI();
      }
    });
  });
  syncSystem1ProviderUI();

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
    syncPolicySwitches();
    syncNoulThresholdLines();
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
      btn.setAttribute("aria-pressed", idx === 0 ? "true" : "false");
      btn.innerHTML = `
        <div>
          <div class="scenario-item-title">${escapeHtml(cleanScenarioLabel(scen.title))}</div>
          <div class="scenario-item-sub">${escapeHtml(scen.description)}</div>
        </div>
        <span class="scenario-badge">${escapeHtml(scen.badge)}</span>
      `;
      btn.addEventListener("click", () => {
        s1List.querySelectorAll(".scenario-item").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
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
      const activeMeta =
        SYSTEM1_PROVIDER_META[state.system1Provider] || SYSTEM1_PROVIDER_META.gemini_decision_1;
      btnRunS1.disabled = true;
      setPipeRunning("t5-pipeline-svg", true);
      statusEl.textContent = `Calling ${activeMeta.displayName} (System 1) + Apigee X + Vertex AI Gemini...`;
      try {
        const payload = {
          session_id: "jev-demo-session",
          scenario_id: (state.activeSystem1Scenario && state.activeSystem1Scenario.id) || "jev-custom",
          system1_provider: state.system1Provider,
          system_instruction: document.getElementById("s1-sys").value,
          rag_context: document.getElementById("s1-rag").value,
          user_query: document.getElementById("s1-query").value,
          confidence_threshold: Number(document.getElementById("s1-conf-threshold").value || 0.75),
          fire_threshold: Number(document.getElementById("s1-fire-threshold").value || 0.70),
          enable_direct_pro_fast_track: document.getElementById("s1-enable-fast-track").checked,
          enable_post_verifier: document.getElementById("s1-enable-verifier").checked,
          simulate_l1_defect: document.getElementById("s1-simulate-defect").checked,
        };

        const resp = await apiFetch(`/api/system1/execute`, {
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
        const respProviderKey = g.system1_provider || state.system1Provider;
        const respMeta =
          SYSTEM1_PROVIDER_META[respProviderKey] || activeMeta;
        const providerLabel = g.system1_provider_label || respMeta.displayName;
        const providerUpper = providerLabel.toUpperCase();

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

        // 2. Apigee X + System 1 Card
        const gCost = g.cost_accounting || {};
        const pill = document.getElementById("s1-gw-pill");
        pill.textContent = g.final_model_used || "gemini-2.5-flash";
        pill.className = g.escalated_to_pro
          ? "model-pill pill-deploying"
          : "model-pill pill-allowed";

        const isDirectPro = g.initial_routing_decision === "GEMINI_2_5_PRO";
        document.getElementById("s1-gw-route").textContent = isDirectPro
          ? "Direct Pro"
          : g.escalated_to_pro
          ? "L1 → L2 Pro"
          : "L1 Flash";
        document.getElementById("s1-gw-route-sub").textContent = isDirectPro
          ? "Stage 1 fast-track"
          : g.escalated_to_pro
          ? "Noul battery escalated"
          : "Accepted at L1";
        document.getElementById("s1-gw-jev-cost").textContent = fmtUsd(
          gCost.total_jev_system1_cost_usd,
          8
        );
        document.getElementById("s1-gw-total-cost").textContent = fmtUsd(gCost.total_cost_usd, 6);

        const costSaved = Number(cmp.cost_saved_usd || 0);
        const isSavings = costSaved >= 0;
        const elS1Savings = document.getElementById("s1-gw-savings");
        const elS1SavingsSub = document.getElementById("s1-gw-savings-sub");
        elS1Savings.textContent = `${isSavings ? "-" : "+"}${Math.abs(Number(cmp.cost_reduction_pct || 0))}%`;
        elS1SavingsSub.textContent = `${fmtUsd(Math.abs(costSaved), 6)} ${isSavings ? "saved" : "added"}`;
        setDeltaClass(elS1Savings, isSavings);
        setDeltaClass(elS1SavingsSub, isSavings);
        popMetric(elS1Savings);

        // Update Keynote Hero Outcome Band (Tab 5)
        const h5s = document.getElementById("hero-t5-savings");
        const h5ss = document.getElementById("hero-t5-savings-sub");
        const h5r = document.getElementById("hero-t5-route");
        const h5rs = document.getElementById("hero-t5-route-sub");
        const h5g = document.getElementById("hero-t5-gate");
        const h5gs = document.getElementById("hero-t5-gate-sub");
        if (h5s) {
          h5s.textContent = `${isSavings ? "-" : "+"}${Math.abs(Number(cmp.cost_reduction_pct || 0))}%`;
          h5s.className = `hero-kpi-value ${isSavings ? "tone-savings" : "tone-alert"}`;
          popMetric(h5s);
        }
        if (h5ss) h5ss.textContent = `${fmtUsd(gCost.total_cost_usd, 6)} Apigee X vs. ${fmtUsd(dCost.total_cost_usd, 6)} Direct Pro`;
        if (h5r) {
          h5r.textContent = g.escalated_to_pro ? "Escalated" : (g.final_model || "Flash").replace("gemini-", "");
          popMetric(h5r);
        }
        if (h5rs) h5rs.textContent = document.getElementById("s1-gw-route-sub").textContent;
        if (h5g) {
          h5g.textContent = g.escalated_to_pro ? "Defect Caught" : (g.stage2_jev && g.stage2_jev.enabled ? "Verified" : "Bypassed");
          h5g.className = `hero-kpi-value ${g.escalated_to_pro ? "tone-alert" : "tone-savings"}`;
          popMetric(h5g);
        }
        if (h5gs) h5gs.textContent = g.escalated_to_pro ? "Auto-recovered via Gemini 2.5 Pro" : "Noul quality battery passed";

        // Update Tab 5 Live Race Strip & Projected Annual Savings
        state.lastS1SavedPerReq = costSaved;
        const r5dCost = Number(dCost.total_cost_usd || 0);
        const r5gCost = Number(gCost.total_cost_usd || 0);
        const r5Max = Math.max(r5dCost, r5gCost, 0.000001);
        const r5dBar = document.getElementById("t5-race-direct-bar");
        const r5gBar = document.getElementById("t5-race-gw-bar");
        const r5dLbl = document.getElementById("t5-race-direct-label");
        const r5gLbl = document.getElementById("t5-race-gw-label");
        if (r5dBar) r5dBar.style.transform = `scaleX(${Math.max(0.06, r5dCost / r5Max).toFixed(4)})`;
        if (r5gBar) r5gBar.style.transform = `scaleX(${Math.max(0.03, r5gCost / r5Max).toFixed(4)})`;
        if (r5dLbl) r5dLbl.textContent = `${fmtUsd(r5dCost, 6)} · ${fmtInt(d.latency_ms)} ms`;
        if (r5gLbl) r5gLbl.textContent = `${fmtUsd(r5gCost, 6)} · ${fmtInt(g.client_observed_latency_ms || g.latency_ms)} ms`;
        updateTab5AnnualROI();

        let gwBodyText = g.response_text || "";
        if (g.escalated_to_pro && g.l1_response_preview) {
          gwBodyText =
            `[${providerUpper} STAGE 2 NOUL BATTERY INTERCEPTED DEFECTIVE L1 FLASH RESPONSE & ESCALATED TO GEMINI 2.5 PRO]\n` +
            `Escalation Reason: ${g.escalation_reason}\n` +
            `Rejected L1 Flash Preview: "${g.l1_response_preview}"\n` +
            `------------------------------------------------------------------------\n` +
            `[RECOVERED SYSTEM 2 (GEMINI 2.5 PRO) FINAL RESPONSE]:\n` +
            gwBodyText;
        }
        document.getElementById("s1-gw-body").textContent = gwBodyText;

        // 3. Stage 1 System 1 Telemetry Box
        const st1 = g.stage1_jev || {};
        const st1Usage = st1.usage || {};
        const st1Model = st1.model || respMeta.model;
        document.getElementById("s1-stage1-meta").textContent =
          `Model: ${st1Model} | Latency: ${fmtInt(st1.latency_ms)} ms | In: ${fmtInt(st1Usage.input_tokens)} tok (${fmtUsd(st1Usage.cost_usd, 8)})`;

        const st1Lines = [
          `=== STAGE 1: ${providerUpper} PRE-FLIGHT ROUTER (${st1Model}) ===`,
          `Execution Architecture    : ${g.execution_architecture || "Pure Apigee X Native ServiceCallout"}`,
          `Apigee Policies Executed  : ${(g.apigee_policies_executed || []).join(" -> ") || "Native ServiceCallout"}`,
          `System 1 Endpoint         : ${st1.endpoint || respMeta.endpoint}`,
          `Apigee RouteRule Selected : ${g.apigee_route_rule_taken}`,
          `Routing Decision          : ${g.initial_routing_decision} (${g.initial_target_model})`,
          `Routing Reason            : ${g.routing_reason}`,
          ``,
          `--- 1. Choice Primitive (target_tier) ---`,
          `Selected Tier             : ${st1.target_tier_choice} (Confidence: ${st1.target_tier_confidence} vs Gate: ${st1.confidence_threshold})`,
          `Calibrated Softmax Probs  : ${JSON.stringify(st1.target_tier_probabilities || {})}`,
          ``,
          `--- 2. Score Primitive (complexity 0..2) ---`,
          `Expected Value E[Score]   : ${st1.complexity_score} / 2.0 (Normalized: ${st1.complexity_normalized})`,
          `Score Level Probabilities : ${JSON.stringify(st1.complexity_probabilities || {})}`,
          ``,
          `--- 3. Pre-Flight Noul Primitives ---`,
          `requires_formal_proof     : ${st1.pre_nouls ? st1.pre_nouls.requires_formal_proof : 0}`,
          `has_strict_multi_constr.  : ${st1.pre_nouls ? st1.pre_nouls.has_strict_multi_constraints : 0}`,
        ];
        document.getElementById("s1-stage1-box").textContent = st1Lines.join("\n");

        // 4. Stage 2 System 1 5-Head Noul Battery Telemetry Box
        const st2 = g.stage2_jev || {};
        const st2Usage = st2.usage || {};
        const st2Model = st2.model || respMeta.model;
        document.getElementById("s1-stage2-meta").textContent = st2.executed
          ? `Model: ${st2Model} | Latency: ${fmtInt(st2.latency_ms)} ms | In: ${fmtInt(st2Usage.input_tokens)} tok (${fmtUsd(st2Usage.cost_usd, 8)})`
          : `Skipped (${st2.skipped_reason || "Direct System 2 Pro Fast-Track"})`;

        if (!st2.executed) {
          document.getElementById("s1-stage2-box").textContent =
            `Stage 2 Post-Verifier was skipped: ${st2.skipped_reason}\n\n` +
            `Because ${providerLabel} Stage 1 routed directly to System 2 (gemini-2.5-pro), Apigee X avoided a wasted L1 Flash call and returned the frontier Pro completion directly.`;
        } else {
          const batteryRows = (st2.noul_battery_table || []).map((row) => {
            const pStr = Number(row.probability || 0).toFixed(4);
            const flagStr = row.fired ? "  <== FIRES (> " + st2.fire_threshold + ")" : "";
            return `  ${row.question.padEnd(38, " ")} : ${pStr}${flagStr}`;
          });
          const st2Lines = [
            `=== STAGE 2: ${providerUpper} DECOMPOSED 5-HEAD NOUL BATTERY (${st2Model}) ===`,
            `System 1 Endpoint         : ${st2.endpoint || respMeta.endpoint}`,
            `Gate Rule (any_flag)      : max(noul_battery) = ${st2.max_noul_value} (Threshold: > ${st2.fire_threshold})`,
            `Gate Verdict              : ${st2.any_flag_fired ? "FIRED -> ESCALATE TO GEMINI 2.5 PRO" : "ALL CLEAR -> ACCEPT L1 GEMINI 2.5 FLASH"}`,
            `Firing Heads              : ${(st2.firing_heads || []).length > 0 ? st2.firing_heads.join(", ") : "None"}`,
            `Holistic Single-Judge Noul: ${st2.holistic_escalate_judge} (Notice how single-question judges under-react vs decomposed battery)`,
            `Response Quality Score    : ${st2.response_quality_score} / 2.0`,
            ``,
            `--- 5-Head Noul Battery Probabilities ---`,
            ...batteryRows,
            ``,
            `Escalation Summary        : ${g.escalation_reason}`,
          ];
          document.getElementById("s1-stage2-box").textContent = st2Lines.join("\n");
        }

        updateTab5Visuals(data, payload.fire_threshold);
        statusEl.textContent = `Completed via ${providerLabel} at ${data.timestamp_utc}`;
      } catch (e) {
        statusEl.textContent = `Error: ${e.message}`;
      } finally {
        setPipeRunning("t5-pipeline-svg", false);
        btnRunS1.disabled = false;
      }
    });
  }

  init();
})();
