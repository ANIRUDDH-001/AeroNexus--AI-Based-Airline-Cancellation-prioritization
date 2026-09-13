// Typed client for the AeroNexus API (Plan §19). Local dev goes through the Vite proxy (/api);
// production points at VITE_API_URL (Render or a Cloudflare Tunnel).

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (e) {
    return serveStatic<T>(path, init, e); // network error: API asleep / offline
  }
  if (res.status === 502 || res.status === 503 || res.status === 504 || (res.status === 500 && !(res.headers.get("content-type") ?? "").includes("json"))) {
    return serveStatic<T>(path, init, new ApiError(res.status, res.statusText)); // host or proxy error, not an engine error
  }
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  staticMode.set(false);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- static demo fallback (Plan §20)
// When the API cannot be reached, read-only calls are answered from the precomputed bundle in /static-runs
// (built by scripts/precompute_demo.py). Anything that needs the live engine fails with a clear 503.

type StaticIndex = { generated_at: string; engine_version: string; config_hash: string; decision_times: number[]; instance: InstanceRow; runs: RunRow[] };
const STATIC_ID = "static-demo";
let staticIndex: Promise<StaticIndex | null> | null = null;
const staticFiles = new Map<string, Promise<unknown>>();

/** Tiny observable so the shell can show "static demo mode" without a store dependency. */
export const staticMode = {
  active: false,
  listeners: new Set<(on: boolean) => void>(),
  set(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.listeners.forEach((l) => l(on));
  },
  subscribe(l: (on: boolean) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  },
};

function staticFile<T>(name: string): Promise<T> {
  if (!staticFiles.has(name)) {
    staticFiles.set(
      name,
      fetch(`/static-runs/${name}`).then((r) => {
        if (!r.ok) throw new ApiError(r.status, `static bundle missing ${name}`);
        return r.json();
      }),
    );
  }
  return staticFiles.get(name) as Promise<T>;
}

async function serveStatic<T>(path: string, init: RequestInit | undefined, cause: unknown): Promise<T> {
  staticIndex ??= staticFile<StaticIndex>("index.json").catch(() => null);
  const idx = await staticIndex;
  if (!idx) throw cause instanceof ApiError ? cause : new ApiError(0, "API unreachable");
  staticMode.set(true);
  const [p, q = ""] = path.split("?");
  const params = new URLSearchParams(q);
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const nearest = (t: number) => idx.decision_times.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
  const runAt = async (t: number): Promise<Run> => {
    const run = await staticFile<Run>(`run_${nearest(t)}.json`);
    const note = `static demo mode: precomputed recommendation at ${hhmm(nearest(t))} (${idx.generated_at})`;
    return run.notes.includes(note) ? run : { ...run, notes: [...run.notes, note] };
  };
  const tablePrefix = `/data/instances/${STATIC_ID}/table/`;
  const table = p.startsWith(tablePrefix) ? p.slice(tablePrefix.length) : null;
  const runById = p.match(/^\/runs\/([^/]+)$/);

  if (p === "/health") return { status: "static", engine_version: idx.engine_version, config_hash: idx.config_hash, config_version: 1, narration_enabled: false } as T;
  if (p === "/config" && method === "GET") return staticFile<T>("config.json");
  if (p === "/config/presets") return [] as T;
  if (p === "/data/instances") return [idx.instance] as T;
  if (p === `/data/instances/${STATIC_ID}`) return staticFile<T>("instance.json");
  if (table) return staticFile<T>(`table_${table}.json`);
  if (p === "/timeline") return staticFile<T>(`timeline_${nearest(Number(params.get("t") ?? 0))}.json`);
  if (p === "/recommend" && method === "POST") return runAt(Number(body.decision_time ?? 0)) as Promise<T>;
  if (p === "/runs") return idx.runs as T;
  if (runById) {
    const row = idx.runs.find((r) => r.id === runById[1]);
    if (row) return runAt(row.decision_time) as Promise<T>;
  }
  if (p === "/cases") return staticFile<T>("case_defs.json");
  if (p === "/cases/latest" || p === "/cases/run") return staticFile<T>("cases.json");
  if (p === "/benchmark/latest") return staticFile<T>("benchmark.json");
  throw new ApiError(503, "Static demo mode - the API is unreachable, so this action is unavailable. Start the API (or wake the hosted one) and retry.");
}

const json = (body: unknown) => JSON.stringify(body);

// ---------------------------------------------------------------- types

export type Health = { status: string; engine_version: string; config_hash: string; config_version: number; narration_enabled: boolean };

export type InstanceSummary = {
  name: string; size: string; seed: number | null; day_start: string; airports: number; hubs: number; aircraft: number;
  flights: number; crews: number; standby_crews: number; itineraries: number; booked_pax: number; connecting_pax: number; disruptions: number;
};
export type InstanceRow = { id: string; name: string; size: string; seed: number | null; created_at: string; summary: InstanceSummary };

export type ParameterDef = { name: string; type: "number" | "bool" | "enum" | "text"; scope: string; default: unknown; unit?: string | null; description: string; source: string; choices?: string[] | null };
export type ObjectiveTerm = { name: string; level: "L1" | "L2" | "L3" | "L4"; expression: string; weight: number; enabled: boolean; description: string };
export type ConstraintDef = { id: string; name: string; kind: "builtin" | "expression"; plugin: string | null; config: Record<string, unknown>; enabled: boolean; severity: "hard"; description: string };
export type SearchSettings = Record<string, unknown> & { K: number; D: number; M: number; N: number; S: number; latency_budget_ms: number; hysteresis_pct: number; ranking_mode: "composite" | "priority"; candidate_scope: string; max_delay_min: number; at_risk_delay_threshold_min: number; top_n_returned: number; forced_cancel_delay_min: number };
export type EngineConfig = { parameters: ParameterDef[]; objective_terms: ObjectiveTerm[]; constraints: ConstraintDef[]; search: SearchSettings; preset_name: string };
export type ConfigEnvelope = { version: number; hash: string; updated_at: string; config: EngineConfig };

export type Disruption = { id: string; type: string; target: string; start: number; end_nominal: number | null; end_distribution: Record<string, unknown> | null; severity: Record<string, unknown>; attributes: Record<string, unknown> };

export type TimelineFlight = {
  id: string; number: string; origin: string; dest: string; std: number; sta: number; std_hhmm: string; sta_hhmm: string; tail: string | null; crew_id: string | null;
  aircraft_type: string; booked_pax: number; pax_connecting: number; status: "OPERATED" | "PAST" | "CANCELLED_DECISION" | "CANCELLED_FORCED";
  dep: number | null; arr: number | null; delay_min: number; reason: string | null; standby_called: boolean; at_risk: boolean; risk_reasons: string[]; protected: boolean;
};
export type AtRisk = { flight: string; reasons: string[]; delay_min: number; forced: boolean };
export type Timeline = {
  instance_id: string; clock: number; clock_hhmm: string; flights: TimelineFlight[]; rotations: Record<string, string[]>; disruptions: Disruption[]; at_risk: AtRisk[];
  summary: { flights: number; at_risk: number; forced_cancellations: number; delayed_flights: number; total_delay_min: number; misconnects: number; stranded_overnight: number; standby_used: number; aircraft_available: number; standby_crews: number };
};

export type Action = { type: "CANCEL_LEG" | "CANCEL_CYCLE" | "DELAY" | "SWAP" | "WAIT"; target_flights: string[]; params?: Record<string, unknown>; feasibility?: { status: string; reasons: string[] }; metrics?: Record<string, number> };
export type Confidence = { feasibility: string; feasible_share: number; data_freshness_min: number | null; stability: number | null; stability_label: string | null; scenario_sensitivity: number; scenario_sensitivity_label: string; samples: number };
export type Comparison = { verdict: string; differences: string[]; margin: number };
export type Plan = {
  actions: Action[]; metrics: Record<string, number>; nis: number; nis_breakdown: Record<string, number>;
  scenario_stats: { mean: number; p90: number; stability: number | null; samples: number } | null;
  explanation: { actions: string[]; reasons: string[]; vs_do_nothing: Record<string, number>; remaining_at_risk: string[]; confidence: Confidence; forced_cancellations: { flight: string; reason: string }[]; standby_used: string[]; equivalent_alternatives: string[][]; why_over_next?: Comparison; vs_top?: Comparison };
  rank: number | null;
};
export type Run = {
  id: string; created_at: string; decision_time: number; instance_name: string; config_hash: string; engine_version: string; plans: Plan[]; excluded: Action[]; latency_ms: number;
  accepted_plan: number | null; override_reason: string | null; narrative: string | null; notes: string[]; at_risk: AtRisk[]; baseline_metrics: Record<string, number>; plans_evaluated: number; depth_reached: number; whatif: Plan[];
};
export type RunRow = { id: string; created_at: string; instance_id: string; decision_time: number; config_hash: string; engine_version: string; accepted_plan: number | null; override_reason: string | null; latency_ms: number | null; top_plan: string[]; top_nis: number | null; at_risk: number; plans_evaluated: number | null };

export type Table = { entity: string; key: string; columns: string[]; attribute_columns: string[]; rows: Record<string, unknown>[] };

export type CaseDef = { id: string; title: string; rationale: string; base: string; disruptions: string[]; decision_time: number; expected: string[] };
export type CaseResult = {
  id: string; title: string; passed: boolean; top1: string[]; expected: string[]; matched: "top1" | "acceptable" | "type" | "none"; checks: string[]; failures: string[];
  latency_ms: number; nis: number | null; baseline_forced: number | null; plan_forced: number | null; rationale: string; top_reasons: string[];
  plans: { rank: number | null; actions: string[]; nis: number }[]; excluded: { key: string; reasons: string[] }[]; plans_evaluated: number;
};
export type CasesRun = { config_hash: string; config_version: number; use_surrogate: boolean; passed: number; total: number; elapsed_ms: number; results: CaseResult[] };
export type PolicySummary = {
  nis_mean: number; nis_p90_mean: number; forced_mean: number; pax_cancelled_mean: number; pax_stranded_mean: number; misconnects_mean: number; delay_min_mean: number;
  win_rate_vs_B0: number; tie_rate_vs_B0: number; improvement_vs_B0_pct: number; latency_ms_mean: number; latency_ms_p95: number;
};
export type PolicyOutcome = { nis_mean: number; nis_p90: number; forced: number; pax_cancelled: number; pax_stranded: number; misconnects: number; delay_min: number; latency_ms: number; actions: string[] };
export type Benchmark = {
  created_at: string; config_hash: string; current_config_hash: string; stale: boolean; scenarios: number; s_eval: number; block_sigma: number; seed: number;
  summary: Record<string, PolicySummary>;
  records: { name: string; size: string; disruption: string; clock: number; at_risk: number; baseline_forced: number; policies: Record<string, PolicyOutcome> }[];
};
export type Entity = "flights" | "aircraft" | "crews" | "airports" | "itineraries";

// ---------------------------------------------------------------- calls

export const api = {
  health: () => request<Health>("/health"),
  // config
  config: () => request<ConfigEnvelope>("/config"),
  putTerms: (terms: ObjectiveTerm[]) => request<ConfigEnvelope>("/config/terms", { method: "PUT", body: json(terms) }),
  putConstraints: (c: ConstraintDef[]) => request<ConfigEnvelope>("/config/constraints", { method: "PUT", body: json(c) }),
  putParameters: (p: ParameterDef[]) => request<ConfigEnvelope>("/config/parameters", { method: "PUT", body: json(p) }),
  putSearch: (s: SearchSettings) => request<ConfigEnvelope>("/config/search", { method: "PUT", body: json(s) }),
  validateTerms: (terms: ObjectiveTerm[]) => request<{ ok: boolean; problems: Record<string, unknown> }>("/config/validate", { method: "POST", body: json({ terms }) }),
  presets: () => request<{ name: string; version: number; hash: string; updated_at: string }[]>("/config/presets"),
  savePreset: (name: string) => request<ConfigEnvelope>(`/config/presets/${encodeURIComponent(name)}`, { method: "POST" }),
  loadPreset: (name: string) => request<ConfigEnvelope>(`/config/presets/${encodeURIComponent(name)}/load`, { method: "POST" }),
  resetConfig: () => request<ConfigEnvelope>("/config/reset", { method: "POST" }),
  metrics: () => request<{ metrics: string[] }>("/config/metrics"),
  // data
  instances: () => request<InstanceRow[]>("/data/instances"),
  generate: (body: { size: "small" | "medium" | "large"; seed: number; disruptions?: string[] }) =>
    request<{ id: string; summary: InstanceSummary; issues: string[] }>("/data/generate", { method: "POST", body: json(body) }),
  deleteInstance: (id: string) => request<{ deleted: string }>(`/data/instances/${id}`, { method: "DELETE" }),
  table: (id: string, entity: Entity) => request<Table>(`/data/instances/${id}/table/${entity}`),
  patchRow: (id: string, entity: Entity, key: string, body: { fields?: Record<string, unknown>; attributes?: Record<string, unknown>; remove_attributes?: string[] }) =>
    request<{ id: string; summary: InstanceSummary; issues: string[] }>(`/data/instances/${id}/${entity}/${encodeURIComponent(key)}`, { method: "PATCH", body: json(body) }),
  addColumn: (id: string, body: { entity: Entity; name: string; type: "number" | "bool" | "text"; default: unknown; description?: string }) =>
    request<{ id: string; summary: InstanceSummary; issues: string[]; config_version?: number; config_hash?: string }>(`/data/instances/${id}/columns`, { method: "POST", body: json(body) }),
  addDisruption: (id: string, spec: string) => request<{ summary: InstanceSummary }>(`/data/instances/${id}/disruptions`, { method: "POST", body: json({ spec }) }),
  removeDisruption: (id: string, did: string) => request<{ summary: InstanceSummary }>(`/data/instances/${id}/disruptions/${encodeURIComponent(did)}`, { method: "DELETE" }),
  // engine
  timeline: (id: string, t: number) => request<Timeline>(`/timeline?instance_id=${id}&t=${t}`),
  recommend: (body: { instance_id: string; decision_time: number; seed?: number; previous_run_id?: string | null; whatif?: Action[][] }) =>
    request<Run>("/recommend", { method: "POST", body: json(body) }),
  whatif: (body: { instance_id: string; decision_time: number; actions: Action[]; seed?: number }) => request<Run>("/whatif", { method: "POST", body: json(body) }),
  runs: (instanceId?: string) => request<RunRow[]>(`/runs${instanceId ? `?instance_id=${instanceId}` : ""}`),
  run: (id: string) => request<Run>(`/runs/${id}`),
  decide: (id: string, body: { accepted_plan: number | null; override_reason: string | null }) => request<Run>(`/runs/${id}/decision`, { method: "POST", body: json(body) }),
  // validation
  cases: () => request<CaseDef[]>("/cases"),
  runCases: (body: { ids?: string[]; use_surrogate?: boolean }) => request<CasesRun>("/cases/run", { method: "POST", body: json(body) }),
  latestCases: () => request<CasesRun>("/cases/latest"),
  benchmark: () => request<Benchmark>("/benchmark/latest"),
  runBenchmark: (body: { scenarios: number; s_eval: number; seed?: number; use_surrogate?: boolean; save?: boolean }) => request<Benchmark>("/benchmark/run", { method: "POST", body: json(body) }),
};

// ---------------------------------------------------------------- helpers

export const hhmm = (m: number | null | undefined) => {
  if (m == null) return "—";
  const day = Math.floor(m / 1440);
  const rem = m - day * 1440;
  const h = Math.floor(rem / 60);
  const mm = rem % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}${day ? `+${day}` : ""}`;
};
export const fmt = (n: number | null | undefined, digits = 0) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits }));
