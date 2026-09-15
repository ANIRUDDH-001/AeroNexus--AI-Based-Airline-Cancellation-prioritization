"use client";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, needsWriteKey, type ConfigEnvelope, type ConstraintDef, type ObjectiveTerm, type ParameterDef, type SearchSettings } from "@/lib/api";
import { keys } from "@/lib/query";
import { GLOSSARY, term } from "@/lib/glossary";
import { useEngine } from "@/hooks/useEngine";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Define } from "@/components/ui/overlay";
import { Field, Input, Select, Switch, Tabs, TabList, Tab, TabsContent } from "@/components/ui/controls";
import { Pill } from "@/components/ui/pill";
import { OriginTag } from "@/components/plans/shared";
import { cn } from "@/lib/utils";

const LEVEL_WORDS: Record<string, string> = { L1: "Operational integrity (decides first)", L2: "Passengers", L3: "Cost", L4: "Robustness" };
const SEARCH_WORDS: Record<string, { label: string; short: string; time?: "up" | "down" }> = {
  K: { label: "Beam width", short: "How many partial plans the search keeps alive at each step.", time: "up" },
  D: { label: "Depth", short: "How many actions a plan can combine.", time: "up" },
  M: { label: "Candidates per step", short: "How many candidate actions survive the pre-ranking at each step.", time: "up" },
  N: { label: "Finalists", short: "How many plans are re-evaluated across sampled futures.", time: "up" },
  S: { label: "Futures sampled", short: "How many draws of the uncertain parts (when the fog lifts) each finalist is replayed under.", time: "up" },
  latency_budget_ms: { label: "Time budget (ms)", short: "The engine trades samples and depth for speed once this is exceeded, unless deterministic replay is on.", time: "down" },
  hysteresis_pct: { label: "Hysteresis (%)", short: "A new plan must beat the previous recommendation by this much before the engine changes its mind." },
  horizon_hours: { label: "Decision horizon (hours)", short: GLOSSARY.horizon.short },
  at_risk_delay_threshold_min: { label: "At-risk delay threshold (min)", short: "A flight delayed beyond this is flagged at risk." },
  top_n_returned: { label: "Plans returned", short: "How many plans the console shows." },
  max_delay_min: { label: "Longest hold (min)", short: "The engine never holds a flight longer than this." },
  forced_cancel_delay_min: { label: "Cancel-itself delay (min)", short: "A flight that would depart later than this cancels itself in the simulation." },
  standby_hold_min: { label: "Standby hold (min)", short: "How long a leg can wait for a standby crew." },
  max_staleness_min: { label: "Data staleness (min)", short: "Recommendations older than this are marked stale." },
  post_flight_duty_min: { label: "Post-flight duty (min)", short: "Duty minutes after the last landing, counted against the crew's limit." },
};
const RULE_LAW: Record<string, string> = {
  H1: "physics: an aircraft is where it landed",
  H2: "the fleet's minimum turnaround times",
  H3a: "DGCA CAR Section 7, Series J, Part III (flight duty period limits); values marked VERIFY in the README",
  H3b: "DGCA CAR Section 7, Series J, Part III (rest requirements)",
  H3c: "a crew must be where the leg departs",
  H3d: "type ratings and CAT-III qualification (DGCA rostering direction, December 2023)",
  H4a: "airport night curfews",
  H4b: "runway and slot capacity, cut under fog and ATC flow restrictions",
  H4c: "stands and gates",
  H4d: "airport closures",
  H5a: "an aircraft on ground cannot fly",
  H5b: "minimum equipment list restrictions",
  H5c: "maintenance due times",
  H6: "flights the airline marks as never to be cancelled",
  H7: "the hold limits above",
  H8: "aircraft type, seats and range for a re-fleet",
  H9: "passenger minimum connection time at each airport",
};
const OPERATIONAL_SEARCH = new Set(["horizon_hours", "deterministic", "top_n_returned", "hysteresis_pct"]);

/** Parameters (spec §7): operational policy a duty manager may change, kept apart from engine configuration
 *  marked experimental, each value with what it does and its effect on time. */
export function ParametersPage() {
  const qc = useQueryClient();
  const { demo, health } = useEngine();
  const cfg = useQuery({ queryKey: keys.config, queryFn: () => api.config(), staleTime: 5 * 60_000 });
  const presets = useQuery({ queryKey: ["presets"], queryFn: () => api.presets(), staleTime: 60_000 });
  const env: ConfigEnvelope | null = cfg.data?.data ?? null;
  const [search, setSearch] = useState<SearchSettings | null>(null);
  const [terms, setTerms] = useState<ObjectiveTerm[] | null>(null);
  const [constraints, setConstraints] = useState<ConstraintDef[] | null>(null);
  const [params, setParams] = useState<ParameterDef[] | null>(null);
  const [presetName, setPresetName] = useState("");
  useEffect(() => {
    if (!env) return;
    const id = setTimeout(() => {
      setSearch(env.config.search);
      setTerms(env.config.objective_terms ?? []);
      setConstraints(env.config.constraints ?? []);
      setParams(env.config.parameters ?? []);
    }, 0);
    return () => clearTimeout(id);
  }, [env]);

  const blocked = demo ? "Unavailable while the engine is asleep" : health?.write_key_required && !process.env.NEXT_PUBLIC_API_KEY ? "Editing needs the write key (set NEXT_PUBLIC_API_KEY)" : null;
  const dirty = {
    search: !!env && !!search && JSON.stringify(search) !== JSON.stringify(env.config.search),
    terms: !!env && !!terms && JSON.stringify(terms) !== JSON.stringify(env.config.objective_terms),
    constraints: !!env && !!constraints && JSON.stringify(constraints) !== JSON.stringify(env.config.constraints),
    params: !!env && !!params && JSON.stringify(params) !== JSON.stringify(env.config.parameters),
  };
  const done = async (e: { data: ConfigEnvelope }, what: string) => {
    qc.setQueryData(keys.config, e);
    await qc.invalidateQueries();
    toast(`${what} saved; configuration is now ${e.data.hash}`);
  };
  const fail = (e: unknown) => toast.error(needsWriteKey(e) ? "Editing needs the write key" : e instanceof Error ? e.message : "Could not save");
  const putSearch = useMutation({ mutationFn: () => api.putSearch(search!), onSuccess: (e) => done(e, "Search settings"), onError: fail });
  const putTerms = useMutation({ mutationFn: () => api.putTerms(terms!), onSuccess: (e) => done(e, "Objective terms"), onError: fail });
  const putConstraints = useMutation({ mutationFn: () => api.putConstraints(constraints!), onSuccess: (e) => done(e, "Hard rules"), onError: fail });
  const putParams = useMutation({ mutationFn: () => api.putParameters(params!), onSuccess: (e) => done(e, "Parameters"), onError: fail });
  const reset = useMutation({ mutationFn: () => api.resetConfig(), onSuccess: (e) => done(e, "Defaults restored"), onError: fail });
  const savePreset = useMutation({ mutationFn: () => api.savePreset(presetName.trim()), onSuccess: async () => { toast(`Preset ${presetName.trim()} saved`); setPresetName(""); await qc.invalidateQueries({ queryKey: ["presets"] }); }, onError: fail });
  const loadPreset = useMutation({ mutationFn: (name: string) => api.loadPreset(name), onSuccess: (e) => done(e, "Preset loaded"), onError: fail });

  const termsByLevel = useMemo(() => {
    const m = new Map<string, ObjectiveTerm[]>();
    for (const t of terms ?? []) m.set(t.level, [...(m.get(t.level) ?? []), t]);
    return [...m.entries()].sort();
  }, [terms]);

  if (!env || !search || !terms || !constraints || !params) return <p className="text-[13px] text-ivory-2">{cfg.error instanceof Error ? cfg.error.message : "Loading the configuration…"}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-ivory-2">
        <OriginTag origin={cfg.data?.origin ?? null} />
        <span>
          <Define short={GLOSSARY.config_hash.short}>Configuration</Define> <span className="mono text-ivory">{env.hash}</span>, version {env.version}, preset {env.config.preset_name}
        </span>
        {blocked && <span className="text-ivory-3">{blocked}</span>}
        <Button size="sm" variant="ghost" className="ml-auto" disabled={!!blocked || reset.isPending} onClick={() => reset.mutate()}>
          Restore defaults
        </Button>
      </div>

      <Panel title="Operational policy" aside={<span className="text-ivory-3">what a duty manager may change</span>}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {["horizon_hours", "top_n_returned", "hysteresis_pct"].map((k) => (
            <Field key={k} label={<Define short={SEARCH_WORDS[k].short}>{SEARCH_WORDS[k].label}</Define>}>
              <Input type="number" value={String((search as Record<string, unknown>)[k] ?? "")} onChange={(e) => setSearch({ ...search, [k]: Number(e.target.value) })} disabled={!!blocked} aria-label={SEARCH_WORDS[k].label} />
            </Field>
          ))}
          <Field label={<Define short={GLOSSARY.deterministic.short}>Deterministic replay</Define>}>
            <Switch checked={!!(search as Record<string, unknown>).deterministic} onChange={(v) => setSearch({ ...search, deterministic: v })} label={<span className="text-[12.5px] text-ivory-2">{(search as Record<string, unknown>).deterministic ? "on: same inputs, same answer" : "off: the engine may trade samples for speed"}</span>} className={cn("h-8", blocked && "pointer-events-none opacity-50")} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" disabled={!!blocked || !dirty.search || putSearch.isPending} onClick={() => putSearch.mutate()}>
            Save policy
          </Button>
          <span className="text-[12px] text-ivory-3">Presets:</span>
          {(presets.data?.data ?? []).map((p) => (
            <Button key={p.name} size="sm" variant="outline" disabled={!!blocked} onClick={() => loadPreset.mutate(p.name)}>
              {p.name}
            </Button>
          ))}
          <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Save current as…" aria-label="Preset name" className="w-[160px]" disabled={!!blocked} />
          <Button size="sm" variant="outline" disabled={!!blocked || !presetName.trim() || savePreset.isPending} onClick={() => savePreset.mutate()}>
            Save preset
          </Button>
        </div>
      </Panel>

      <Panel title="Engine configuration" aside={<Pill tone="amber">experimental: changes what the benchmark means</Pill>} bodyClassName="p-0">
        <Tabs defaultValue="terms">
          <TabList className="px-3.5">
            <Tab value="terms">What the engine minimises</Tab>
            <Tab value="rules">Hard rules</Tab>
            <Tab value="search">Search budget</Tab>
            <Tab value="params">Cost and policy values</Tab>
          </TabList>

          <TabsContent value="terms" className="space-y-4 p-3.5 outline-none">
            <p className="text-[12.5px] text-ivory-2">
              The <Define short={GLOSSARY.network_impact.short} long={GLOSSARY.network_impact.long}>network impact</Define> is the weighted sum of these terms. Level 1 decides first; lower levels only break ties within the tolerance. The weights are placeholders chosen to demonstrate the method, not calibrated airline values.
            </p>
            {termsByLevel.map(([level, list]) => (
              <div key={level}>
                <h4 className="mb-1.5 text-[12px] font-semibold text-ivory">{level}: {LEVEL_WORDS[level] ?? level}</h4>
                <div className="divide-y divide-hairline rounded-panel border border-hairline">
                  {list.map((t) => {
                    const i = terms.indexOf(t);
                    return (
                      <div key={t.name} className="grid grid-cols-[1fr_110px_auto] items-center gap-3 px-3 py-2 text-[12.5px]">
                        <div>
                          <div className="text-ivory">{t.name.replace(/_/g, " ")}</div>
                          <div className="text-[12px] text-ivory-3">{t.description}</div>
                          {t.expression !== t.name && <div className="mono text-[11px] text-ivory-3">{t.expression}</div>}
                        </div>
                        <Input type="number" step="any" value={String(t.weight)} onChange={(e) => setTerms(terms.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))} disabled={!!blocked} aria-label={`${t.name} weight`} className="h-7 text-right" />
                        <Switch checked={t.enabled} onChange={(v) => setTerms(terms.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} className={cn(blocked && "pointer-events-none opacity-50")} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <Button variant="primary" size="sm" disabled={!!blocked || !dirty.terms || putTerms.isPending} onClick={() => putTerms.mutate()}>
              Save terms
            </Button>
          </TabsContent>

          <TabsContent value="rules" className="space-y-3 p-3.5 outline-none">
            <p className="text-[12.5px] text-ivory-2">A plan that breaks a hard rule is never proposed, whatever its score. Rules are checked by the simulator on every leg.</p>
            <div className="divide-y divide-hairline rounded-panel border border-hairline">
              {constraints.map((c, i) => (
                <div key={c.id} className="grid grid-cols-[52px_1fr_auto] items-center gap-3 px-3 py-2 text-[12.5px]">
                  <span className="mono text-ivory-3">{c.id}</span>
                  <div>
                    <div className="text-ivory">{c.name}</div>
                    <div className="text-[12px] text-ivory-3">{c.description}</div>
                    {RULE_LAW[c.id] && <div className="text-[11.5px] text-ivory-3">Behind it: {RULE_LAW[c.id]}.</div>}
                    {c.kind === "expression" && <div className="mono text-[11px] text-ivory-3">{JSON.stringify(c.config)}</div>}
                  </div>
                  <Switch checked={c.enabled} onChange={(v) => setConstraints(constraints.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} className={cn(blocked && "pointer-events-none opacity-50")} />
                </div>
              ))}
            </div>
            <Button variant="primary" size="sm" disabled={!!blocked || !dirty.constraints || putConstraints.isPending} onClick={() => putConstraints.mutate()}>
              Save rules
            </Button>
          </TabsContent>

          <TabsContent value="search" className="space-y-3 p-3.5 outline-none">
            <p className="text-[12.5px] text-ivory-2">How hard the engine searches. Higher values find more, and take longer; the time budget decides when it stops.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.keys(SEARCH_WORDS)
                .filter((k) => !OPERATIONAL_SEARCH.has(k) && k in search)
                .map((k) => (
                  <Field key={k} label={<Define short={SEARCH_WORDS[k].short}>{SEARCH_WORDS[k].label}</Define>} hint={SEARCH_WORDS[k].time === "up" ? "Higher values increase compute time." : SEARCH_WORDS[k].time === "down" ? "Lower values cut samples and depth sooner." : undefined}>
                    <Input type="number" step="any" value={String((search as Record<string, unknown>)[k] ?? "")} onChange={(e) => setSearch({ ...search, [k]: Number(e.target.value) })} disabled={!!blocked} aria-label={SEARCH_WORDS[k].label} />
                  </Field>
                ))}
              <Field label="Candidate scope" hint="Which flights get candidate actions.">
                <Select value={search.candidate_scope ?? "at_risk_only"} onChange={(v) => setSearch({ ...search, candidate_scope: v })} ariaLabel="Candidate scope" className="w-full" options={[{ value: "at_risk_only", label: "At-risk flights only" }, { value: "at_risk_plus_neighbours", label: "At-risk flights and their neighbours" }]} />
              </Field>
              <Field label="Ranking" hint="Composite: one weighted score. Priority: level by level.">
                <Select value={search.ranking_mode ?? "composite"} onChange={(v) => setSearch({ ...search, ranking_mode: v })} ariaLabel="Ranking mode" className="w-full" options={[{ value: "composite", label: "Composite score" }, { value: "priority", label: "Level by level" }]} />
              </Field>
            </div>
            <Button variant="primary" size="sm" disabled={!!blocked || !dirty.search || putSearch.isPending} onClick={() => putSearch.mutate()}>
              Save search budget
            </Button>
          </TabsContent>

          <TabsContent value="params" className="space-y-3 p-3.5 outline-none">
            <p className="text-[12.5px] text-ivory-2">Money and policy values the outcomes are priced with. The compensation ceilings follow DGCA CAR Section 3, Series M, Part IV and are marked VERIFY in the README; they price synthetic days, not real ones.</p>
            <div className="divide-y divide-hairline rounded-panel border border-hairline">
              {params.map((p, i) => (
                <div key={p.name} className="grid grid-cols-[1fr_140px] items-center gap-3 px-3 py-2 text-[12.5px]">
                  <div>
                    <div className="text-ivory">{p.name.replace(/_/g, " ")}{p.unit ? <span className="text-ivory-3"> ({p.unit})</span> : null}</div>
                    <div className="text-[12px] text-ivory-3">{p.description}{p.scope !== "global" ? ` Per ${p.scope}.` : ""}{p.source !== "builtin" ? ` Source: ${p.source}.` : ""}</div>
                  </div>
                  {p.type === "bool" ? (
                    <Switch checked={!!p.default} onChange={(v) => setParams(params.map((x, j) => (j === i ? { ...x, default: v } : x)))} className={cn(blocked && "pointer-events-none opacity-50")} />
                  ) : (
                    <Input type={p.type === "number" ? "number" : "text"} step="any" value={String(p.default ?? "")} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, default: p.type === "number" ? Number(e.target.value) : e.target.value } : x)))} disabled={!!blocked} aria-label={p.name} className="h-7 text-right" />
                  )}
                </div>
              ))}
            </div>
            <Button variant="primary" size="sm" disabled={!!blocked || !dirty.params || putParams.isPending} onClick={() => putParams.mutate()}>
              Save values
            </Button>
          </TabsContent>
        </Tabs>
      </Panel>
      <p className="text-[12px] text-ivory-3">{term("config_hash").short} Every run records the configuration it used, so results stay comparable.</p>
    </div>
  );
}
