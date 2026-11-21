// Apigee X PostFlow (Tab 5): Extract Vertex AI L1 Response & Build Native Stage 2 5-Head Noul Battery Request
// Strict ES5 for Apigee X Mozilla Rhino runtime.
var vertexEndMs = Date.now();
var vertexStartMs = Number(context.getVariable("ai.vertex_start_ms") || vertexEndMs);
context.setVariable("ai.l1_vertex_latency_ms", String(Math.max(0, vertexEndMs - vertexStartMs)));

function parseVertexResponse(raw, modelName) {
    var candidates = (raw && raw.candidates) || [];
    var textParts = [];
    if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
        var parts = candidates[0].content.parts;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (p && typeof p.text === "string" && !p.thought) {
                textParts.push(p.text);
            }
        }
    }
    var text = textParts.join("\n").replace(/^\s+|\s+$/g, "");

    var usageMeta = (raw && raw.usageMetadata) || {};
    var promptTokens = Number(usageMeta.promptTokenCount || 0);
    var candidateTokens = Number(usageMeta.candidatesTokenCount || 0);
    var thinkingTokens = Number(usageMeta.thoughtsTokenCount || 0);
    var totalTokens = Number(usageMeta.totalTokenCount || (promptTokens + candidateTokens + thinkingTokens));

    var isPro = modelName === "gemini-2.5-pro";
    var inRate = isPro ? 1.25 : 0.30;
    var outRate = isPro ? 10.00 : 2.50;
    var costUsd = Number((
        (promptTokens / 1000000.0) * inRate +
        ((candidateTokens + thinkingTokens) / 1000000.0) * outRate
    ).toFixed(8));

    return {
        text: text,
        usage: {
            model: modelName,
            prompt_tokens: promptTokens,
            candidate_tokens: candidateTokens,
            thinking_tokens: thinkingTokens,
            total_tokens: totalTokens,
            cost_usd: costUsd
        }
    };
}

function formatStateAsText(stateObj) {
    var keys = Object.keys(stateObj);
    var sections = [];
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = String(stateObj[k] || "").replace(/^\s+|\s+$/g, "");
        if (v.length > 0) {
            sections.push("=== " + k + " ===\n" + v);
        }
    }
    return sections.length > 0 ? sections.join("\n\n") : "(no context)";
}

var vertexRawStr = context.getVariable("response.content") || "{}";
var vertexRaw = {};
try {
    vertexRaw = JSON.parse(vertexRawStr);
} catch (e) {
    vertexRaw = {};
}

var routingDecision = context.getVariable("ai.routing_decision") || "GEMINI_2_5_FLASH";
var initialModel = context.getVariable("ai.target_model") || "gemini-2.5-flash";
var parsedL1 = parseVertexResponse(vertexRaw, initialModel);

context.setVariable("ai.l1_response_text", parsedL1.text);
context.setVariable("ai.l1_usage_json", JSON.stringify(parsedL1.usage));

var enablePostVerifier = context.getVariable("ai.jev_enable_post_verifier") !== "false";
var simulateL1Defect = context.getVariable("ai.jev_simulate_l1_defect") === "true";

// Skip Stage 2 if Stage 1 already fast-tracked directly to System 2 Pro
if (initialModel === "gemini-2.5-pro" || routingDecision === "GEMINI_2_5_PRO") {
    context.setVariable("ai.run_post_verify", "false");
    context.setVariable("ai.candidate_text_for_verification", parsedL1.text);
    context.setVariable("ai.simulated_defect_note", "");
} else {
    var candidateText = parsedL1.text;
    var defectNote = "";
    if (simulateL1Defect) {
        candidateText =
            "Based on the policy bulletin, Customer PII and PCI-DSS workloads can be deployed in " +
            "us-central1 (Iowa) or asia-east1, and encryption keys are rotated every 365 days " +
            "using standard Google-managed keys. (Note: Audit log retention period was not checked.)";
        defectNote =
            "Simulated subtle L1 fabrication injected: claims us-central1/asia-east1 & 365-day Google-managed keys " +
            "(contradicting RAG context's australia-southeast1/2 & 90-day CMEK rule) and omits audit log retention.";
    }

    context.setVariable("ai.candidate_text_for_verification", candidateText);
    context.setVariable("ai.simulated_defect_note", defectNote);

    if (!enablePostVerifier) {
        context.setVariable("ai.run_post_verify", "false");
    } else {
        var providerId = context.getVariable("ai.system1_provider") || "gemini_decision_1";
        var isGemini = providerId === "gemini_decision_1";
        var userQuery = String(context.getVariable("ai.jev_user_query") || "");
        var sysInstruction = String(context.getVariable("ai.jev_system_instruction") || "").replace(/^\s+|\s+$/g, "");
        var ragContext = String(context.getVariable("ai.jev_rag_context") || "").replace(/^\s+|\s+$/g, "");

        var verifyState = {
            user_query: userQuery,
            l1_candidate_response: candidateText
        };
        if (sysInstruction.length > 0) {
            verifyState.system_instruction = sysInstruction;
        }
        if (ragContext.length > 0) {
            verifyState.source_rag_context = ragContext;
        }

        function noulCriteria(trueText, falseText) {
            if (isGemini) {
                return { true_description: trueText, false_description: falseText };
            }
            return { "true": trueText, "false": falseText };
        }

        var verifyQuestions = {
            hallucinated_or_contradicts_context: {
                type: "noul",
                instructions: "Does `l1_candidate_response` state facts, regions, numbers, or policies that contradict or are fabricated relative to `source_rag_context` (if `source_rag_context` is provided)?",
                criteria: noulCriteria(
                    "`l1_candidate_response` contradicts `source_rag_context` or states fabricated facts",
                    "`l1_candidate_response` is factually consistent with `source_rag_context`"
                )
            },
            missed_user_constraint: {
                type: "noul",
                instructions: "Does `l1_candidate_response` fail to answer or omit any explicit question, constraint, or required item asked for in `user_query`?",
                criteria: noulCriteria(
                    "`l1_candidate_response` omits or fails to answer part of `user_query`",
                    "`l1_candidate_response` addresses every part of `user_query`"
                )
            },
            superficial_or_unproven: {
                type: "noul",
                instructions: "Does `user_query` ask for a rigorous analysis, formal proof, or multi-part architectural derivation that `l1_candidate_response` only answers superficially?",
                criteria: noulCriteria(
                    "`l1_candidate_response` is too shallow or superficial for `user_query`",
                    "`l1_candidate_response` provides sufficient depth for `user_query`"
                )
            },
            internal_contradiction: {
                type: "noul",
                instructions: "Does `l1_candidate_response` contradict itself or contain logically inconsistent statements?",
                criteria: noulCriteria(
                    "`l1_candidate_response` is internally contradictory",
                    "`l1_candidate_response` is internally consistent"
                )
            },
            hedging_or_refusal: {
                type: "noul",
                instructions: "Does `l1_candidate_response` hedge, express uncertainty, or state that it cannot verify part of the request?",
                criteria: noulCriteria(
                    "`l1_candidate_response` hedges or states something was not checked/verified",
                    "`l1_candidate_response` answers directly without hedging"
                )
            },
            response_quality: {
                type: "score",
                instructions: "Rate the overall accuracy, completeness, and grounding of `l1_candidate_response`",
                criteria: [
                    "Flawed, hallucinated, or misses explicit constraints in `user_query`",
                    "Partially complete or surface-level answer",
                    "Accurate, complete, and faithfully grounded in the context"
                ]
            }
        };

        var holisticKey = isGemini ? "overall_holistic_escalate_judge" : "__overall__::holistic_escalate_judge";
        verifyQuestions[holisticKey] = {
            type: "noul",
            instructions: "Holistic check: Is `l1_candidate_response` an inaccurate, ungrounded, or incomplete response to `user_query` that should be escalated to a stronger reasoning model?"
        };

        var s1PostPayload;
        if (isGemini) {
            s1PostPayload = {
                model: "gemini-decision-1",
                input: formatStateAsText(verifyState),
                questions: verifyQuestions
            };
        } else {
            s1PostPayload = {
                model: "jev-latest",
                state: verifyState,
                questions: verifyQuestions
            };
        }

        context.setVariable("ai.s1_post_request_body", JSON.stringify(s1PostPayload));
        context.setVariable("ai.run_post_verify", "true");
        context.setVariable("ai.stage2_start_ms", String(Date.now()));
    }
}
