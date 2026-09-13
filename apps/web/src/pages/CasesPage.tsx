import { useEffect, useState } from "react";
import { api, fmt, hhmm, type Benchmark, type CaseDef, type CaseResult, type CasesRun } from "@/lib/api";
import { Button, Card, Empty, Kpi, PageTitle, Tag } from "@/components/Shell";

const POLICY_LABEL: Record<string, string> = {
  do_nothing: "Do nothing",
  B0_naive: "B0 · naive (cancel fewest pax)",
  B1_weighted: "B1 · weighted heuristic",
  B2_aeronexus: "B2 · AeroNexus",
  B2s_surrogate: "B2s · AeroNexus + surrogate",
};

/** Validation page (Plan §17): the hand-crafted case suite and the benchmark ladder, both run on the current configuration. */
export function CasesPage() {
  const [defs, setDefs] = useState<CaseDef[]>([]);
  const [run, setRun] = useState<CasesRun | null>(null);
  const [running, setRunning] = useState(false);
  const [useSurrogate, setUseSurrogate] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [bench, setBench] = useState<Benchmark | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const [benchScenarios, setBenchScenarios] = useState(4);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .cases()
      .then(setDefs)
      .catch(() => setDefs([]));
    api
      .latestCases()
      .then(setRun)
      .catch(() => setRun(null));
    api
      .benchmark()
      .then(setBench)
      .catch(() => setBench(null));
  }, []);

  const runAll = async () => {
    setRunning(true);
    setError(null);
    try {
      setRun(await api.runCases({ use_surrogate: useSurrogate }));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const runBench = async () => {
    setBenchRunning(true);
    setError(null);
    try {
      setBench(
        await api.runBenchmark({
          scenarios: benchScenarios,
          s_eval: 20,
          use_surrogate: true,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBenchRunning(false);
    }
  };

  const byId = new Map((run?.results ?? []).map((r) => [r.id, r]));

  return (
    <>
      <PageTitle
        title="Cases & benchmarks"
        subtitle="Twelve hand-written situations with a known right answer, and a ladder of simpler policies the engine must beat on futures it never searched."
        right={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              <input type="checkbox" checked={useSurrogate} onChange={(e) => setUseSurrogate(e.target.checked)} className="accent-accent" />
              surrogate pre-rank
            </label>
            <Button onClick={runAll} disabled={running}>
              {running ? "Running 12 cases…" : "Run case suite"}
            </Button>
          </div>
        }
      />
      {error && <p className="text-bad text-[13px] mb-4">{error}</p>}

      {run && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Kpi label="Cases passed" value={`${run.passed} / ${run.total}`} tone={run.passed === run.total ? "ok" : "bad"} />
          <Kpi
            label="Configuration"
            value={
              <span className="font-mono text-[15px]">
                {run.config_hash} · v{run.config_version}
              </span>
            }
          />
          <Kpi label="Pre-rank" value={run.use_surrogate ? "surrogate" : "heuristic"} />
          <Kpi label="Suite time" value={`${(run.elapsed_ms / 1000).toFixed(1)} s`} />
        </div>
      )}

      {defs.length === 0 ? (
        <Empty>No case files found under data/cases.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="ax-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Case</th>
                <th>Expected</th>
                <th>Engine top-1</th>
                <th>Forced</th>
                <th>Latency</th>
                <th>Result</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {defs.map((d, i) => {
                const r = byId.get(d.id);
                return (
                  <tr key={d.id}>
                    <td className="text-ink-2">{i + 1}</td>
                    <td>
                      <div className="font-medium">{d.title}</div>
                      <div className="text-[12px] text-ink-2">
                        {d.base} · {hhmm(d.decision_time)} · {d.disruptions.join(", ") || "no disruption"}
                      </div>
                    </td>
                    <td className="text-[12px]">
                      {d.expected.slice(0, 3).map((x, k) => (
                        <div key={k}>{x}</div>
                      ))}
                      {d.expected.length > 3 && <div className="text-ink-2">+{d.expected.length - 3} more</div>}
                    </td>
                    <td className="text-[12px]">{r ? r.top1.join(" + ") || <span className="text-ink-2">do nothing</span> : <span className="text-ink-2">—</span>}</td>
                    <td className="font-mono text-[12px]">{r ? `${fmt(r.baseline_forced)} → ${fmt(r.plan_forced)}` : "—"}</td>
                    <td className="font-mono text-[12px]">{r ? `${fmt(r.latency_ms)} ms` : "—"}</td>
                    <td>{r ? r.passed ? <Tag tone="ok">pass</Tag> : <Tag tone="bad">fail</Tag> : <Tag tone="gray">not run</Tag>}</td>
                    <td>
                      <button className="text-accent text-[13px]" onClick={() => setOpen(open === d.id ? null : d.id)}>
                        {open === d.id ? "hide" : "details"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && <CaseDetail def={defs.find((d) => d.id === open)!} result={byId.get(open)} onClose={() => setOpen(null)} />}

      <PageTitle
        title="Benchmark ladder"
        subtitle="Each policy's plan is scored on the same evaluation simulator - different random seed and block-time noise the search never sees - so the engine cannot grade its own homework."
        right={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              scenarios
              <input
                type="number"
                min={1}
                max={10}
                value={benchScenarios}
                onChange={(e) => setBenchScenarios(Number(e.target.value))}
                className="w-14 rounded-md border border-border bg-bg px-2 py-1 text-[13px] text-ink"
              />
            </label>
            <Button variant="ghost" onClick={runBench} disabled={benchRunning} title="A quick ladder on the current configuration (the full 30-scenario run is a CLI job)">
              {benchRunning ? "Running…" : "Quick ladder run"}
            </Button>
          </div>
        }
      />
      {!bench ? <Empty>No benchmark result yet. Run `python -m aeronexus_core.benchmark` or use the quick run above.</Empty> : <BenchmarkView bench={bench} />}
    </>
  );
}

function CaseDetail({ def, result, onClose }: { def: CaseDef; result?: CaseResult; onClose: () => void }) {
  return (
    <Card className="mt-4 mb-8">
      <div className="flex items-center gap-3 mb-2">
        <span className="font-medium">{def.title}</span>
        <span className="font-mono text-[12px] text-ink-2">{def.id}</span>
        <button className="ml-auto text-ink-2 text-[12px]" onClick={onClose}>
          close
        </button>
      </div>
      <p className="text-[13px] mb-3">{def.rationale}</p>
      <div className="grid md:grid-cols-2 gap-4 text-[13px]">
        <div>
          <div className="text-[12px] text-ink-2 mb-1">What the case expects</div>
          <ul className="space-y-0.5">
            {def.expected.map((x, i) => (
              <li key={i}>• {x}</li>
            ))}
          </ul>
        </div>
        {result && (
          <div>
            <div className="text-[12px] text-ink-2 mb-1">What the engine did ({result.plans_evaluated} plans simulated)</div>
            <ul className="space-y-0.5">
              {result.checks.map((x, i) => (
                <li key={`c${i}`} className="text-ok">
                  ✓ {x}
                </li>
              ))}
              {result.failures.map((x, i) => (
                <li key={`f${i}`} className="text-bad">
                  ✗ {x}
                </li>
              ))}
            </ul>
            {result.top_reasons.length > 0 && (
              <>
                <div className="text-[12px] text-ink-2 mt-3 mb-1">Top-1 reasoning</div>
                <ul className="space-y-0.5 text-ink-2">
                  {result.top_reasons.map((x, i) => (
                    <li key={i}>• {x}</li>
                  ))}
                </ul>
              </>
            )}
            {result.plans.length > 1 && (
              <>
                <div className="text-[12px] text-ink-2 mt-3 mb-1">Ranked plans</div>
                <ol className="space-y-0.5">
                  {result.plans.map((p) => (
                    <li key={p.rank ?? 0}>
                      <span className="font-semibold">#{p.rank}</span> {p.actions.join(" + ") || "Do nothing"} — NIS <span className="font-mono">{fmt(p.nis)}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {result.excluded.length > 0 && (
              <details className="mt-3 text-[12px]">
                <summary className="cursor-pointer text-ink-2">Excluded by hard constraints ({result.excluded.length})</summary>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                  {result.excluded.map((e, i) => (
                    <li key={i}>
                      {e.key} — {e.reasons.join("; ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function BenchmarkView({ bench }: { bench: Benchmark }) {
  const names = Object.keys(bench.summary);
  const b2 = bench.summary.B2_aeronexus;
  const b0 = bench.summary.B0_naive;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Scenarios (with at-risk flights)" value={bench.scenarios} />
        <Kpi label="Futures per plan" value={`${bench.s_eval} · σ ${bench.block_sigma}`} />
        {b2 && b0 && <Kpi label="AeroNexus vs B0" value={`${b2.improvement_vs_B0_pct.toFixed(1)} % lower NIS`} tone={b2.improvement_vs_B0_pct > 0 ? "ok" : "bad"} />}
        {b2 && <Kpi label="Win rate vs B0" value={`${Math.round(b2.win_rate_vs_B0 * 100)} %`} />}
      </div>
      <p className="text-[12px] text-ink-2 mb-3">
        Result from {new Date(bench.created_at).toLocaleString()} on configuration <span className="font-mono">{bench.config_hash}</span>
        {bench.stale && (
          <>
            {" "}
            <Tag tone="warn">configuration has changed since ({bench.current_config_hash})</Tag>
          </>
        )}
      </p>
      <div className="overflow-x-auto mb-6">
        <table className="ax-table">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Mean NIS</th>
              <th>p90 NIS</th>
              <th>vs B0</th>
              <th>Win rate</th>
              <th>Forced cancels</th>
              <th>Pax cancelled</th>
              <th>Stranded</th>
              <th>Misconnects</th>
              <th>Delay min</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {names.map((n) => {
              const s = bench.summary[n];
              const ours = n.startsWith("B2");
              return (
                <tr key={n} className={ours ? "font-medium" : ""}>
                  <td>{POLICY_LABEL[n] ?? n}</td>
                  <td className="font-mono">{fmt(s.nis_mean)}</td>
                  <td className="font-mono">{fmt(s.nis_p90_mean)}</td>
                  <td className={`font-mono ${s.improvement_vs_B0_pct > 0 ? "text-ok" : s.improvement_vs_B0_pct < 0 ? "text-bad" : ""}`}>
                    {n === "B0_naive" ? "—" : `${s.improvement_vs_B0_pct > 0 ? "−" : "+"}${Math.abs(s.improvement_vs_B0_pct).toFixed(1)} %`}
                  </td>
                  <td className="font-mono">{n === "B0_naive" ? "—" : `${Math.round(s.win_rate_vs_B0 * 100)} %`}</td>
                  <td className="font-mono">{s.forced_mean.toFixed(2)}</td>
                  <td className="font-mono">{fmt(s.pax_cancelled_mean)}</td>
                  <td className="font-mono">{fmt(s.pax_stranded_mean)}</td>
                  <td className="font-mono">{fmt(s.misconnects_mean)}</td>
                  <td className="font-mono">{fmt(s.delay_min_mean)}</td>
                  <td className="font-mono">{s.latency_ms_mean ? `${fmt(s.latency_ms_mean)} / p95 ${fmt(s.latency_ms_p95)} ms` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="text-[12px]">
        <summary className="cursor-pointer text-ink-2">Per-scenario results ({bench.records.length})</summary>
        <div className="overflow-x-auto mt-2">
          <table className="ax-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Disruption</th>
                <th>Clock</th>
                <th>At risk</th>
                {names.map((n) => (
                  <th key={n}>{n.replace("_", " ")}</th>
                ))}
                <th>AeroNexus plan</th>
              </tr>
            </thead>
            <tbody>
              {bench.records.map((r, i) => {
                const best = Math.min(...names.map((n) => r.policies[n]?.nis_mean ?? Infinity));
                return (
                  <tr key={i}>
                    <td className="text-ink-2">
                      {r.name} <span className="text-[11px]">({r.size})</span>
                    </td>
                    <td>{r.disruption}</td>
                    <td className="font-mono">{hhmm(r.clock)}</td>
                    <td>{r.at_risk}</td>
                    {names.map((n) => {
                      const p = r.policies[n];
                      return (
                        <td key={n} className={`font-mono ${p && Math.abs(p.nis_mean - best) < 1e-6 ? "text-ok font-medium" : ""}`}>
                          {p ? fmt(p.nis_mean) : "—"}
                        </td>
                      );
                    })}
                    <td className="text-[11px]">{r.policies.B2_aeronexus?.actions.join(" + ") || "do nothing"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
