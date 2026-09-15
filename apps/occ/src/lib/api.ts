// Typed client for the AeroNexus API. The shapes come from src/lib/api.types.ts, which is generated from the
// API's OpenAPI document (python scripts/export_openapi.py, then npm run api:types) — when the API changes,
// this file stops compiling instead of the UI breaking at runtime (spec §10.3).
//
// Local dev goes through the Next.js rewrite (/api -> the engine on :8000); production points at
// NEXT_PUBLIC_API_URL. Every result is tagged with where it came from: the live engine, or the precomputed
// demo bundle in /static-runs that answers read-only calls while the engine is unreachable (spec §10.2).

import type { paths } from "./api.types";
import { hhmm } from "./format";

const BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "") || "/api";
// Optional demo write key (mirrors AERONEXUS_WRITE_KEY on the API); sent on every call, ignored by open routes.
const WRITE_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

// ---------------------------------------------------------------- types derived from the OpenAPI document

type JsonOf<T> = T extends { content: { "application/json": infer R } } ? R : never;
type OkOf<T> = T extends { responses: { 200: infer R } } ? JsonOf<R> : never;
type BodyOf<T> = T extends { requestBody: { content: { "application/json": infer B } } } ? B : T extends { requestBody?: { content: { "application/json": infer B } } } ? B : never;

/** JSON body of the 200 response for a path and method, e.g. Ok<"/timeline", "get">. */
export type Ok<P extends keyof paths, M extends keyof paths[P]> = OkOf<paths[P][M]>;
/** JSON request body for a path and method, e.g. Body<"/recommend", "post">. */
export type Body<P extends keyof paths, M extends keyof paths[P]> = BodyOf<paths[P][M]>;

export type Health = Ok<"/health", "get">;
export type InstanceRow = Ok<"/data/instances", "get">[number];
export type InstanceSummary = InstanceRow["summary"];
export type InstanceCreated = Ok<"/data/generate", "post">;
export type ConfigEnvelope = Ok<"/config", "get">;
export type EngineConfig = ConfigEnvelope["config"];
export type ObjectiveTerm = NonNullable<EngineConfig["objective_terms"]>[number];
export type ConstraintDef = NonNullable<EngineConfig["constraints"]>[number];
export type ParameterDef = NonNullable<EngineConfig["parameters"]>[number];
export type SearchSettings = EngineConfig["search"];
export type Timeline = Ok<"/timeline", "get">;
export type TimelineFlight = Timeline["flights"][number];
export type TimelineSummary = Timeline["summary"];
export type AtRisk = Timeline["at_risk"][number];
export type Committed = Timeline["committed"];
export type Disruption = Timeline["disruptions"][number];
type GenRun = Ok<"/runs/{run_id}", "get">;
type GenPlan = GenRun["plans"][number];
export type Action = GenPlan["actions"][number];
/** The API declares a plan's explanation as a free dict; this is the shape the engine writes (search/explain.py). */
export type Confidence = {
  feasibility: string;
  feasible_share: number;
  data_freshness_min: number | null;
  stability: number | null;
  stability_label: string | null;
  scenario_sensitivity: number | null;
  scenario_sensitivity_label: string | null;
  samples: number;
  uncertainty_evaluated?: boolean;
};
export type Comparison = { verdict: string; differences: string[]; margin: number };
export type Explanation = {
  actions: string[];
  reasons: string[];
  vs_do_nothing: Record<string, number>;
  remaining_at_risk: string[];
  confidence: Confidence;
  forced_cancellations: { flight: string; reason: string }[];
  standby_used: string[];
  equivalent_alternatives: string[][];
  why_over_next?: Comparison;
  vs_top?: Comparison;
  score_drivers?: { feature: string; value: number; contribution: number }[];
};
export type Plan = Omit<GenPlan, "explanation" | "rank" | "metrics" | "nis_breakdown"> & { explanation: Explanation; rank: number | null; metrics: Record<string, number>; nis_breakdown: Record<string, number> };
export type Effective = { samples?: number; depth?: number; candidates_per_node?: number; deterministic?: boolean; budget_cuts?: string[]; surrogate?: boolean };
export type Run = Omit<GenRun, "plans" | "whatif" | "notes" | "baseline_metrics" | "at_risk" | "effective"> & { plans: Plan[]; whatif: Plan[]; notes: string[]; baseline_metrics: Record<string, number>; at_risk: { flight: string; reasons: string[]; delay_min: number; forced: boolean }[]; effective?: Effective };
export type RunRow = Ok<"/runs", "get">[number];
type GenTable = Ok<"/data/instances/{iid}/table/{entity}", "get">;
export type Table = Omit<GenTable, "rows" | "attribute_columns"> & { rows: Record<string, unknown>[]; attribute_columns: string[] };
export type Entity = "flights" | "aircraft" | "crews" | "airports" | "itineraries";
export type PresetRow = Ok<"/config/presets", "get">[number];
export type CaseDef = Ok<"/cases", "get">[number];
export type CasesRun = Ok<"/cases/latest", "get">;
type GenCaseResult = CasesRun["results"][number];
/** Lists the API declares with defaults come back optional in the generated type; the engine always sends them. */
export type CaseResult = Required<Omit<GenCaseResult, "excluded" | "plans">> & { excluded: Required<NonNullable<GenCaseResult["excluded"]>[number]>[]; plans: Required<NonNullable<GenCaseResult["plans"]>[number]>[] };
export type Benchmark = Ok<"/benchmark/latest", "get">;
export type PolicySummary = Benchmark["summary"][string];
export type RecommendRequest = Body<"/recommend", "post">;
export type GenerateRequest = Body<"/data/generate", "post">;
export type DecisionRequest = Body<"/runs/{run_id}/decision", "post">;

// ---------------------------------------------------------------- results carry their provenance

export type Origin = "live" | "demo";
export type Tagged<T> = { data: T; origin: Origin };

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
    public origin: Origin = "live",
  ) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

/** True when the request needs the write key and the API said so (401/403). */
export const needsWriteKey = (e: unknown): boolean => e instanceof ApiError && (e.status === 401 || e.status === 403);

/** Tiny observable so the shell can show the demo pill and banner without a store dependency. */
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

async function request<T>(path: string, init?: RequestInit): Promise<Tagged<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...(WRITE_KEY ? { "X-AeroNexus-Key": WRITE_KEY } : {}), ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (e) {
    return serveStatic<T>(path, init, e); // network error: engine asleep or offline
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
  return { data: (await res.json()) as T, origin: "live" };
}

// ---------------------------------------------------------------- static demo fallback

export type StaticIndex = {
  generated_at: string;
  engine_version: string;
  config_hash: string;
  decision_times: number[];
  deterministic?: boolean;
  seed?: number;
  instance: InstanceRow;
  runs: RunRow[];
  files: string[];
};
const STATIC_ID = "static-demo";
let staticIndex: Promise<StaticIndex | null> | null = null;
const staticFiles = new Map<string, Promise<unknown>>();

function staticFile<T>(name: string): Promise<T> {
  if (!staticFiles.has(name)) {
    staticFiles.set(
      name,
      fetch(`/static-runs/${name}`).then((r) => {
        if (!r.ok) throw new ApiError(r.status, `static bundle missing ${name}`, "demo");
        return r.json();
      }),
    );
  }
  return staticFiles.get(name) as Promise<T>;
}

/** The bundle's index, or null when no bundle is deployed. Used by the demo pill to show the build date and hash. */
export function staticBundle(): Promise<StaticIndex | null> {
  staticIndex ??= staticFile<StaticIndex>("index.json").catch(() => null);
  return staticIndex;
}

async function serveStatic<T>(path: string, init: RequestInit | undefined, cause: unknown): Promise<Tagged<T>> {
  const idx = await staticBundle();
  if (!idx) throw cause instanceof ApiError ? cause : new ApiError(0, "API unreachable");
  staticMode.set(true);
  const demo = async (p: Promise<unknown>): Promise<Tagged<T>> => ({ data: (await p) as T, origin: "demo" });
  const [p, q = ""] = path.split("?");
  const params = new URLSearchParams(q);
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const nearest = (t: number) => idx.decision_times.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
  const runAt = async (t: number): Promise<Run> => {
    const run = await staticFile<Run>(`run_${nearest(t)}.json`);
    const note = `precomputed demo: this recommendation was computed at ${hhmm(nearest(t))} on ${idx.generated_at.slice(0, 10)}; the engine is not reachable`;
    const notes = run.notes ?? [];
    return notes.includes(note) ? run : { ...run, notes: [...notes, note] };
  };
  const tablePrefix = `/data/instances/${STATIC_ID}/table/`;
  const table = p.startsWith(tablePrefix) ? p.slice(tablePrefix.length) : null;
  const runById = p.match(/^\/runs\/([^/]+)$/);

  if (p === "/health") {
    const h: Health = { status: "static", engine_version: idx.engine_version, config_hash: idx.config_hash, config_version: 1, narration_enabled: false, narration: { mode: "off", calls: 0, accepted: 0, rejected: 0, failed: 0 }, write_key_required: false };
    return { data: h as T, origin: "demo" };
  }
  if (p === "/config" && method === "GET") return demo(staticFile("config.json"));
  if (p === "/config/presets") return { data: [] as T, origin: "demo" };
  if (p === "/config/metrics") return demo(staticFile("metrics.json").catch(() => ({ metrics: [] })));
  if (p === "/data/instances") return { data: [idx.instance] as T, origin: "demo" };
  if (p === `/data/instances/${STATIC_ID}`) return demo(staticFile("instance.json"));
  if (p === `/data/instances/${STATIC_ID}/committed`) {
    const c: Committed = { cancelled: [], delays: {}, swaps: [], tail_override: {}, labels: [], count: 0 };
    return { data: c as T, origin: "demo" };
  }
  if (table) return demo(staticFile(`table_${table}.json`));
  if (p === "/timeline") return demo(staticFile(`timeline_${nearest(Number(params.get("t") ?? 0))}.json`));
  if (p === "/recommend" && method === "POST") return demo(runAt(Number(body.decision_time ?? 0)));
  if (p === "/runs") return { data: idx.runs as T, origin: "demo" };
  if (runById) {
    const row = idx.runs.find((r) => r.id === runById[1]);
    if (row) return demo(runAt(row.decision_time));
  }
  if (p === "/cases") return demo(staticFile("case_defs.json"));
  if (p === "/cases/latest" || p === "/cases/run") return demo(staticFile("cases.json"));
  if (p === "/benchmark/latest") return demo(staticFile("benchmark.json"));
  throw new ApiError(503, "The engine is unavailable, so this cannot run on the precomputed demo. Wake the engine and try again.", "demo");
}

const json = (body: unknown) => JSON.stringify(body);

// ---------------------------------------------------------------- calls

/** Raw health probe with no static fallback: used to detect a sleeping or starting engine (Render cold start). */
export async function pingLive(timeoutMs = 8000): Promise<Health | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/health`, { signal: ctl.signal });
    if (!res.ok) return null;
    const h = (await res.json()) as Health;
    staticMode.set(false);
    return h;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const api = {
  health: () => request<Health>("/health"),
  // config
  config: () => request<ConfigEnvelope>("/config"),
  putTerms: (terms: ObjectiveTerm[]) => request<ConfigEnvelope>("/config/terms", { method: "PUT", body: json(terms) }),
  putConstraints: (c: ConstraintDef[]) => request<ConfigEnvelope>("/config/constraints", { method: "PUT", body: json(c) }),
  putParameters: (p: ParameterDef[]) => request<ConfigEnvelope>("/config/parameters", { method: "PUT", body: json(p) }),
  putSearch: (s: SearchSettings) => request<ConfigEnvelope>("/config/search", { method: "PUT", body: json(s) }),
  validateTerms: (terms: ObjectiveTerm[]) => request<Ok<"/config/validate", "post">>("/config/validate", { method: "POST", body: json({ terms }) }),
  presets: () => request<PresetRow[]>("/config/presets"),
  savePreset: (name: string) => request<ConfigEnvelope>(`/config/presets/${encodeURIComponent(name)}`, { method: "POST" }),
  loadPreset: (name: string) => request<ConfigEnvelope>(`/config/presets/${encodeURIComponent(name)}/load`, { method: "POST" }),
  resetConfig: () => request<ConfigEnvelope>("/config/reset", { method: "POST" }),
  metrics: () => request<Ok<"/config/metrics", "get">>("/config/metrics"),
  // data
  instances: () => request<InstanceRow[]>("/data/instances"),
  generate: (body: GenerateRequest) => request<InstanceCreated>("/data/generate", { method: "POST", body: json(body) }),
  importInstance: (instance: Body<"/data/import", "post">) => request<InstanceCreated>("/data/import", { method: "POST", body: json(instance) }),
  deleteInstance: (id: string) => request<Ok<"/data/instances/{iid}", "delete">>(`/data/instances/${id}`, { method: "DELETE" }),
  table: (id: string, entity: Entity) => request<Table>(`/data/instances/${id}/table/${entity}`),
  patchRow: (id: string, entity: Entity, key: string, body: Body<"/data/instances/{iid}/{entity}/{key}", "patch">) =>
    request<Ok<"/data/instances/{iid}/{entity}/{key}", "patch">>(`/data/instances/${id}/${entity}/${encodeURIComponent(key)}`, { method: "PATCH", body: json(body) }),
  addColumn: (id: string, body: Body<"/data/instances/{iid}/columns", "post">) => request<Ok<"/data/instances/{iid}/columns", "post">>(`/data/instances/${id}/columns`, { method: "POST", body: json(body) }),
  addDisruption: (id: string, spec: string) => request<Ok<"/data/instances/{iid}/disruptions", "post">>(`/data/instances/${id}/disruptions`, { method: "POST", body: json({ spec }) }),
  removeDisruption: (id: string, did: string) => request<Ok<"/data/instances/{iid}/disruptions/{did}", "delete">>(`/data/instances/${id}/disruptions/${encodeURIComponent(did)}`, { method: "DELETE" }),
  // engine
  timeline: (id: string, t: number) => request<Timeline>(`/timeline?instance_id=${encodeURIComponent(id)}&t=${t}`),
  planTimeline: (body: Body<"/timeline/plan", "post">) => request<Timeline>("/timeline/plan", { method: "POST", body: json(body) }),
  recommend: (body: RecommendRequest) => request<Run>("/recommend", { method: "POST", body: json(body) }),
  whatif: (body: Body<"/whatif", "post">) => request<Run>("/whatif", { method: "POST", body: json(body) }),
  runs: (instanceId?: string) => request<RunRow[]>(`/runs${instanceId ? `?instance_id=${encodeURIComponent(instanceId)}` : ""}`),
  run: (id: string) => request<Run>(`/runs/${id}`),
  decide: (id: string, body: DecisionRequest) => request<Run>(`/runs/${id}/decision`, { method: "POST", body: json(body) }),
  committed: (id: string) => request<Committed>(`/data/instances/${id}/committed`),
  resetCommitted: (id: string) => request<Committed>(`/data/instances/${id}/committed/reset`, { method: "POST" }),
  // validation
  cases: () => request<CaseDef[]>("/cases"),
  runCases: (body: Body<"/cases/run", "post">) => request<CasesRun>("/cases/run", { method: "POST", body: json(body) }),
  latestCases: () => request<CasesRun>("/cases/latest"),
  benchmark: () => request<Benchmark>("/benchmark/latest"),
  runBenchmark: (body: Body<"/benchmark/run", "post">) => request<Benchmark>("/benchmark/run", { method: "POST", body: json(body) }),
};

export type Api = typeof api;
