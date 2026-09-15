/** One plain-language definition for every number, state and term the console shows (spec §8).
 *  `label` is how the term is named in the interface; `short` is the one-sentence meaning shown on hover or tap;
 *  `long` adds a second sentence where a misconception is likely. */

export type Term = { label: string; short: string; long?: string; unit?: "count" | "min" | "inr" | "hours" | "score" };

export const GLOSSARY = {
  // ---------------------------------------------------------------- the day (timeline summary)
  flights: { label: "flights", short: "Every flight scheduled on this day.", unit: "count" },
  at_risk: { label: "at risk", short: "Flights the propagation flags: they cannot operate as planned, are delayed beyond the threshold, or need a standby crew.", unit: "count" },
  forced_cancellations: { label: "cancel themselves", short: "Flights that fail during the day if nobody acts: no aircraft, no legal crew, or no slot when their time comes.", long: "These are not decisions; they are what the day does on its own.", unit: "count" },
  delayed_flights: { label: "delayed", short: "Flights that operate later than scheduled once delays propagate through aircraft and crews.", unit: "count" },
  total_delay_min: { label: "total delay", short: "All departure delay on the day, added up across flights.", unit: "min" },
  misconnects: { label: "missed connections", short: "Passengers who miss an onward flight because their first flight is late or cancelled.", unit: "count" },
  stranded_overnight: { label: "stranded overnight", short: "Passengers who cannot be re-accommodated on the same day.", unit: "count" },
  standby_used: { label: "standby crews used", short: "Standby crews called out to keep flights operating.", unit: "count" },
  aircraft_available: { label: "aircraft available", short: "Aircraft that are serviceable at the start of the day.", unit: "count" },
  standby_crews: { label: "standby crews", short: "Crews on standby at the start of the day.", unit: "count" },

  // ---------------------------------------------------------------- plan outcomes (metric keys from /config/metrics)
  forced_downstream_cancellations: { label: "flights that cancel themselves", short: "Flights that still fail later in the day under this plan.", unit: "count" },
  propagated_delay_min: { label: "delay added to the day", short: "Departure delay this plan leaves in the network, added up across flights.", unit: "min" },
  next_wave_shortfall: { label: "next-wave shortfall", short: "Aircraft that are not where the next bank of departures needs them.", unit: "count" },
  pax_cancelled: { label: "passengers on cancelled flights", short: "Passengers booked on flights this plan cancels or that cancel themselves.", unit: "count" },
  pax_reprotect_delay_hours: { label: "re-accommodation delay", short: "Hours passengers wait for the flight they are moved to, added up.", unit: "hours" },
  pax_stranded_overnight: { label: "stranded overnight", short: "Passengers who cannot be re-accommodated on the same day.", unit: "count" },
  special_assistance_affected: { label: "special-assistance passengers affected", short: "Passengers needing assistance who are on a cancelled or badly delayed flight.", unit: "count" },
  high_value_affected: { label: "high-value passengers affected", short: "Top-tier and full-fare passengers on a cancelled or badly delayed flight.", unit: "count" },
  partner_pax_affected: { label: "partner passengers affected", short: "Passengers ticketed by a partner airline on a cancelled or badly delayed flight.", unit: "count" },
  pax_reprotected_within_4h: { label: "re-accommodated within 4 hours", short: "Passengers moved to another flight that departs within four hours.", unit: "count" },
  pax_reprotected_same_day: { label: "re-accommodated the same day", short: "Passengers moved to another flight that departs the same day.", unit: "count" },
  compensation_inr: { label: "compensation payable", short: "Estimate of DGCA compensation and care under the configured policy, on synthetic data; not an airline financial forecast.", unit: "inr" },
  compensation_exempt_inr: { label: "compensation waived", short: "Compensation the DGCA rules exempt because the cause is weather, ATC or an airport closure.", unit: "inr" },
  crew_standby_used: { label: "standby crews called", short: "Standby crews this plan uses to keep flights operating.", unit: "count" },
  crew_out_of_position: { label: "crews out of position", short: "Crews who end the day somewhere other than where their next duty starts.", unit: "count" },
  swaps: { label: "re-fleets", short: "Flights moved to a different aircraft by this plan.", unit: "count" },
  cancellations: { label: "cancellations decided", short: "Flights this plan cancels on purpose.", unit: "count" },
  delays: { label: "holds decided", short: "Flights this plan holds on purpose.", unit: "count" },
  buffer_consumed_min: { label: "turnaround buffer used", short: "Minutes of slack between flights this plan uses up.", unit: "min" },
  tail_risk_penalty: { label: "bad-case penalty", short: "Extra weight on how badly the worst sampled futures turn out.", unit: "score" },

  // ---------------------------------------------------------------- strip states (board legend, popovers, aria)
  state_on_time: { label: "on time", short: "Operates as scheduled." },
  state_delayed: { label: "delayed", short: "Operates later than scheduled because a delay reached it through its aircraft or crew." },
  state_at_risk: { label: "at risk", short: "The propagation flags it: it may not operate as planned, or needs a standby crew." },
  state_cancels_itself: { label: "cancels itself", short: "Fails on its own during the day if nobody acts: no aircraft, no legal crew, or no slot when its time comes." },
  state_cancelled_by_plan: { label: "cancelled by plan", short: "Cancelled on purpose by the plan being shown, so its passengers can be re-accommodated early." },
  state_re_fleeted: { label: "re-fleeted", short: "Moved to a different aircraft by the plan being shown." },
  state_committed: { label: "committed", short: "A decision a person has already accepted today; the day replays with it fixed." },
  state_protected: { label: "protected", short: "Would have cancelled itself if nobody acted, and operates under this plan in the sampled futures; not a guarantee." },
  state_already_happened: { label: "already happened", short: "Departed before the decision time. The engine cannot change it." },

  // ---------------------------------------------------------------- reliability
  feasibility: { label: "feasible", short: "In how many of the sampled futures the plan can be carried out without breaking a hard rule." },
  stability: { label: "lowest-impact plan", short: "In how many of the sampled futures this plan has the lowest network impact of the finalists; a comparison within the sampled set, not a probability." },
  sensitivity: { label: "sensitivity", short: "How much worse the bad case is than the average across the sampled futures." },
  samples: { label: "futures sampled", short: "How many futures the engine drew for the uncertain parts of the day, such as when the fog lifts." },
  uncertainty_not_evaluated: { label: "uncertainty not evaluated", short: "Fewer than three sampled futures fitted in the time budget, so stability and sensitivity are not reported." },
  dominated: { label: "dominated", short: "A near-identical plan is at least as good in every sampled future." },

  // ---------------------------------------------------------------- engine terms
  network_impact: { label: "network impact", short: "The engine's weighted total of every outcome: cancellations, delay, stranded passengers, compensation and more. Lower is better; 1 point is about ₹1,000.", long: "It ranks plans; it is not money the airline pays.", unit: "score" },
  bad_case: { label: "bad case", short: "The network impact in the worst tenth of the sampled futures.", unit: "score" },
  decision_time: { label: "decision time", short: "Everything before this time has already happened; the engine decides from here.", long: "Flights before it are treated as realised under the decisions already committed; nothing is a live feed." },
  if_nobody_acts: { label: "if nobody acts", short: "Doing nothing is the reference scenario. The engine first replays the day without intervention, then compares every candidate plan against that outcome." },
  impact_avoided: { label: "impact avoided if we act", short: "What this plan prevents compared with doing nothing: the difference between the two outcomes, not the plan's own totals." },
  config_hash: { label: "configuration", short: "A fingerprint of the engine's weights, rules and search budget. Same fingerprint, same engine." },
  instance_hash: { label: "day fingerprint", short: "A fingerprint of the day's data as the engine saw it. Editing the day changes it." },
  deterministic: { label: "deterministic replay", short: "Audit mode: the engine never trades sampled futures or search depth for speed, so the same inputs always give the same answer." },
  demo_result: { label: "demo result", short: "Computed earlier and stored, because the engine is unavailable right now. Identical to what the engine would say for this day." },
  live_engine: { label: "live engine", short: "Computed just now by the engine." },
  horizon: { label: "decision horizon", short: "How far ahead of the decision time the engine considers actions; later flights are left for later decisions." },
} as const satisfies Record<string, Term>;

export type TermKey = keyof typeof GLOSSARY;

export const term = (key: TermKey): Term => GLOSSARY[key];

/** The metric keys the API reports for a plan (the /config/metrics list) all have a glossary entry; this is the
 *  lookup the plan tables use, with a safe fallback for a key the engine adds before the glossary catches up. */
export function metricTerm(key: string): Term {
  return (GLOSSARY as Record<string, Term>)[key] ?? { label: key.replace(/_/g, " "), short: "No definition yet for this outcome." };
}
