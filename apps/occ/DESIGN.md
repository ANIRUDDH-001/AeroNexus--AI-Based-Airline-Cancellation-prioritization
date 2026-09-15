# AeroNexus console — design notes ("Sodium night")

The full spec is `docs/superpowers/specs/2026-09-13-occ-console-design.md`. This file is the short version an
engineer needs while touching the UI.

## The idea

A dark room; what matters is lit. Warm graphite surfaces (anodised aluminium, not navy, not black), ivory text
(low glare), and one warm colour — sodium amber, the colour Indian cities glow from orbit — reserved for what is
"lit up": the decision-time line, at-risk flights, airports on the map. Failures are coral, clear is mint, weather
is a cool lilac wash. Depth comes from wells (cut in) and panels (raised), never from shadows or gradients; the only
soft light in the interface is the halo on the night map.

## Tokens (`src/styles/globals.css`)

| token | value | use |
|---|---|---|
| `graphite` | `#141518` | page ground |
| `well` | `#0D0E10` | inset areas: board canvas, map, inputs |
| `panel` / `panel-2` | `#1B1C20` / `#25262B` | raised surfaces / hover rows, selected nav |
| `hairline` / `hairline-strong` | white 7 % / 13 % | borders / control borders |
| `ivory` / `ivory-2` / `ivory-3` | `#EFEAE0` / `#A8A399` / `#6C6862` | text / secondary / muted |
| `amber` | `#F0B345` | attention: now-line, at risk, delayed, airport lights, focus ring |
| `coral` | `#FF5F52` | cancels itself, forced, infeasible, destructive |
| `mint` | `#58D08F` | on time, feasible, accepted, protected, engine online |
| `lilac` | `#B39BF5` | weather and other disruptions |
| `strip*` | see file | a flight strip at rest / delayed / cancelled |

Rules: the four state colours mean flight or engine state and nothing else; the primary action is ivory on
graphite; there is no blue. State never travels by colour alone (hatch, dashed outline, "+40", check, pin, "was
VT-IAD"), and every state is named in the legend, the popover and the aria-label.

## Type

Archivo (variable; `wdth` 90 for the headline sentence via `.headline`, 100 elsewhere) and IBM Plex Mono for flight
numbers, tails, times and hashes only (`.mono`). Numbers use tabular figures (`.num`). Sentence case everywhere; no
uppercase eyebrows, no middle-dot meta strings, no arrows on buttons.

## Shape and motion

Panels 8 px, controls 6 px, strips 3 px, pills round. 4 px grid. Motion only answers an action (the after-view
emphasis, the working bar); the one ambient motion is the halo pulse on disruptions no recommendation has considered
yet, driven by one phase for the whole map and off under reduced motion.

## Voice

Plain verbs, sentence case, the user's vocabulary: "cancels itself", "re-fleet", "hold", "if nobody acts". Buttons
say what happens. Errors say what happened and what to do. Every number has a definition (`src/lib/glossary.ts`,
rendered by `<Define>`).

## Implementation rules (spec §17)

Operations is the centre of gravity; the reasoning order is if nobody acts → recommended → alternatives; the causal
chain stays visible; outcomes are primary, rupees secondary, the score in a definition; live and demo are always
unmistakable; hard rules, simulation, search, ML pre-ranking and narration stay separate concepts; the board is the
argument and the map is situational awareness; accepting a plan moves the screen into What changed.
