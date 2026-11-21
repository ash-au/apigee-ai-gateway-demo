// Apigee X PostFlow (Tab 5): Evaluate 5-Head Noul Battery & Decide Conditional L2 Vertex Pro Escalation
// Strict ES5 for Apigee X Mozilla Rhino runtime.
var runPostVerify = context.getVariable("ai.run_post_verify") === "true";

if (!runPostVerify) {
    context.setVariable("ai.escalate_to_pro", "false");
    context.setVariable("ai.stage2_telemetry_json", "{}");
} else {
    var stage2EndMs = Date.now();
    var stage2StartMs = Number(context.getVariable("ai.stage2_start_ms") || stage2EndMs);
    var stage2LatencyMs = Math.max(1, stage2EndMs - stage2StartMs);

    var providerId = context.getVariable("ai.system1_provider") || "gemini_decision_1";
    var isGemini = providerId === "gemini_decision_1";
    var providerLabel = isGemini ? "Google Gemini Decision 1" : "TypeSafe Jev";
    var shortLabel = isGemini ? "Gemini Decision 1" : "Jev";
    var defaultModel = isGemini ? "gemini-decision-1" : "jev-latest";
    var endpointUrl = isGemini
        ? "https://generativelanguage.googleapis.com/v1beta/decisions"
        : "https://api.typesafe.ai/v1/systemone";
    var ratePer1M = isGemini ? 0.10 : 0.042;
    var fireThreshold = Number(context.getVariable("ai.jev_fire_threshold") || 0.70);

    var rawStr = context.getVariable("s1PostResponse.content") || "{}";
    var s1Raw = {};
    try {
        s1Raw = JSON.parse(rawStr);
    } catch (e) {
        throw new Error("Failed to parse Stage 2 " + providerLabel + " response: " + e);
    }

    var promptFb = s1Raw.prompt_feedback || s1Raw.promptFeedback || {};
    if (promptFb.block_reason || promptFb.blockReason) {
        throw new Error(providerLabel + " blocked Stage 2 input: " + JSON.stringify(promptFb));
    }

    var answers = s1Raw.answers || {};
    var usage = s1Raw.usage || {};
    var inputTokens = Number(
        usage.total_input_tokens || usage.totalInputTokens || usage.input_tokens || usage.total_tokens || 0
    );
    var outputTokens = Number(
        usage.total_output_tokens || usage.totalOutputTokens || usage.output_tokens || 0
    );
    var stage2CostUsd = Number(((inputTokens / 1000000.0) * ratePer1M).toFixed(8));

    var canonicalHeads = [
        "hallucinated_or_contradicts_context",
        "missed_user_constraint",
        "superficial_or_unproven",
        "internal_contradiction",
        "hedging_or_refusal"
    ];

    var noulTable = [];
    var noulBatteryMap = {};
    var firedList = [];
    var maxDefectNoul = 0.0;

    for (var i = 0; i < canonicalHeads.length; i++) {
        var headKey = canonicalHeads[i];
        var ansObj = answers[headKey] || {};
        var prob = Number(Number(ansObj.noul || 0.0).toFixed(4));
        var didFire = prob > fireThreshold;
        noulBatteryMap[headKey] = prob;
        if (prob > maxDefectNoul) {
            maxDefectNoul = prob;
        }
        if (didFire) {
            firedList.push({ key: headKey, prob: prob });
        }
        noulTable.push({
            question: headKey,
            probability: prob,
            fired: didFire
        });
    }

    // Sort firing heads descending for readable summary
    firedList.sort(function (a, b) {
        return b.prob - a.prob;
    });
    var firingHeadsStrList = [];
    for (var j = 0; j < firedList.length; j++) {
        firingHeadsStrList.push(firedList[j].key + "=" + firedList[j].prob.toFixed(2));
    }

    var holisticAns = answers["__overall__::holistic_escalate_judge"] || answers.overall_holistic_escalate_judge || {};
    var holisticVal = Number(Number(holisticAns.noul || 0.0).toFixed(4));
    noulBatteryMap["__overall__::holistic_escalate_judge"] = holisticVal;

    var qualAns = answers.response_quality || {};
    var qualScore = Number(Number(qualAns.score !== undefined ? qualAns.score : 2.0).toFixed(4));
    var qualConf = Number(Number(qualAns.confidence !== undefined ? qualAns.confidence : 0.5).toFixed(4));

    var escalate = firedList.length > 0;
    var escalationReason = null;
    if (escalate) {
        escalationReason = shortLabel + " Noul Battery `any_flag` gate fired (> " + fireThreshold.toFixed(2) + "): " +
            firingHeadsStrList.join(", ") + ". Escalating via Apigee SC-EscalateVertexPro from L1 (gemini-2.5-flash) to System 2 (gemini-2.5-pro).";
    }

    var stage2Telemetry = {
        provider: providerId,
        provider_label: providerLabel,
        endpoint: endpointUrl,
        pricing_per_million_usd: ratePer1M,
        executed: true,
        model: s1Raw.model || defaultModel,
        latency_ms: stage2LatencyMs,
        fire_threshold: fireThreshold,
        max_noul_value: Number(maxDefectNoul.toFixed(4)),
        any_flag_fired: escalate,
        firing_heads: firingHeadsStrList,
        holistic_escalate_judge: holisticVal,
        response_quality_score: qualScore,
        response_quality_confidence: qualConf,
        noul_battery_table: noulTable,
        noul_battery: noulBatteryMap,
        escalation_reason: escalationReason,
        simulated_l1_defect_note: context.getVariable("ai.simulated_defect_note") || null,
        usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost_usd: stage2CostUsd
        }
    };

    context.setVariable("ai.stage2_telemetry_json", JSON.stringify(stage2Telemetry));

    if (escalate) {
        var vertexPayload = {};
        try {
            vertexPayload = JSON.parse(context.getVariable("ai.vertex_payload_sent_json") || "{}");
        } catch (e) {
            vertexPayload = {};
        }
        if (!vertexPayload.generationConfig) {
            vertexPayload.generationConfig = {};
        }
        var currentMaxOut = Number(vertexPayload.generationConfig.maxOutputTokens || 2048);
        vertexPayload.generationConfig.maxOutputTokens = currentMaxOut < 2048 ? 2048 : currentMaxOut;
        vertexPayload.generationConfig.thinkingConfig = { thinkingBudget: 256 };

        context.setVariable("ai.l2_pro_request_body", JSON.stringify(vertexPayload));
        context.setVariable("ai.escalate_to_pro", "true");
        context.setVariable("ai.l2_start_ms", String(Date.now()));
    } else {
        context.setVariable("ai.escalate_to_pro", "false");
    }
}
