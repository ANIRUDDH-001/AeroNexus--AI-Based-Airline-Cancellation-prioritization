# AeroNexus console — design spec ("Sodium night")

Date: 2026-09-13, revision 3 (after two review rounds). Status: awaiting approval.
Replaces `apps/occ/DESIGN.md` (the rejected "night ops" palette).

## 1. Purpose and audience

AeroNexus recommends which flights to cancel, hold or re-fleet when a day goes wrong, and shows why. The console is
the product a duty manager in an airline Operations Control Centre would use, and the thing examiners (technical or
not) will judge. Every recommendation must visibly answer three questions in order: **what happens if nobody acts →
what should I do → what downstream damage does that avoid.**

Understanding is layered, and the layout follows the layers:

| within | the reader knows | where |
|---|---|---|
| 10 s | what is wrong today | headline, KPI row |
| 30 s | what to do | recommended plan: do this, why, result |
| 60 s | why it is right | causal chain, before/after board, "why plan 1 over plan 2" |
| 5 min | how the engine got there | expanded plan: search result, sampled futures, ML pre-ranking |
| 10 min+ | how the system works | How it works, Parameters, Cases, Runs |

The console replaces `apps/web` (Vite). It lives in `apps/occ` (Next.js 16 App Router, React 19, Tailwind v4,
Radix primitives styled shadcn-style, Recharts for charts, d3-geo for the map). Core engine behaviour is unchanged;
the API contract gains two small additions required by the console (§10.4), both already written in the working
tree and to be committed before Phase 0.

## 2. Decisions already taken

| Topic | Decision |
|---|---|
| Structure | One operations screen; disruptions through a side sheet; six secondary pages (§4). |
| Clarity | Inline plain-language definition on every number; a live "How it works" page. Guided tour deferred. |
| Impact unit | Outcomes first (flights, passengers, minutes), rupees second, the network impact score on hover. |
| Visual direction | "Sodium night" (§3). Dark is the design; a light theme is a Phase 4 derivation. |
| Order of work | Major overhauls first, polish (motion) after, PWA and gestures last (§14). |
| Review round 1 | Do-nothing as a first-class baseline; plan cards reordered (do this → why → result → reliability → accept); causal chain visible by default; "changes only" board mode; decision-time semantics visible; demo mode unmistakable; engine / search / ML / narration reasoning kept distinct; post-acceptance "what changed"; API contract matrix and generated types as a Phase 0 gate; basic phone chrome in Phase 1. |
| Review round 2 | "Impact avoided if we act" as the heading of the prevents block; the recommended card's first three blocks own the initial viewport, result and reliability subordinate below a rule; recommendation status pill (Recommended / Accepted / Overridden); reliability wording "lowest-impact plan in 7 of 10 sampled futures"; "protected" defined precisely and given a glyph; hover intent 250 ms; changes-only view cannot trap the user; What-changed panel persists across navigation; demo/live parity check and stale-bundle warning in Phase 0; implementation rules (§17). |

## 3. Visual system

**Idea.** A dark room; what matters is lit. Warm graphite surfaces (anodised aluminium, not navy, not black), ivory
text (low glare), and one warm colour — sodium amber, the colour Indian cities glow from orbit — reserved for what is
"lit up": the decision-time line, at-risk flights, airports on the map. Failures are coral, clear is mint, weather
is a cool lilac wash. Depth comes from wells (cut in) and panels (raised), never from shadows or gradients; the only
soft light in the interface is the halo on the night map.

### 3.1 Colour tokens

| token | value | use |
|---|---|---|
| `graphite` | `#141518` | page ground |
| `well` | `#0D0E10` | inset areas: board canvas, map, table heads, inputs |
| `panel` | `#1B1C20` | raised surfaces |
| `panel-2` | `#25262B` | hover rows, selected nav, segmented control track |
| `hairline` | `rgba(255,255,255,.07)` | borders, grid lines |
| `hairline-strong` | `rgba(255,255,255,.13)` | control borders, outlines |
| `ivory` | `#EFEAE0` | text, primary button fill, selection |
| `ivory-2` | `#A8A399` | secondary text |
| `ivory-3` | `#6C6862` | muted text, axes, placeholders |
| `amber` | `#F0B345` | attention: now-line, at risk, delayed, airport lights, focus ring |
| `coral` | `#FF5F52` | cancels itself, forced, infeasible, destructive |
| `mint` | `#58D08F` | on time, feasible, accepted, protected, engine online |
| `lilac` | `#B39BF5` | weather and other disruptions |
| `strip` / `strip-text` / `strip-edge` | `#26272C` / `#E6E1D6` / `#4A4B52` | a flight strip at rest |
| `strip-delay` | `#302B22` | delayed / at-risk strip fill (lifted from the first draft for cheap monitors) |
| `strip-cancel` | `#2C1D1C` | cancelled strip fill (with coral hatch) |

Rules: amber, coral, mint and lilac mean flight or engine state and nothing else. The primary action is ivory on
graphite; there is no blue anywhere. Washes are the state colour at 10–14 % over the surface. Focus ring: 2 px amber,
2 px offset. Every text/background pair meets WCAG AA (ivory-3 on panel is used only for non-essential text).
State is never carried by colour alone: every state has a name in the legend, the popover and the `aria-label`, and
a non-colour mark that survives red–green colour blindness — hatch and strike-through for cancels itself, a dashed
outline for at risk, the "+40" text for delayed, a check glyph for protected, a pin for committed, a mono "was
VT-IAD" label for re-fleeted. Mint and coral are never the only difference between two strips.

### 3.2 Type

- **Archivo** (variable, `wdth` 75–125, `wght` 400–700; `next/font/google` with `axes: ["wdth"]`, automatic
  fallback metrics so nothing jumps while the font loads).
  - Headline sentence: `wdth` 90, 600, 34 px / 1.12, tracking −0.015 em (28 px tablet, 24 px phone). The numbers
    inside it are `<span>`s with `tabular-nums`; the axis is fixed, so the only reflow is the sentence itself changing.
  - Section titles 15/600. Body 14/1.45. UI 13. Small 12. Micro 11 (axis labels, pills).
  - Numbers everywhere: `font-variant-numeric: tabular-nums`. KPI values 22/600; plan score 18/600.
- **IBM Plex Mono** 400/500, only for flight numbers, tails, times, hashes. Never for labels.
- Sentence case throughout. No uppercase eyebrows, no middle-dot meta strings, no arrows on buttons.

### 3.3 Shape, space, motion

- Radius encodes hierarchy: panels 8 px, controls 6 px, strips 3 px, pills full.
- 4 px grid. Page padding 24 (desktop) / 16 (phone). Panel padding 14. Column gutter 20.
- Motion only answers an action (§14 Phase 4). No entrance animations, no hover lifts.
- The single ambient motion is the halo pulse on the map for disruptions that **no recommendation at this decision
  time has considered yet** (all of them when there is no run). All pulses are driven by one clock (a single
  `requestAnimationFrame` loop writing `--pulse` on the map root), so the map breathes as one unit rather than
  flickering out of phase. Under `prefers-reduced-motion` the pulse is a static ring.
- Icons: lucide, 16 px, stroke 1.75, ivory-2; never decorative.

### 3.4 Voice

Plain verbs, sentence case, the user's vocabulary: "cancels itself", "re-fleet", "hold", "stranded overnight",
"if nobody acts". Buttons say what happens: "Get a recommendation", "Accept plan 1", "Add and re-propagate".
Errors state what happened and what to do. Empty states invite the next action. Operational wording for status
("Engine unavailable"), technical wording only in detail popovers ("Render instance sleeping").

## 4. Information architecture and navigation

Routes (all under one `(console)` layout):

| route | page | primary job |
|---|---|---|
| `/` | Operations | the day, the risk, the plans, the decision |
| `/flights` | Flights & resources | look anything up; edit attributes |
| `/runs` | Runs | every recommendation ever made, with its audit trail |
| `/parameters` | Parameters | what the engine optimises and how hard it searches |
| `/cases` | Cases & benchmarks | evidence that it works |
| `/data` | Data | which days exist; generate or import a day |
| `/how-it-works` | How it works | the pipeline explained with today's numbers |

Global state lives in the URL: `?day=<instance id>&t=<minutes>` on every route, `&run=<id>` on Operations and Runs,
`&view=` on phones (§9), `&sheet=disruptions` when the sheet is open. `localStorage` remembers the last day and time
as defaults only. First load with nothing remembered opens the demo day (fog at Delhi + VT-IAD on ground) at 05:00
with its precomputed recommendation, so the whole story is on screen at first paint.

**Top bar (48 px, `panel`).** Left: wordmark and page tabs. Right, the decision cluster, visually heavier than the
tabs: the day switcher ("Medium synthetic day", with "Seed 1, 259 flights, 32 airports" and a `Synthetic` pill in its
popover), the clock control (label "Decision time", value `05:00` at 15/600; the popover has a 15-minute slider,
quick times, and "Everything before this time has already happened; the engine decides from here"), and engine
status.

**Engine status** has four user-facing states: online (mint dot, "Engine online"), starting (amber dot pulsing,
"Starting the engine, usually under a minute", with elapsed time), unavailable (ivory-3 dot, "Engine unavailable",
a "Wake engine" button, auto-probe every 15 s), error (coral, the message). While unavailable the console runs on
the precomputed bundle and says so in three places: a persistent `Demo data, precomputed, read-only` pill next to
the status; a one-line banner under the top bar ("The engine is unavailable, so this is the precomputed demo day.
Wake it to run your own scenarios."); and a `Demo result` tag on every result that came from the bundle. Results
from the live engine carry `Live engine` instead. Every write control knows whether it is live, demo or
unavailable and says which when disabled.

Tablet: tabs collapse to Operations, Flights, Runs, More. Phone: bottom tab bar (§9).

## 5. The Operations screen

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ▣ AeroNexus  Operations Flights Runs Parameters Cases Data How it works           │
│                          Medium synthetic day ▾   Decision time 05:00 ▾  ● Engine online │
├──────────────────────────────────────────────────────────────────────────────────┤
│ If nobody acts, 11 flights cancel themselves today and 704 passengers are        │
│ stranded overnight.                                                              │
│ Fog at Delhi until about 09:30 (end uncertain); VT-IAD on ground. 12 flights     │
│ have already departed; 247 remain under consideration from 05:00.                │
│ 44 at risk   11 cancel themselves   34 delayed   274 missed connections   704 …   │
├───────────────────────────────────────────────┬──────────────────────────────────┤
│ Rotations   7 of 46 tails, sorted by risk     │ Disruptions        Add disruption│
│ [If nobody acts | With plan 1 | Changes only] │ [Fog, DEL, 05:00–09:30 ±] [AOG]  │
│ [Day | 12 h | 6 h]                            ├──────────────────────────────────┤
│ 04:00   06:00   08:00   10:00   12:00 …       │ At risk now (44)     show all    │
│ VT-IAD ▌6E 2011▌ ▌6E 2012▌ …   (coral hatch)  │ 6E 2011 DEL–BOM 05:40 no aircraft│
│ VT-IFM   ▌6E 2134 DEL–BOM▌ ▌6E 2135▌ …        │ …                                │
│ …  already happened ┃ 05:00 decision time     ├──────────────────────────────────┤
│ legend: on time · delayed · at risk · cancels │ Network   (India at night)       │
│         itself · cancelled by plan · pinned   │ DEL 22 at risk  BOM 6  JAI 4     │
├───────────────────────────────────────────────┼──────────────────────────────────┤
│ Plans at 05:00   Live engine · 10 futures · 2.1 s          [Run again]│ Today's decisions                │
│ ┌ If nobody acts ─┐ ┌ Recommended: plan 1 ───────────────┐ ┌ Plan 2 ┐│ 05:00 plan 1 accepted            │
│ │ 11 cancel       │ │ Cancel 6E 2011; re-fleet 6E 2087   │ │ Hold … ││ 05:00 fog added                  │
│ │ 704 stranded    │ │ Prevents 8 cancellations, 586      │ │ …      ││                                  │
│ │ ₹28.6 lakh      │ │ stranded passengers, 1,300 min     │ │        ││                                  │
│ │                 │ │ Why: cancel 6E 2011 → VT-IFM free  │ └────────┘│                                  │
│ │                 │ │   at DEL 06:10 → 6E 2087 operates  │ ┌ Plan 3 ┐│                                  │
│ │                 │ │ result table · reliability         │ │ Wait   ││                                  │
│ │                 │ │ [Accept plan 1][Show changes][Why  │ │        ││                                  │
│ │                 │ │  plan 1 over plan 2?]              │ └────────┘│                                  │
│ └─────────────────┘ └────────────────────────────────────┘           │                                  │
└──────────────────────────────────────────────────────────────────────┴──────────────────────────────────┘
```

Left-aligned throughout; numbers right-aligned in tables. Desktop grid: board `minmax(0,1fr)`, right column 400 px
(420 px at ≥1536). Content fills the viewport; no max-width.

**Tiers, enforced.** Tier 1 (always visible, full contrast): headline, KPI row, the baseline card, the recommended
plan's do-this / prevents / why / accept. Tier 2 (visible, quieter): board, at-risk list, alternatives collapsed,
disruptions, today's decisions. Tier 3 (behind a click): map details, full outcome table, sampled futures, search
result, ML pre-ranking, narration, equivalent alternatives. The map is fixed at 300 px and collapsible; the at-risk
list shows eight rows and "show all"; nothing in tier 3 is open by default.

### 5.1 Headline, sub-line, KPI row

The headline is a sentence built from the timeline summary, in this order of precedence: forced cancellations and
stranded passengers; else at-risk count ("44 flights are at risk today; none has to cancel yet"); else "The day is
running to plan." In the after view it starts "With plan 1, …". The sub-line names every active disruption in words,
then the decision-time sentence: "12 flights have already departed; 247 remain under consideration from 05:00."
When the clock changes, that sentence updates and briefly highlights (a 600 ms ivory wash, reduced-motion safe) so
the reader learns what moving the clock means: the past is fixed, the engine plans from here.

Six KPIs (at risk, cancel themselves, delayed, missed connections, stranded overnight, standby crews used). Each is a
`Define` term (§8): hover or tap shows the one-sentence meaning. Each is also a filter button: "at risk" filters the
board and the at-risk list to those flights; a second click clears. Amber value when non-zero for at risk and
delayed; coral for cancel themselves and stranded.

### 5.2 Rotations board

The hero and the only bold element on the page.

- One row per tail; rows sorted: aircraft on ground first, then by number of at-risk legs (desc), then tail. A search
  box filters by tail or flight number; a switch shows only rows with something at risk.
- Time axis 00:00–27:00 (late arrivals spill past midnight). Window presets: Day, 12 h, 6 h (centred on the decision
  time). The canvas scrolls horizontally inside the panel when the window is narrower than the day.
- Rows are virtualised above 30 tails (`@tanstack/react-virtual`), row height 30 px (36 px on touch, via
  `(pointer: coarse)`).
- A strip is a leg: fill `strip`, 3 px left edge in the state colour, mono flight number then route. Text by width:
  ≥ 96 px "6E 2134 DEL–BOM"; 56–96 "6E 2134"; 28–56 "2134"; < 28 no text. The popover always has everything.
- States, each with a name that appears in the legend, the popover and the `aria-label`:
  - **on time** — edge `strip-edge`.
  - **delayed** — amber edge, `strip-delay` fill, "+40" at the right end when it fits.
  - **at risk** — as delayed plus a dashed amber outline.
  - **cancels itself** (forced by the day) — coral edge, `strip-cancel` fill, coral hatch, strike-through.
  - **cancelled by plan** — same fill, ivory-3 edge, no hatch, "cancelled" label.
  - **re-fleeted by plan** — drawn on the new tail's row with "was VT-IAD".
  - **committed** (a human decision already on the day) — pin glyph at the left edge.
  - **protected** (in the after view only) — mint edge, a check glyph inside the strip before the flight number,
    and a mint "protected" label. Defined everywhere with the same words: "would have cancelled itself if nobody
    acted, and operates under this plan in the sampled futures; not a guarantee".
  - **already happened** (departed before the decision time) — 55 % opacity.
  The tail cell of a row that contains a cancels-itself leg carries a coral dot, so the state registers in
  peripheral vision without reading the strips.
- Now-line: 1 px amber with a 12 px glow, labelled "05:00 decision time". The canvas left of it is shaded (well,
  4 % ivory wash) and labelled "already happened" at its left edge.
- Weather bands: for each airport disruption a lilac band on the axis header labelled "Fog at Delhi 05:00–09:30 ±";
  strips touching that airport in the window get a lilac underline. Rows are not washed.
- Views: a segmented control "If nobody acts | With plan n | Changes only". The after view is the plan's
  `/timeline/plan`; strips whose status, delay or tail changed get a 1 px ivory outline and a delta label
  ("+40 min", "cancelled by plan", "now on VT-IFM", "protected"). Switching to the after view plays one
  synchronised 240 ms emphasis on all changed strips (outline draws in, fill lifts, settles) — a single moment, not
  a stagger. "Changes only" hides every row and strip the plan does not touch and shows "Showing the 6 flights plan
  1 changes on 3 tails — show all" in the header, where "show all" is a real button, not a link in small type. The
  segmented control is sticky at the top of the panel so the way out is always on screen. If the day changes
  underneath (a disruption is added or removed, a decision is committed, the clock moves), the board returns to
  the full view by itself and says why for a few seconds: "Back to the full day because the day changed." A plan
  card's "Show changes" selects which plan the board shows and switches to that view.
- Hover a strip → a hover card (Radix `HoverCard`, `openDelay` 250 ms so a pointer sweeping across the board does
  not strobe cards, `closeDelay` 180 ms so the pointer can travel to it): flight, route, STD/STA (planned vs
  propagated), tail, booked passengers, connections at risk, the state by name and the reason in words, "Open in
  Flights". Click selects the strip, pins the card and highlights its rotation. On touch, tap opens the same
  content as a bottom sheet.
- Legend in the panel footer. Empty: "No tails match." Loading: rows drawn as ivory-3 outlines, no shimmer.

### 5.3 Network map

India at night. Static GeoJSON (`public/geo/south-asia.json`), Mercator fitted to 67–98 °E, 6–36 °N. The map is
situational awareness; the board is the argument. It never grows beyond its 300 px panel and can be collapsed.

- Land `panel` (India) / `well` (neighbours), hairline coast. Routes as quadratic arcs: ivory 14 % at rest, amber
  60–85 % when a leg on the route is at risk, coral when one is cancelled; width by flights on the route.
- Airports as amber points. Risk is encoded by the point radius (2–6 px, square root of at-risk flights) and an
  amber count label on hubs and on any airport with at-risk flights — **not** by the halo. Every lit airport has the
  same fixed 9 px halo, so blooms cannot merge into a wash however dense the network; disrupted airports get a
  larger lilac halo (18 px) and a label ("fog, 22 at risk"). Aircraft on ground: a coral mark at the tail's current
  airport. Invisible 16 px hit circles sit above every layer, so taps never land on a halo.
- Hover an airport → tooltip (name, flights today, at risk, cancelled). Click → filters the board and the at-risk
  list to that airport (a clearable chip appears in the board header).
- The map follows the board's view. In the after view each airport whose at-risk count changed shows the delta in
  mint ("−13") or coral, routes recolour, and the panel footer lists the network change in words:
  "DEL 22 → 9 at risk, BOM 6 → 2, JAI 4 → 4".
- Clustering is not needed at 32–90 airports; it is the fallback if a network above ~120 airports is ever loaded.

### 5.4 Disruptions

The right column lists active disruptions as chips ("Fog / low visibility, DEL, 05:00–09:30 ±", "Aircraft on
ground, VT-IAD, all day"), each with a definition popover and a remove control (confirm). "Add disruption" opens a
side sheet (full-screen on phones), also reachable at `?sheet=disruptions`:

type (plain names for LVP, AIRPORT_CAPACITY, ATC_FLOW, CLOSURE, AOG, CREW_UNAVAILABLE, FLIGHT_DELAY) → target (airport
select, tail select or flight search, depending on type) → start, end, "end time uncertain" switch (± window) →
severity fields for the type (capacity %, movements per hour, crews, minutes, CAT requirement) → a live preview
sentence ("Fog at Delhi from 05:00 to about 09:30, end uncertain: 45 % of normal capacity") → "Add and
re-propagate".

The API has no dry-run propagation, so the impact is shown immediately *after* adding, inside the same sheet, from
the re-fetched timeline: "Impact: 22 flights affected, 8 newly at risk, 3 more cancel themselves if nobody acts",
with "Undo" (removes the disruption) and "Get a recommendation". A switch "Ask for a plan after changes" triggers a
recommendation automatically. This is honest (the numbers are real) and needs no new endpoint; a preview endpoint is
listed as optional in the contract matrix.

### 5.5 At risk now

A compact list (flight, route, time, reason in words), amber for at risk, coral for forced. Eight rows, then "show
all (44)" which expands in place. Click scrolls the board to the row and selects the strip.

### 5.6 Plans

The section is structured as **baseline → recommended → alternatives**, because the engine's own first act is to
simulate doing nothing.

- **No run at this decision time.** The baseline card is shown alone with the invitation: "44 flights are at risk at
  05:00. Ask the engine for a plan." and the primary button "Get a recommendation" ("Usually 2–5 seconds on the live
  engine"). In demo mode the button reads "Load the precomputed recommendation" and the result is tagged `Demo
  result`.
- **Running.** `RunProgress`: the four things the engine does, in order (propagate the day; build candidate actions;
  search plans; sample uncertain futures), an indeterminate amber bar and an elapsed-time counter. No invented
  percentages.
- **Baseline card, "If nobody acts".** Quiet (ivory-3 frame): the four headline outcomes and the compensation
  estimate. It is the reference column for every comparison and never has a button. Its title is a `Define`, so
  a curious examiner learns the architecture without leaving the page: "Doing nothing is the reference scenario.
  The engine first replays the day without intervention, then compares every candidate plan against that outcome."
- **Recommended card, "Plan 1".** Wider, ivory frame, open by default. Its header carries a status pill that
  separates the engine's proposal from the human decision: `Recommended` when generated, `Accepted 05:00` after
  acceptance, `Overridden: crew preference` after an override. The first three blocks own the card's initial
  viewport; a hairline separates them from the subordinate blocks below, which are set at 13 px in ivory-2. The
  card is designed to fit a 1440×900 viewport with the plans header visible: the chain shows at most six links
  before "Show the full chain". In this order and nothing else:
  1. **Do this** — the actions as one sentence in words: "Cancel 6E 2011 Delhi–Mumbai 05:40 and re-fleet 6E 2087 onto
     VT-IFM; hold 6E 2044 by 40 min." A do-nothing recommendation reads "Wait. Take no action now; re-check at the
     next decision time."
  2. **Impact avoided if we act** — the heading says these are counterfactual deltas, not the plan's own totals;
     underneath, computed as baseline minus plan: "8 cancellations, 586 stranded passengers, 1,300 minutes of
     delay."
  3. **Why** — the causal chain, visible by default, drawn as a vertical sequence: each decided action → the
     consequence in the network ("VT-IFM is at Delhi by 06:10") → the flights protected ("6E 2087 and 6E 2088
     operate; they would have cancelled themselves") → what still fails and why. Protected flights come from the
     baseline's forced set minus the plan's; the engine's explanation sentences supply the reasons.
  — hairline —
  4. **Result** — this plan vs. if nobody acts for the four headline outcomes (cancel themselves, stranded
     overnight, missed connections, delay added) plus the compensation estimate row; better in mint, worse in coral.
     The compensation `Define` reads "Estimate under the configured DGCA policy on synthetic data; not an airline
     financial forecast." The score is a `Define` on the result heading: "Network impact 1,842 against 4,110; the
     engine's weighted total of all outcomes, 1 point ≈ ₹1,000."
  5. **Reliability** — four plain lines, no bars, no percentages that imply statistics: "Feasible in 10 of 10
     sampled futures", "Lowest-impact plan in 7 of 10 sampled futures", "Sensitivity to the fog ending late:
     moderate", "10 futures sampled". Below three samples: "Uncertainty not evaluated (2 samples fitted in the time
     budget)". "Dominated by plan 2 in every future" when applicable.
  6. **Buttons** — "Accept plan 1" (primary), "Show changes" (board → changes-only view for this plan), "Why plan 1
     over plan 2?" (opens a side-by-side: the engine's `why_over_next` differences and the outcome deltas). On
     phones "Accept plan 1" is also the sticky bar above the tab bar, so it is never below the fold.
- **Alternatives, "Plan 2", "Plan 3".** Collapsed to do-this + prevents + a "Show changes" ghost button; open on
  click to the same structure as Plan 1 with an outline "Accept plan n".
- **Expanded details** (any plan, behind "How this plan was found"), four labelled blocks so the kinds of reasoning
  never blur:
  - *Operational reason* — the chain above in full, including equivalent alternatives ("same outcome with …") and
    "still cancels itself under this plan".
  - *Search result* — the full outcome table (every metric row with definitions), the sampled-futures strip (one dot
    per future per finalist, mean tick, "bad case"), plans evaluated, budget used.
  - *ML pre-ranking* — for the recommended plan when the surrogate is active, the engine's `score_drivers` (SHAP
    contributions) as plain sentences with the feature names translated ("higher priority because: 28 min to
    departure; three more legs on this tail; few spare tails at Delhi"), under the fixed caption "The model only
    orders candidates for simulation; the plan was chosen by simulation and the hard rules."
  - *Narration* — the narration paragraph when present, captioned "Written by the narration model from the plan's
    computed facts." No "AI" badge anywhere.
- **Accept** → dialog: "This commits to the day: cancel 6E 2011; re-fleet 6E 2087 onto VT-IFM. The day replays from
  05:40 with these fixed; later recommendations build on them." → "Accept". Then the plans section is replaced by
  the **What changed** panel: "Decision committed at 05:00: plan 1. Changed: 2 flights cancelled, 1 aircraft
  re-fleeted. Protected: 3 cancellations avoided, 586 passengers no longer stranded." with "Continue to the next
  decision (06:00)" (moves the clock to the next at-risk departure after now, on a 15-minute boundary; +60 min if
  none) and "Stay at 05:00". The board gains pins; the committed chips update; the decisions list gains a line.
  Override → reason select + optional note → "Override recorded" and the same panel with "Recorded: override, no
  change to the day". The panel is derived from server state, not from a toast: whenever the latest run at this
  day and decision time carries a decision, the panel is what the plans section shows, so it survives navigating
  to Flights and back, a reload, and another browser. "Stay at 05:00" collapses it to a one-line anchor ("Decision
  committed at 05:00: plan 1 — details") remembered per run id in `sessionStorage`; "Continue" moves the clock and
  the next decision time starts clean.
- **Header meta**: `Live engine` or `Demo result`, futures sampled, elapsed, short config hash and instance hash
  (both `Define`), "Run again" (ghost), "Deterministic replay" badge when `effective.deterministic` is true.

### 5.7 Today's decisions and committed state

In the right column under the plans: a compact list of this day's runs and decisions (time, "plan 1 accepted" /
"override: crew preference" / "no decision"), with the active disruptions listed by start time, so the day reads as
a trail. "Committed today (2)" chips with the labels, and "Reset the day" (confirm) which calls the reset endpoint.

## 6. Visualisations summary

| what | where | form |
|---|---|---|
| Propagation through the day | board | strips, now-line, past shading, state colours, before/after, changes only |
| The network picture | map | night map, point size ∝ risk, arcs, fixed halos, after-view deltas |
| Why a plan | recommended card | causal chain (decide → consequence → protected → still fails) |
| Why not the next plan | recommended card | side-by-side differences from `why_over_next` |
| Uncertainty | expanded plan | dot strip of sampled futures per finalist, mean tick, "bad case" |
| Search effort | RunProgress, expanded plan, How it works | stages with real counts (candidates, plans evaluated, futures) |
| Model's role | expanded plan | SHAP drivers as sentences, under the "only orders candidates" caption |
| Evidence | Cases & benchmarks | KPI row, ladder table, policy bars (Recharts) |

## 7. Secondary pages

- **Flights & resources.** Tabs: Flights, Aircraft, Crews, Airports, Itineraries. Sticky-header table (desktop) or
  card list (phone) with search and filters (status, airport, tail). Column headers are `Define` terms. Row → drawer
  with the entity in full, "Show on the board", and inline editing of editable attributes (existing `patchRow`,
  `addColumn`); when the API needs a write key the controls are disabled with "Editing needs the write key".
- **Data.** Days as a table (cards on phone): name, size, seed, flights, disruptions, created, `Synthetic` pill.
  Actions: open, delete (confirm). Generate form: size, seed, disruption presets, "Generate day" → opens it. Import:
  a file picker for a day in the generator's JSON format → `POST /data/import` (new `api.importInstance`; the
  endpoint exists, the old UI never exposed it); validation issues from the API are listed under the picker.
- **Runs.** Table: when, day, decision time, plans, status (recommended / accepted / overridden), budget actually
  used from `effective` ("10 futures, depth 3, deterministic"), latency, config hash, instance hash, live/demo. Row → run detail: the same plan cards read-only plus the
  four expanded blocks and audit fields, "Open this day at this time".
- **Parameters.** Two groups, kept visibly apart. *Operational policy* (what a duty manager might legitimately
  change): decision horizon, deterministic replay, preset load/save/reset. *Engine configuration* (marked
  "experimental; changes what the benchmark means"): objective terms with weights and plain descriptions, each
  carrying "placeholder weight" where the README says so; hard rules H1–H10 with plain names and the regulation
  behind each; search budget K, D, M, N, S with what each does and "higher values increase compute time". Config
  hash always visible; "Restore defaults" always visible; blocked writes show the write-key hint.
- **Cases & benchmarks.** KPI row (cases passed, improvement vs doing nothing and vs B0, win rate, median latency),
  cases list (expected vs got, checks), benchmark ladder table and policy bars, "Run cases", staleness notice when
  the benchmark's hash differs from the current config, and the limitations block from the README.
- **How it works.** Live. Seven numbered steps (a real sequence) fed by the current day and last run: today's day →
  what fails if nobody acts → candidate actions → search → sampled futures → ranking → your decision. Each step
  shows the actual numbers, a short explanation, and "what this is not" where a misconception is likely (no model is
  trained to decide; the surrogate only orders candidates; the past is the forecast under committed decisions, not a
  live feed). The glossary (§8) renders in full at the end.

## 8. Clarity layer

- `lib/glossary.ts`: one map from term key → `{ label, short, long?, unit? }` for every summary field, metric key
  (`/config/metrics`), state name, reliability label, constraint id, search parameter and SHAP feature name. A test
  asserts every metric key returned by the static `metrics.json` has an entry.
- `<Define term="stranded_overnight">704</Define>`: renders the child with a dotted ivory-3 underline; hover opens a
  tooltip (desktop), tap opens a popover (touch). Used by KPI row, plan tables, parameters, cases, how-it-works.
- Every page has a one-line purpose under its title, in the same voice.

## 9. Responsive and mobile layout

Tailwind breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536. Components are written responsive in
Phase 1, and the basic phone chrome (bottom tab bar, `?view=`) ships in Phase 1 too; Phase 3 is the audit and
refinement pass.

| range | shell | operations | tables |
|---|---|---|---|
| ≥ 1280 | full top bar | as §5; right column 400/420 | full |
| 1024–1279 | full top bar | right column 340; plan cards compact | full |
| 768–1023 | tabs → Operations, Flights, Runs, More | one column: headline, KPIs 3×2, board (12 h window), disruptions, at risk, plans stacked, map (360 px) | sticky header, scroll within the panel |
| < 768 | top bar = wordmark, day (short), decision time; bottom tab bar Today / Board / Map / Plans / More | `?view=` switches the section shown; default Today | card lists with a "table" toggle |

Phone details:

```
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ ▣  Medium day ▾ 05:00│   │ ▣  Medium day ▾ 05:00│   │ ▣  Medium day ▾ 05:00│
│ If nobody acts, 11   │   │ Rotations            │   │ Plans at 05:00       │
│ flights cancel them- │   │ [nobody|plan 1|changes]│  │ ┌ If nobody acts ──┐ │
│ selves today and 704 │   │ VT-IAD│▌2011▌ ▌2012▌  │   │ │ 11 cancel  704 … │ │
│ passengers are …     │   │ VT-IFM│ ▌2134 DEL–BOM▌│   │ ┌ Recommended ────┐ │
│ 12 departed; 247 …   │   │ VT-IGX│▌2044▌  ▌2045▌ │   │ │ Cancel 6E 2011 … │ │
│ 44 at risk  11 cancel│   │       │  ┃05:00        │   │ │ Prevents 8 …     │ │
│ 34 delayed  274 miss.│   │ ← 6 h window, h-scroll│   │ │ Why: …           │ │
│ 704 strand. 3 crews  │   │ sticky tail column    │   │ │ result · reliab. │ │
│ Disruptions  [+]     │   │ tap strip → sheet     │   │ └──────────────────┘ │
│ [Fog DEL] [AOG IAD]  │   │                       │   │ ┌ Plan 2 (collapsed)│ │
│ At risk now (44) …   │   │                       │   │ ┌ Plan 3 (collapsed)│ │
│ [Get a recommendation]│   │                       │   │ [Accept plan 1]      │
├──────────────────────┤   ├──────────────────────┤   ├──────────────────────┤
│ Today Board Map Plans More│ Today Board Map Plans More│ Today Board Map Plans More│
└──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

- Today answers "what is wrong, what should I do"; Board is aircraft consequences; Map is network consequences;
  Plans is the alternatives. Today is the default view.
- Touch targets ≥ 44 px; segmented controls full width; the primary action is a sticky bar above the tab bar on
  Today and Plans.
- Board: tail column sticky (72 px), 6 h window by default, row 36 px, strip tap → bottom sheet with the flight.
- Map: full width, 300 px tall, tap airports; no pinch-zoom.
- Definitions open as popovers on tap. Sheets (disruptions, flight detail, accept, why-over-next) are full-screen
  with a close button in the top bar.
- Safe-area insets respected (`env(safe-area-inset-*)`) for the tab bar and sticky bars.
- Phase 5 adds swipe between Today / Board / Map / Plans and the installable PWA.

## 10. Technical structure and data flow

### 10.1 Structure

```
apps/occ/src
  app/
    layout.tsx                 fonts, theme, providers
    (console)/layout.tsx       TopBar, banner, MobileTabBar, page frame
    (console)/page.tsx         Operations
    (console)/{flights,runs,parameters,cases,data,how-it-works}/page.tsx
  components/
    ui/        button, panel, pill, define, popover, hover-card, tooltip, sheet, dialog, select, slider, switch, segmented, tabs, table, toast, skeleton
    shell/     TopBar, DaySwitcher, ClockControl, EngineStatus, EngineBanner, ModeTag, MobileTabBar, PageTitle
    board/     Board, BoardHeader, Axis, Row, Strip, NowLine, PastShade, WeatherBand, StripCard, Legend, useBoardScale, useBoardData, useBoardDiff
    map/       NetworkMap, mapLayers, mapTheme, AirportTooltip, usePulseClock
    plans/     PlansSection, BaselineCard, PlanCard, ActionSentence, Prevents, CausalChain, ResultTable, Reliability, WhyOverNext, Expanded (SearchResult, MlPreRanking, Narration), RunProgress, DecisionBar, AcceptDialog, OverrideDialog, WhatChanged
    disruptions/ DisruptionsPanel, DisruptionChip, DisruptionSheet, DisruptionForm, ImpactAfterAdd, describeDisruption
    ops/       Headline, DecisionTimeLine, KpiRow, AtRiskList, DecisionsList, CommittedChips
    charts/    PolicyBars, BarList, Delta, FuturesStrip
    data/      DaysTable, GenerateForm, ImportForm
    flights/   EntityTable, EntityCards, EntityDrawer, Filters
  hooks/       useDay, useClock (URL-synced), useTimeline, usePlanTimeline, useRun, useRuns, useEngine, useIsTouch
  lib/         api.ts (thin, typed by generated schema), api.types.ts (generated), query.ts, glossary.ts, format.ts, diff.ts (baseline vs plan), url.ts, utils.ts
  styles/      globals.css (tokens → Tailwind theme)
public/        geo/south-asia.json, static-runs/ (synced), icons/ (Phase 5), manifest.webmanifest (Phase 5), sw.js (Phase 5)
```

### 10.2 Data

- TanStack Query v5 wraps `api.ts`. Query keys: `health`, `instances`, `timeline(day,t)`,
  `planTimeline(day,t,actionsHash)`, `run(id)`, `runs(day)`, `config`, `table(day,entity)`, `cases`, `benchmark`.
  Mutations: recommend, decide, add/remove disruption, generate, import, delete day, reset committed, config puts;
  each invalidates the keys it touches. `staleTime` 30 s for timelines, 5 min for config and tables.
- **Static fallback** stays inside `request()`: when the engine is unreachable the client serves `public/static-runs`
  for the demo day and flips `staticMode`; every response is tagged with its origin (`live` | `demo`) so the UI can
  show `Live engine` / `Demo result`; writes fail with a clear message. The health query polls every 15 s while
  unavailable or starting, 60 s when online.
- **URL state.** `useDay`/`useClock` read `?day`/`?t` with `localStorage` defaults and write with `router.replace`.
  `useSearchParams` consumers sit under a Suspense boundary (Next 16 requirement).
- **Diffing.** `lib/diff.ts` compares the baseline timeline with a plan timeline by flight id → changed strips,
  protected flights, per-airport deltas, "n flights change on m tails". One function feeds the board, the map, the
  Prevents line and the What-changed panel.
- **Server vs client.** Pages are server components that render the frame; data-bound components are client
  components. No server-side fetching of engine data (the engine may be unavailable).
- **Board performance.** Scale and layout computed once per timeline in `useBoardData` (memoised); strips are plain
  `div`s, virtualised by row; the after view diffs by flight id.

### 10.3 Types and the contract

- `api.types.ts` is **generated** from the API's OpenAPI document (`openapi-typescript` against
  `http://localhost:8000/openapi.json`, script `npm run api:types`, output committed). `api.ts` only names endpoints
  and wraps `request()`; the shapes come from the generator. When the API changes, `tsc` fails in the UI — contract
  drift becomes a compile error, not a runtime surprise.
- `docs/superpowers/specs/occ-api-contract.md` (Phase 0 deliverable): every UI feature → endpoint → status
  (`existing` / `existing, response incomplete` / `needs an endpoint`) → which phase consumes it. Optional
  additions the UI can live without are listed separately (disruption preview propagation; a `created_at` on
  disruptions for the decisions trail).
- **Demo/live parity** (`scripts/check_static_parity.py`, Phase 0): the competition demo depends on the static
  bundle being trustworthy, so the check replays what the bundle claims. For the demo day and each bundled decision
  time (`run_300.json`, `run_360.json`) it calls the live engine with `search.deterministic` on and the bundle's
  seed, and compares: the baseline timeline (flight statuses, delays, forced set — must be identical), the
  candidate set and the plans' actions and ranking (must be identical), the explanation reasons and forced lists
  (must be identical), and the metrics and scores (identical when the live run used the same number of futures;
  reported as a warning with the sample counts when a latency budget cut samples). The script also verifies the
  bundle's `config.json` hash and `instance.json` hash match the live `/config` and instance. It runs whenever the
  bundle is regenerated and before each phase review. In the UI, the demo pill's popover shows the bundle's config
  hash and build date, and shows "Precomputed with an older configuration" when a reachable engine reports a
  different hash.

### 10.4 API additions this spec depends on

Two changes exist only in the working tree and must be committed before Phase 0: `POST /timeline/plan` in
`apps/api/aeronexus_api/routers/engine.py` (with `build_timeline(..., actions)`), and `ScenarioStats.values` in
`packages/core/aeronexus_core/model.py` + `search/recommend.py`. Phase 0 adds one more contract-only change:
Pydantic response models (`apps/api/aeronexus_api/schemas.py`) on the endpoints that today return untyped `dict`
(`/health`, `/timeline`, `/timeline/plan`, `/runs`, `/data/instances`, the committed endpoints, `/config/metrics`,
`/config/presets`), so the generated types cover what the console consumes; payloads do not change. The demo bundle
is precomputed in audit mode (`search.deterministic`) so the parity check is exact. Everything else the console
needs is already served: SHAP drivers arrive as `plan.explanation.score_drivers` on the recommended plan when the surrogate is
loaded; `why_over_next`, `equivalent_alternatives`, `forced_cancellations`, `committed`, `effective`,
`instance_hash` and narration are all present in the `Run` payload.

### 10.5 Dependencies and deletions

- New: `@tanstack/react-query`, `@tanstack/react-virtual`, `@radix-ui/react-hover-card`, `sonner`; dev:
  `openapi-typescript`, `vitest`, `@testing-library/react`, `@playwright/test`. Phase 5: `@use-gesture/react`.
  Service worker hand-written (no PWA plugin).
- Replaced: `components/ops/RotationsBoard.tsx`, `NetworkMap.tsx`, `PlanCard.tsx`, `DisruptionStrip.tsx`,
  `shell/AppShell.tsx`, `DESIGN.md`; `charts.tsx` splits into `charts/`.

## 11. Loading, empty, error and offline states

| situation | what the screen says |
|---|---|
| no day loaded | "No operational day is open. Open the demo day, generate one, or import your own." with the three actions |
| timeline loading | headline placeholder line, KPI dashes, board rows as outlines |
| engine unavailable | pill + banner (§4); demo day loads; results tagged `Demo result`; write actions disabled with "Unavailable while the engine is asleep; wake it to change the day" |
| engine starting | "Starting the engine, usually under a minute…" with elapsed time |
| engine error | "The engine returned an error: <message>. Try again, or open Runs to see earlier results." |
| recommendation timed out | "The search ran out of time on this machine. Showing the best plans it found; try a smaller budget in Parameters." |
| write key required | control disabled + "Editing needs the write key (set NEXT_PUBLIC_API_KEY)" |
| uncertainty not evaluated | reliability line explains; nothing else changes |
| no disruptions | "No disruptions on this day. Add one to see the engine work." |
| nothing at risk | headline "The day is running to plan."; invitation becomes "Nothing to decide at 05:00. Move the decision time or add a disruption." |
| network map file missing | map panel shows "Map data did not load" and the airport list instead |

## 12. Accessibility and quality floor

Keyboard: every control reachable, visible amber focus ring, `Escape` closes sheets and popovers, the board rows and
strips are focusable with arrow-key movement (Phase 4). Roles and names on all custom controls (segmented control =
radiogroup, board = grid with row/gridcell, strips carry the state name). Contrast AA. `prefers-reduced-motion`
disables all transitions and the halo pulse. Lighthouse accessibility ≥ 95 on every page at 390 and 1440. No
page-level horizontal scroll at any width; the board and wide tables scroll within their own panel.

## 13. Testing

- **Unit (Vitest + Testing Library).** `format` (lakh/crore, hhmm past midnight), `useBoardScale` (window presets,
  px↔minutes), strip label rule by width, `diff.ts` (changed / protected / per-airport deltas on fixture timelines),
  glossary completeness against `metrics.json`, `describeDisruption`, headline and decision-time sentence builders,
  API static fallback, origin tagging and error mapping.
- **Contract.** `npm run api:types` in CI against a booted local engine; a diff in the generated file fails the
  job until committed.
- **End-to-end (Playwright).** Projects: `desktop` (1440×900) and `phone` (390×844). Static suite (engine offline,
  deterministic): open the demo day, headline and KPIs present, baseline and recommended cards render, before/after
  and changes-only change the strips, definitions open, navigation across all pages, no console errors, `Demo
  result` tags present. Engine suite (skipped when `ENGINE_URL` unset): add a disruption and see the impact, get a
  recommendation tagged `Live engine`, accept plan 1, see the What-changed panel, pins and committed chips, reset.
- **Visual review.** Screenshots at 390 / 768 / 1024 / 1440 per task, reviewed by eye; not pixel-diffed.
- **Gates per task and per phase.** `tsc --noEmit`, `eslint`, unit tests, then the slice opened on
  `localhost:3000` against the local engine on `:8000` and once with the engine stopped (demo mode), console clean,
  screenshots taken. Phase ends add `next build` and the static e2e suite.

## 14. Phased plan

Each phase ends with a build, the tests above, screenshots at the four widths, and a short review before the next.

### Phase 0 — Foundation and contract
Commit the two working-tree API additions (§10.4). Contract matrix, generated types and the demo/live parity
check (§10.3). Tokens and fonts in
`globals.css` / `layout.tsx`; Tailwind theme mapping; the `ui/` kit; TopBar with day switcher, clock control
("Decision time"), engine status, mode pill and banner; MobileTabBar; route skeletons for all seven pages;
QueryClient, URL-synced `useDay`/`useClock` under Suspense; static fallback with origin tagging and wake wired into
the health query; `glossary.ts` v1 covering summary fields, metric keys and state names with its test; test
harness (Vitest, Playwright projects) and the per-task verification script; `DESIGN.md` rewritten to §3.
Exit: all routes render in the new shell; online / starting / unavailable / demo states visible with the right
wording; generated types compile; the parity check passes against the local engine; build clean.

### Phase 1 — The operations screen
Headline, decision-time sentence and KPI filters; Board v2 (§5.2 complete: states by name, past shading, three
views, changes-only, hover card, virtualised, responsive at md/sm, 36 px touch rows); NetworkMap v2 (§5.3);
DisruptionsPanel, sheet, form and impact-after-add (§5.4); AtRiskList; PlansSection with baseline card, recommended
card in the fixed order, alternatives, expanded blocks, why-over-next, RunProgress, accept dialog, What-changed
panel, override (§5.6); today's decisions and committed chips (§5.7); `diff.ts`; the basic phone chrome (tab bar,
`?view=`, default Today).
Exit: the demo scenario plays end to end on desktop (fog + AOG → recommendation → changes only → why over next →
accept → what changed → continue); usable at 390 px with the tab bar; static e2e passes; engine suite passes locally.

### Phase 2 — Secondary pages
Flights & resources, Data (with import), Runs, Parameters (policy vs configuration), Cases & benchmarks, How it works
(§7), each with `Define` on every number and the states in §11.
Exit: parity with `apps/web` plus the clarity layer; glossary test green; build clean.

### Phase 3 — Responsive and mobile pass
Phone board refinement (sticky tail column, 6 h window, strip bottom sheet); card lists for tables with the table
toggle; full-screen sheets; tap definitions; sticky primary action; tablet layout; keyboard and screen-reader audit;
contrast audit; Lighthouse.
Exit: every page usable at 390 / 768 / 1024 / 1440; accessibility ≥ 95; no page-level horizontal scroll; phone e2e
green.

### Phase 4 — Polish
Motion that answers actions: the synchronised after-view emphasis, sheet slide (240 ms), chain reveal, KPI count-up
(300 ms), the single-clock halo pulse, all under reduced-motion guards; draggable now-line; connection highlighting
on strip select; light theme derived from the tokens; copy pass over every empty and error state; micro-typography
(tabular alignment, unit spacing); performance pass on a 46-tail day; keyboard shortcuts last (`B` view, `R`
recommend, `[` `]` move the decision time 15 min, `/` search).
Exit: reviewed screenshots and a recorded walkthrough; no dropped frames on the board; reduced motion honoured.

### Phase 5 — PWA and cutover (after the core is excellent; optional before the competition)
`manifest.webmanifest` and icons; hand-written service worker caching the app shell, `static-runs` and the map so the
demo day works offline; install hint on phones; swipe between Today / Board / Map / Plans; safe-area polish; Vercel
project root switched to `apps/occ` with `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_API_KEY`; README and `docs/deploy.md`
updated; `apps/web` kept deployed until the switch and removed one release later (user's call).
Exit: installable on Android and iOS; offline opens the demo day; the live URL serves the new console.

## 15. Managing the migration risk

This is a second client on the same API, not a migration of the engine. The risks and their controls:

| risk | control |
|---|---|
| UI types drift from the Pydantic models | generated `api.types.ts` (§10.3); `tsc` fails on drift; CI regenerates and diffs |
| A feature assumes an endpoint that does not exist or is uncommitted | contract matrix in Phase 0; §10.4 committed first |
| Next-specific pitfalls (client/server boundary, `useSearchParams` Suspense, hydration, Turbopack + Tailwind v4) | every task ends by opening the slice on `localhost:3000` against the local engine in the browser pane, console clean, screenshots at 1440 and 390; the scaffold already builds and runs on this stack |
| Demo mode diverges from live mode | every task is also checked with the engine stopped; origin tags make the mode visible in the UI and in e2e assertions |
| The live demo breaks during the rebuild | `apps/web` stays deployed and untouched until Phase 5; `apps/occ` deploys to a separate Vercel preview until parity |
| Parity gaps | the contract matrix doubles as the parity checklist against the eight `apps/web` pages |
| Regressions between tasks | unit + static e2e on every push touching `apps/occ`; the engine suite locally before each phase review |
| Rollback | the user commits at the end of each task group; a phase can be reverted as a unit |

## 16. Deferred and out of scope

Guided tour; live flight feeds; authentication and multi-user; internationalisation; pinch-zoom on the map; map
clustering (only if a network above ~120 airports is loaded); a dry-run disruption preview endpoint; editing the
engine's code from the UI.

## 17. Implementation rules

These hold through every phase and every task; a task that breaks one is not done.

1. Operations is the centre of gravity. Nothing from Cases & benchmarks or Parameters appears on it.
2. The reasoning order is fixed: if nobody acts → recommended → alternatives.
3. The causal chain is visible by default on the recommended plan. It is never collapsed to save space.
4. Outcomes are primary; rupees secondary; the network impact score lives in a `Define`.
5. Live and demo are unmistakable: pill, banner and per-result tags, always.
6. Hard rules, simulation, search, ML pre-ranking and narration stay visually separate concepts with their own
   labels; nothing is captioned "AI".
7. The board is the operational argument; the map is situational awareness and never grows past its panel.
8. Accepting a plan visibly moves the interface into What changed, and that state comes from the server.
9. Generated API types and the contract matrix exist before any large UI work; a type error is a stop.
10. Every task is verified live on `localhost:3000` against the local engine and once with the engine stopped,
    with screenshots at 1440 and 390, before it is called done.
11. Competition-critical time is not spent on PWA, gestures, light theme or keyboard shortcuts.
