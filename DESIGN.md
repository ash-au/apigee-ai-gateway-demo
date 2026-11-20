---
name: Apigee X AI Economics & Governance Gateway
description: Archival FinOps Ledger visual system for live side-by-side Vertex AI vs. Apigee X telemetry, native AI policies, and System 1/System 2 routing.
colors:
  light-canvas: "#F6F4EF"
  light-sheet: "#FAF9F6"
  light-well: "#EFECE5"
  light-hairline: "#D8D3C8"
  light-ink-primary: "#141618"
  light-ink-secondary: "#52504A"
  light-accent-teal: "#164E63"
  light-accent-teal-tint: "#E3EFF2"
  light-accent-amber: "#923E05"
  light-accent-amber-tint: "#FBF1E1"
  light-savings-emerald: "#14643E"
  light-savings-emerald-tint: "#E6F3EC"
  light-alert-crimson: "#A61C1C"
  light-alert-crimson-tint: "#FAE8E8"
  light-jev-plum: "#6D2878"
  light-jev-plum-tint: "#F3EAF5"
  dark-canvas: "#0E1012"
  dark-sheet: "#15181B"
  dark-well: "#1C2024"
  dark-hairline: "#2B3036"
  dark-ink-primary: "#EDEAE2"
  dark-ink-secondary: "#A3A096"
  dark-accent-teal: "#38BDF8"
  dark-accent-teal-tint: "#132A35"
  dark-accent-amber: "#FBBF24"
  dark-accent-amber-tint: "#2C2314"
  dark-savings-emerald: "#4ADE80"
  dark-savings-emerald-tint: "#13291F"
  dark-alert-coral: "#F87171"
  dark-alert-coral-tint: "#2D1819"
  dark-jev-lavender: "#D8B4FE"
  dark-jev-lavender-tint: "#271A2F"
typography:
  display:
    fontFamily: "'Newsreader', Georgia, 'Times New Roman', serif"
    fontSize: "clamp(1.75rem, 2.6vw, 2.35rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Newsreader', Georgia, 'Times New Roman', serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.005em"
  body:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0em"
  label:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.01em"
  mono:
    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.45
    fontFeature: "'tnum' 1, 'lnum' 1"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  pill: "999px"
spacing:
  unit: "4px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.light-accent-teal}"
    textColor: "{colors.light-sheet}"
    rounded: "{rounded.sm}"
    height: "44px"
    padding: "0 20px"
  button-outline:
    backgroundColor: "{colors.light-sheet}"
    textColor: "{colors.light-ink-primary}"
    rounded: "{rounded.sm}"
    height: "36px"
    padding: "0 14px"
  ledger-cell:
    backgroundColor: "{colors.light-sheet}"
    textColor: "{colors.light-ink-primary}"
    padding: "16px 20px"
  switch-control:
    height: "36px"
    width: "48px"
    rounded: "{rounded.pill}"
---

# Design System: Apigee X AI Economics & Governance Gateway

## Overview

**Creative North Star: "Archival FinOps Ledger"**

This system draws its material truth from a **contemporary financial broadsheet & research ledger** (`mode: operate + read`). Instead of generic floating dark SaaS cards or decorative enterprise dashboards, the UI behaves like an authoritative live audit instrument: warm archival paper sheets in Light mode and machined carbon obsidian in Dark mode, joined by exposed `1px` structural hairlines, crisp editorial serif headlines (`Newsreader`), disciplined UI typography (`Plus Jakarta Sans`), and relentless tabular monospace precision (`JetBrains Mono`) for every dollar, token, millisecond, and probability score.

The emotional register is **calm, verifiable, and analytical**—built to hold executive credibility on a bright conference projector while surviving close staff-engineer inspection of raw JSON payloads, Apigee XML policies, and 5-head `Noul` probability bars.

**Key Characteristics:**
- **Open Canvas & Structural Hairlines:** Adjacent ledger cells, comparison panes, and telemetry rows share crisp `1px` rules instead of floating shadow-wrapped cards.
- **Dual-Mode Archival Precision:** First-class **Archival Paper (Light)** and **Carbon Obsidian (Dark)** palettes, both verified at WCAG AA (`>= 4.5:1`, with nearly all ink pairs exceeding `6.0:1`), governed by a manual theme toggle persisted in `localStorage` (`data-theme="light|dark"`).
- **Evidence-First Visuals:** Four live telemetry visualizations—an active SVG Apigee X Request Pipeline Diagram, Economics & Quota comparison charts, a Tab 5 5-Head `Noul` Battery probability meter with a threshold gate line, and purposeful exponential state motion.
- **Uncompromising Craft Floor:** Strict `>= 12px` type floor, zero `border-left: 3px solid` status stripes, zero uppercase tracked eyebrow kickers, zero nested cards, and zero drop shadows outside modals.

---

## Colors

Warm archival mineral neutrals anchor reading comfort so that a single primary signal accent (Teal) and four calibrated semantic inks (Savings Emerald, Alert Crimson/Coral, Secondary Amber, and System 1 Jev Plum/Lavender) carry unambiguous operational meaning.

### Semantic CSS Custom Properties (Light & Dark)

Theme activation resolves in strict order: explicit `<html data-theme="light|dark">` (persisted via `localStorage.getItem('apigee-demo-theme')`) overrides `@media (prefers-color-scheme: dark)`.

```css
:root,
[data-theme="light"] {
  color-scheme: light;

  /* Archival Paper Surfaces & Rules */
  --bg-canvas: #F6F4EF;           /* Warm archival paper page canvas */
  --bg-sheet: #FAF9F6;            /* Elevated ledger sheet / primary surface */
  --bg-well: #EFECE5;             /* Recessed input well / code & chart track */
  --border-hairline: #D8D3C8;     /* Structural 1px ledger seam */

  /* Ink Hierarchy */
  --ink-primary: #141618;         /* Primary ledger ink (16.5:1 on canvas) */
  --ink-secondary: #52504A;       /* Muted metadata & captions (7.3:1 on canvas) */
  --ink-on-accent: #FAF9F6;       /* High-contrast label on solid primary CTA (8.7:1) */

  /* Primary Signal Accent (Single Dominant Voice) */
  --accent-primary: #164E63;      /* Deep Teal — active tabs, primary CTA, live pipeline hop */
  --accent-primary-tint: #E3EFF2; /* Soft teal wash for active pills & callouts (7.8:1 ink) */

  /* Secondary & Semantic Status Tokens */
  --accent-amber: #923E05;        /* Oxidized Amber — governance warning, thinking tokens, cache warm */
  --accent-amber-tint: #FBF1E1;   /* Amber wash (6.4:1 ink) */
  --status-savings: #14643E;      /* Savings Emerald — cost/token reduction, pass, cache hit */
  --status-savings-tint: #E6F3EC; /* Emerald wash (6.3:1 ink) */
  --status-alert: #A61C1C;        /* Alert Crimson — Model Armor block, 429 quota arrest, Noul breach */
  --status-alert-tint: #FAE8E8;   /* Crimson wash (6.3:1 ink) */
  --accent-jev: #6D2878;          /* Jev System 1 Plum — TypeSafe Jev routing & Noul primitives */
  --accent-jev-tint: #F3EAF5;     /* Plum wash (8.0:1 ink) */

  /* Modal Scrim & Elevation (Reserved Strictly for Modals) */
  --scrim-modal: rgba(20, 22, 24, 0.54);
  --shadow-modal: 0 20px 48px rgba(20, 22, 24, 0.22);
}

[data-theme="dark"] {
  color-scheme: dark;

  /* Carbon Obsidian Surfaces & Rules */
  --bg-canvas: #0E1012;           /* Deep obsidian canvas */
  --bg-sheet: #15181B;            /* Elevated ledger sheet */
  --bg-well: #1C2024;             /* Recessed code block / meter track / input well */
  --border-hairline: #2B3036;     /* Crisp obsidian 1px hairline */

  /* Ink Hierarchy */
  --ink-primary: #EDEAE2;         /* Warm archival ivory ink (15.9:1 on canvas) */
  --ink-secondary: #A3A096;       /* Warm muted stone ink (7.3:1 on canvas) */
  --ink-on-accent: #0E1012;       /* Dark obsidian ink on luminous sky-teal CTA (8.9:1) */

  /* Primary Signal Accent */
  --accent-primary: #38BDF8;      /* Sky Teal — active state, primary CTA, active SVG hop */
  --accent-primary-tint: #132A35; /* Deep teal tint surface (7.0:1 ink) */

  /* Secondary & Semantic Status Tokens */
  --accent-amber: #FBBF24;        /* Amber Phosphor — governance caution, thinking tokens */
  --accent-amber-tint: #2C2314;   /* Warm amber dark wash (9.3:1 ink) */
  --status-savings: #4ADE80;      /* Savings Emerald — cost reduction, pass, cache short-circuit */
  --status-savings-tint: #13291F; /* Emerald dark wash (8.8:1 ink) */
  --status-alert: #F87171;        /* Alert Coral — Model Armor block, 429 arrest, Noul fire */
  --status-alert-tint: #2D1819;   /* Coral dark wash (6.0:1 ink) */
  --accent-jev: #D8B4FE;          /* Jev Lavender — System 1 Jev telemetry & Noul badges */
  --accent-jev-tint: #271A2F;     /* Lavender dark wash (9.3:1 ink) */

  /* Modal Scrim & Elevation */
  --scrim-modal: rgba(0, 0, 0, 0.72);
  --shadow-modal: 0 24px 56px rgba(0, 0, 0, 0.62);
}
```

### Primary
- **Deep Teal / Sky Teal** (`#164E63` Light · `#38BDF8` Dark, tint `#E3EFF2` / `#132A35`): Single dominant interactive signal—solid primary Execute CTA, active tab underline, focused inputs, active SVG pipeline path, and Apigee Gateway cost bars.

### Secondary & Semantic
- **Oxidized Amber / Amber Phosphor** (`#923E05` Light · `#FBBF24` Dark, tint `#FBF1E1` / `#2C2314`): Thinking-token segments (`thoughtsTokenCount`), Vector Search idle/warm state, semantic governance cautions, and cascade escalation notices.
- **Savings Emerald** (`#14643E` Light · `#4ADE80` Dark, tint `#E6F3EC` / `#13291F`): Verified token/cost reductions, semantic cache hits (`0` LLM tokens), passed safety checks, and accepted $L_1$ runs.
- **Alert Crimson / Alert Coral** (`#A61C1C` Light · `#F87171` Dark, tint `#FAE8E8` / `#2D1819`): Model Armor blocks (`HTTP 400`), `PromptTokenLimit` / `LLMTokenQuota` arrests (`HTTP 429`), semantic governance rejections (`HTTP 422`), and `Noul` heads breaching `fire_threshold`.
- **Jev System 1 Plum / Jev Lavender** (`#6D2878` Light · `#D8B4FE` Dark, tint `#F3EAF5` / `#271A2F`): Reserved strictly for Tab 5 TypeSafe Jev primitives (`Choice`, `Score`, `Noul` battery), System 1 overhead tags, and the System 1 Glossary trigger.

### Neutral
- **Canvas (`#F6F4EF` / `#0E1012`):** Open-canvas backdrop behind the masthead, primary tab rail, and structural workspace regions.
- **Elevated Sheet (`#FAF9F6` / `#15181B`):** Ledger cells, comparison columns, scenario lists, and modal dialog sheets.
- **Recessed Well (`#EFECE5` / `#1C2024`):** Prompt editors, raw JSON/XML audit blocks, progress/chart tracks, and inline code spans.
- **Hairline (`#D8D3C8` / `#2B3036`):** Every `1px solid` structural seam dividing rows, columns, and drawers.
- **Primary & Secondary Ink (`#141618` & `#52504A` Light · `#EDEAE2` & `#A3A096` Dark):** All prose, headings, labels, and tabular figures.

### Named Rules
**The One Signal Accent Rule.** Deep Teal / Sky Teal is the sole primary interactive voice across all 5 tabs. Semantic accents (Emerald, Crimson/Coral, Amber, Jev Plum/Lavender) appear strictly to encode verified telemetry state—never as arbitrary decoration.
**The Tinted-Surface Ink Rule.** Text placed inside any semantic tint wash (`--accent-*-tint`, `--status-*-tint`) must use its paired semantic ink or `--ink-primary`—never muted neutral gray.

---

## Typography

**Display & Ledger Title Font:** `Newsreader` (fallback: `Georgia, 'Times New Roman', serif`)  
**UI Controls & Prose Font:** `Plus Jakarta Sans` (fallback: `-apple-system, BlinkMacSystemFont, sans-serif`)  
**Telemetry & Code Font:** `JetBrains Mono` (fallback: `'SFMono-Regular', Menlo, Consolas, monospace`)

**Character:** Editorial financial gravity meets precision instrumentation. `Newsreader` lends broadsheet authority to the masthead, section ledger titles, and modal headings; `Plus Jakarta Sans` keeps dense controls, toggles, and scenario descriptions crisp; `JetBrains Mono` enforces column-aligned numerical honesty across every token, cost, latency, quota, and probability metric.

### Hierarchy
- **Display (Masthead H1):** `Newsreader`, `600`, `clamp(1.75rem, 2.6vw, 2.35rem)`, line-height `1.15`, tracking `-0.02em`, `text-wrap: balance`.
- **Headline (Section & Modal H2 / Ledger Big Figures):** `Newsreader`, `600`, `1.25rem` (`20px`) for headings (`text-wrap: balance`); `JetBrains Mono`, `600`, `1.5rem` (`24px`, `tabular-nums`) for primary ledger figures (`$0.000000`, `99.9%`).
- **Title (Pane Headings H3 & Tab Titles):** `Plus Jakarta Sans`, `600`, `0.9375rem` (`15px`), line-height `1.35`, tracking `-0.005em`.
- **Body (Prose, Model Completions, Scenario Descriptions):** `Plus Jakarta Sans`, `400`, `0.875rem` (`14px`), line-height `1.55`, `text-wrap: pretty`, reading measure constrained to `55ch–75ch`.
- **Label & Table Headers:** `Plus Jakarta Sans`, `600`, `0.75rem` (`12px` minimum floor), line-height `1.35`, sentence or title case—never tracked uppercase micro-kickers.
- **Telemetry & Code (`code`, `<pre>`, metrics, HTTP headers, probabilities):** `JetBrains Mono`, `500`, `0.8125rem` (`13px`) default (`0.75rem` / `12px` strict minimum for dense metadata), `font-variant-numeric: tabular-nums lining-nums`.

### Named Rules
**The 12px Floor Rule.** No rendered text anywhere in the application—including chart tick labels, SVG pipeline captions, badges, and footer notes—may drop below `12px` (`0.75rem`).
**The Tabular Numerals Rule.** Every currency amount, token count, latency readout, percentage delta, quota balance, and `0.00–1.00` Jev probability must render in `JetBrains Mono` with `font-variant-numeric: tabular-nums` so side-by-side columns never jitter during live updates.
**The Measure & Balance Rule.** All display and section headings set `text-wrap: balance`; all explanatory prose and LLM response containers set `text-wrap: pretty` and constrain prose columns to `55ch–75ch`.

---

## Layout

The workspace uses an **open archival canvas** (`max-width: 1380px`, horizontal padding `24px` desktop / `16px` mobile) structured by horizontal and vertical `1px solid var(--border-hairline)` seams rather than detached floating boxes.

- **Masthead:** Sits directly on `--bg-canvas` separated from the tab rail by a `1px` bottom rule; title + subtitle + live environment metadata left, utility controls (Theme Switcher, Glossary, Architecture & Pricing, Reset) right.
- **Primary 5-Tab Navigation Rail:** Full-width horizontal hairline strip directly beneath the masthead; active tab indicated by a crisp `2px` bottom rule in `--accent-primary` and sheet-tone lift (`--bg-sheet`), wrapping cleanly or scrolling horizontally below `900px`.
- **Joined Ledger Strip (Tab 1 Cumulative Economics):** A 5-column horizontal grid where adjacent cells sit flush inside one outer `1px` frame divided by internal `1px` vertical rules (`gap: 1px; background: var(--border-hairline)`), collapsing to 2 columns below `1024px` and 1 column below `640px`.
- **Control Deck & Comparison Grid:** 2-column asymmetric or balanced split (`1fr 1fr` comparison panes, `1.15fr 0.85fr` control deck) separated by a `16px` gutter or shared `1px` ledger divider; collapses cleanly to single column below `960px`.
- **Staff Engineer Inspection Drawer:** Anchored below the side-by-side comparison on each tab with a hairline-ruled sub-tab strip and `2`-column diff/header wells (`--bg-well`).
- **Spacing Rhythm:** Strict `4px` base unit (`4px`, `8px`, `12px`, `16px`, `24px`, `32px`), always giving more space above a section heading (`24px–32px`) than below it (`12px–16px`).

---

## Elevation & Depth

This system is **flat by structural discipline**. Hierarchy comes from **surface tonal stepping** (`--bg-canvas` → `--bg-sheet` → `--bg-well`) and **exposed `1px` hairline seams** (`--border-hairline`)—never from drop shadows on workspace panels or cards.

### Shadow Vocabulary
- **Modal Dialog Elevation (`--shadow-modal`):**
  - Light: `box-shadow: 0 20px 48px rgba(20, 22, 24, 0.22);` over `--scrim-modal` (`rgba(20, 22, 24, 0.54)`).
  - Dark: `box-shadow: 0 24px 56px rgba(0, 0, 0, 0.62);` over `--scrim-modal` (`rgba(0, 0, 0, 0.72)`).
- **All Other Surfaces:** `box-shadow: none`.

### Named Rules
**The Zero Card-Shadow Rule.** Cards, ledger bands, panels, comparison columns, scenario rows, and telemetry drawers never carry `box-shadow`. Shadows exist exclusively on modal dialogs (`#about-modal`, `#jev-glossary-modal`) to separate interruptive reference overlays from the ledger canvas.

---

## Shapes

Architectural precision with restrained corners:

- **Ledger Sheets, Panels & Comparison Panes:** `8px` (`--radius-md`) outer frame, with square `0px` internal seams where joined ledger cells meet.
- **Buttons, Inputs, Selectors & Chart Bars:** `6px` (`--radius-sm`) for interactive controls; `4px` (`--radius-xs`) for tight inline badges, code pills, and horizontal chart bar caps.
- **Switches & Status Indicators:** `999px` (`--radius-pill`) reserved strictly for toggle switch tracks/thumbs and compact status pills.
- **Borders:** Single `1px solid var(--border-hairline)` perimeter; active selection shifts border color to `--accent-primary` (or semantic ink) without inflating border width beyond `1px–2px` and never adding thick left-edge stripes.

---

## Components

### Buttons & Action Hierarchy
- **One Solid Primary CTA Per View:** `height: 44px`, `padding: 0 20px`, `border-radius: 6px`, `background: var(--accent-primary)`, `color: var(--ink-on-accent)`, `font-weight: 600`. Only the primary Execute button on the active tab uses the solid fill.
- **Secondary Outline & Utility Buttons:** `height: 36px`, `background: var(--bg-sheet)`, `border: 1px solid var(--border-hairline)`, `color: var(--ink-primary)`, hover shifts to `--bg-well` and darkens hairline.
- **Focus Ring:** `2px solid var(--accent-primary)` with `2px` offset on `:focus-visible`.

### Accessible Switches & Inputs
- **Policy Toggle Switches (`role="switch"`):** Visually crisp pill track (`36px × 20px`) inside a guaranteed **`36px` minimum interactive hit box** (`min-height: 36px; min-width: 48px` clickable label target) with clear checked/unchecked ink contrast and keyboard focus ring.
- **Prompt Composer & Threshold Inputs:** Recessed `--bg-well` surface, `1px solid var(--border-hairline)`, `6px` radius, `14px` UI font (`13px` `JetBrains Mono` for JSON/header fields), focus border transitions to `--accent-primary`.

### Theme Switcher
- Compact segmented or single-action toggle in the masthead switching `<html data-theme="light">` / `<html data-theme="dark">`, persisting to `localStorage`, defaulting on first visit to `window.matchMedia('(prefers-color-scheme: dark)')`, with crisp drawn SVG sun/moon icon (`16px`, `1.5px` stroke, no emoji).

### Ledger Rows & Scenario Lists
- Open hairline list rows inside a single `--bg-sheet` container separated by `1px solid var(--border-hairline)` dividers—never stacked individual rounded cards. Active scenario row uses `--accent-primary-tint` background and `--accent-primary` title ink (never a `border-left: 3px solid` stripe).

### Browser Surfaces
- Theme `::selection` (`background: var(--accent-primary-tint); color: var(--ink-primary)`), `caret-color: var(--accent-primary)`, `text-underline-offset: 3px`, and subtle custom scrollbars styled with `--bg-well` tracks and `--border-hairline` thumbs.

### Signature Visual Moves (4 Core Telemetry Components)

1. **Live SVG Apigee X Request Pipeline Diagram:**
   - Crisp geometric horizontal SVG node-and-edge schematic (`1.5px` strokes, `>= 12px` labels, bound strictly to CSS tokens) depicting the live Apigee X hops per tab: Client → Apigee PreFlow (Cache / Compression / PromptTokenLimit / Model Armor Inbound / Jev Stage 1) → RouteRule (`Route-CacheShortCircuit` | `Route-VertexFlash` | `Route-VertexPro`) → PostFlow (Model Armor Outbound / LLMTokenQuota / Jev Stage 2 5-Head `Noul` Battery / Cascade Escalation) → Response.
   - Illuminates the **actual executed path** returned by each run: Cache Hit short-circuits in `--status-savings`, Model Armor or Quota arrest halts at the enforcing node in `--status-alert`, Compression lights in `--accent-primary`, and $L_1 \to L_2$ Escalation traces the escalation arc in `--accent-amber` / `--accent-jev`.

2. **Visual Economics & Quota Charts:**
   - **Direct vs. Apigee X Cost Bar Comparison:** Paired horizontal bars (`--ink-secondary` baseline vs. `--accent-primary` or `--status-savings` gateway bar) with aligned tabular dollar figures and exact percentage delta.
   - **Stacked Token Composition Bars:** Proportional horizontal stacked segments for Prompt (`--accent-primary`), Output (`--status-savings`), Internal Thinking `thoughtsTokenCount` (`--accent-amber`), and Gateway Overhead (`--accent-jev` or `--ink-secondary`), with a clear inline legend.
   - **LLMLingua-2 Compression Ratio Meter:** Before-vs.-after proportional reduction bar displaying original tokens, compressed tokens, and achieved ratio against the `0.55` target.
   - **Token FinOps Quota Fuel Gauge (Tab 2):** Linear segmented capacity meter showing consumed vs. remaining rolling 1-minute `LLMTokenQuota` tokens, shifting from `--status-savings` to `--accent-amber` (`>= 75%`) and `--status-alert` (`100%` / `HTTP 429`).

3. **Tab 5 Visual 5-Head `Noul` Battery Probability Meter:**
   - Five stacked horizontal probability tracks spanning `0.00` to `1.00` (`hallucinated_or_contradicts_context`, `missed_user_constraint`, `superficial_or_unproven`, `internal_contradiction`, `hedging_or_refusal`), rendered on `--bg-well` with a crisp **dashed vertical `fire_threshold` gate line** (positioned dynamically at the configured threshold, default `0.70`).
   - Bars below threshold fill in `--accent-jev`; any head exceeding `fire_threshold` highlights in `--status-alert` (Crimson/Coral) with an explicit `FIRES` tabular readout.
   - Directly below a `1px` hairline divider sits the **Holistic Single-Judge (`__overall__::holistic_escalate_judge`)** reference bar on the identical `0.00–1.00` scale, visually proving why a decomposed `Noul` battery catches defects that a single holistic judge averages away.

4. **Purposeful State Motion:**
   - Chart bar fills, quota meters, and `Noul` probability bars animate width/scale using exponential ease-out `cubic-bezier(0.16, 1, 0.3, 1)` (`380ms–520ms`).
   - While a live request is in flight, the active hop in the SVG Pipeline Diagram pulses subtly along its stroke/node ring to communicate live backend latency without blocking UI interaction.
   - All transitions and keyframe animations collapse cleanly under `@media (prefers-reduced-motion: reduce)` (`animation: none; transition-duration: 0.01ms`).

---

## Do's and Don'ts

### Do:
- **Do** join adjacent ledger metrics, scenario items, and audit rows with exposed `1px solid var(--border-hairline)` seams inside shared `--bg-sheet` containers.
- **Do** enforce the `>= 12px` minimum font size everywhere, `text-wrap: balance` on `Newsreader` headings, `text-wrap: pretty` + `55ch–75ch` measure on body copy, and `tabular-nums` on every numerical telemetry readout.
- **Do** keep exactly one solid primary CTA (`44px` height, `--accent-primary`) per active tab view and maintain `>= 36px` hit targets on all toggle switches and interactive buttons.
- **Do** drive the SVG Pipeline Diagram, Economics/Quota charts, and 5-Head `Noul` Battery meter directly from live BFF response telemetry with zero fudged values.
- **Do** respect `data-theme="light|dark"` (persisted in `localStorage`), `prefers-color-scheme`, WCAG AA (`>= 4.5:1`) contrast, and `prefers-reduced-motion: reduce`.

### Don't:
- **Don't** use `border-left: 3px solid` (or any colored side-stripe border `> 1px`) on scenario items, alerts, callouts, or ledger cards.
- **Don't** render `<12px` uppercase tracked eyebrow kickers above section headings or panel titles—let `Newsreader` and `Plus Jakarta Sans` headings carry their own hierarchy.
- **Don't** wrap every list row or telemetry item in separate rounded boxes or nest cards inside cards.
- **Don't** apply `box-shadow` to cards, ledger bands, panels, or buttons—reserve elevation shadows exclusively for modal dialogs.
- **Don't** use gradient text, decorative glassmorphism blur, emoji as UI icons, or un-themed default browser chrome (`::selection`, focus rings, scrollbars).
