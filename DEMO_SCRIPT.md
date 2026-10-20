# 5-Minute Live Presenter Script: Apigee X as an AI Gateway

**Audience:** CIOs, VP of Platform Engineering, Enterprise Architects, and Staff Engineers  
**Duration:** 5 minutes (plus Q&A with the Staff Engineer Audit Drawer)  
**GCP Project & Region:** `apac-cs-5g-demo5` (`australia-southeast1` / Sydney)  
**Apigee X Organization & Environment:** `apac-cs-5g-demo5` / `demo` (`demo-group`)  
**Live Demo UI URL (`@google.com` IAP):** `https://apigee-ai-economics-demo-1019413155504.australia-southeast1.run.app`  
**Apigee X Gateway Target (VPC):** `https://10.106.240.2.nip.io/v1/ai-economics/chat`

---

## Pre-Flight Check (30 seconds before going live)
1. Open the Demo UI in your browser.
2. Click **"Reset Gateway Cache & Session Ledger"** in the top-right masthead so the semantic cache is cold and the cumulative session ledger starts at `$0.000000` across `0 runs`.

---

## Minute 0:00 – 1:00 | The Setup: Why Point-to-Point AI Pilots Fail at Scale
* **What to say:**
  > "Right now, 90% of enterprise AI pilots are built as direct point-to-point connections from an application straight to a frontier model like `gemini-2.5-pro`. When you skip the API gateway layer, every single request—whether it's a repeated tier-1 FAQ, a bloated 5,000-token RAG payload, or an 8-turn chat log—burns frontier input, output, and internal thinking tokens.
  >
  > Today we're looking at a live Apigee X gateway in `australia-southeast1` that operationalizes two peer-reviewed papers—Stanford's **FrugalGPT** and Microsoft Research's **LLMLingua-2**—into four gateway policies controlled by HTTP headers. Every number on this screen comes from real Vertex AI `usageMetadata`, including internal `thoughtsTokenCount` billed at output rates."

---

## Minute 1:00 – 2:15 | Step 1 & Step 2: Model Routing + Semantic Completion Cache
1. **Select Scenario 1: *Tier-1 IT Support FAQ (Turn 1: Route & Index Cache)*** and click **"Execute Side-by-Side Comparison"**.
   * **Point out on screen:**
     * **Left (Direct Baseline):** Hits `gemini-2.5-pro`, burning frontier input + output + thinking tokens (`~$0.0020–$0.0035`).
     * **Right (Via Apigee X):** Apigee's pre-inference complexity router scores the query at `0.15`, routes to `gemini-2.5-flash` in Sydney (`L1`), verifies post-generation reliability $g(q, a) \ge 0.90$, and indexes the completion in `text-embedding-005`. Cost drops by **~94%**.
2. **Immediately select Scenario 2: *Rephrased IT Support FAQ (Turn 2: Semantic Cache Hit)*** and click **"Execute Side-by-Side Comparison"**.
   * **Point out on screen:**
     * Look at the prompt: *"I upgraded my smartphone today and need to transfer or re-enroll my company Okta multi-factor authenticator app. What is the procedure?"* — completely different phrasing from Turn 1.
     * **Right (Via Apigee X):** `text-embedding-005` computes a cosine similarity of **`0.8685 >= 0.85`**. Apigee executes a targetless `<RouteRule name="Route-CacheShortCircuit">`.
     * **LLM Tokens Billed:** **`0`** (only `29` embedding tokens costing **`$0.00000073`** — a **99.9%+ cost reduction** and sub-400ms latency).

---

## Minute 2:15 – 3:30 | Step 3: LLMLingua-2 Coarse-to-Fine Prompt Compression
1. **Select Scenario 3: *Verbose RAG Compliance Audit (LLMLingua-2 Compression)*** and click **"Execute Side-by-Side Comparison"**.
2. While or after it completes, click **Tab 1 ("LLMLingua-2 Prompt Compression Diff")** in the **Staff Engineer Inspection Drawer** at the bottom.
   * **What to say:**
     > "Enterprise RAG pipelines routinely retrieve 3 to 10 documents full of legal boilerplate, duplicate archive copies, and vector noise—like Document 3 here about descaling the Sydney office espresso machine.
     >
     > Instead of blindly truncating, our Apigee callout implements the **LLMLingua Coarse-to-Fine Budget Controller**: it keeps the User Query at 100% fidelity ($\tau_q = 1.0$), System Instructions at 85%, and compresses the retrieved RAG context using `llmlingua-2-bert-base` on CPU. Look at the side-by-side prompt diff: prompt tokens drop by **~55%**, while the output still cites `australia-southeast1`, `australia-southeast2`, `APP 8`, `CMEK` 90-day rotation, and `365-day` audit logs."

---

## Minute 3:30 – 4:15 | Step 4: Multi-Turn Context Pruning & Session Dedup
1. **Select Scenario 4: *Multi-Turn SEV-2 Incident Bridge (Context Pruning & Dedup)*** and click **"Execute Side-by-Side Comparison"**.
2. Open **Tab 3 ("Semantic Cache & Context Pruning State")**.
   * **What to say:**
     > "In multi-turn assistants, apps resend the entire chat history on every turn—paying $O(N^2)$ token growth. With `X-Opt-Prune: true`, the gateway condenses turns 1 through 6 into a structured state summary while keeping the latest turns verbatim, and we transparently include the Flash summarizer overhead tokens right in the gateway's billed total."

---

## Minute 4:15 – 5:00 | Step 5: The Credibility Test — FrugalGPT Cascade Escalation
1. **Select Scenario 5: *Deep Architectural Proof (FrugalGPT Cascade Escalation)*** and click **"Execute Side-by-Side Comparison"**.
2. Open **Tab 2 ("FrugalGPT Routing & Cascade Audit")**.
   * **What to say:**
     > "If a staff engineer in the room asks: *'What happens when Gemini 2.5 Flash gets a hard distributed-systems proof wrong?'* — here is the answer.
     >
     > Apigee tries `gemini-2.5-flash` ($L_1$) first. Our post-generation scorer $g(q, a)$ inspects the response, detects the `[REQUIRES_DEEP_REASONING]` marker / low reliability score ($g < 0.80$), rejects the Flash draft, and **automatically escalates to `gemini-2.5-pro` ($L_2$)**.
     >
     > Most importantly, look at the cost accounting: when a cascade escalates, we **bill both the $L_1$ attempt and the $L_2$ completion**. Even paying that occasional cascade penalty on the 15% of queries that need frontier reasoning, look at the **Cumulative Session Ledger** at the top of the screen: across the full enterprise workload mix, the gateway delivers **60%–85%+ net cost savings**—worth millions of dollars per year on the projection slider."
