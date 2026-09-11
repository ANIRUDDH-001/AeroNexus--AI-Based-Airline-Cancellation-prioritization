// Thin typed client for the AeroNexus API (Plan §19). Local dev goes through the Vite proxy (/api);
// production points at VITE_API_URL (Render or a Cloudflare Tunnel).

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "/api";

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export type Health = {
  status: string;
  engine_version: string;
  config_hash: string;
  config_version: number;
  narration_enabled: boolean;
};

export type InstanceSummary = {
  name: string;
  size: string;
  seed: number | null;
  day_start: string;
  airports: number;
  hubs: number;
  aircraft: number;
  flights: number;
  crews: number;
  standby_crews: number;
  itineraries: number;
  booked_pax: number;
  connecting_pax: number;
  disruptions: number;
};

export type InstanceRow = {
  id: string;
  name: string;
  size: string;
  seed: number | null;
  created_at: string;
  summary: InstanceSummary;
};

export type ObjectiveTerm = {
  name: string;
  level: "L1" | "L2" | "L3" | "L4";
  expression: string;
  weight: number;
  enabled: boolean;
  description: string;
};

export type ConstraintDef = {
  id: string;
  name: string;
  kind: "builtin" | "expression";
  plugin: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  severity: "hard";
  description: string;
};

export type ConfigEnvelope = {
  version: number;
  hash: string;
  updated_at: string;
  config: {
    parameters: unknown[];
    objective_terms: ObjectiveTerm[];
    constraints: ConstraintDef[];
    search: Record<string, unknown>;
    preset_name: string;
  };
};

export const api = {
  health: () => request<Health>("/health"),
  config: () => request<ConfigEnvelope>("/config"),
  putTerms: (terms: ObjectiveTerm[]) =>
    request<ConfigEnvelope>("/config/terms", { method: "PUT", body: JSON.stringify(terms) }),
  putConstraints: (constraints: ConstraintDef[]) =>
    request<ConfigEnvelope>("/config/constraints", { method: "PUT", body: JSON.stringify(constraints) }),
  instances: () => request<InstanceRow[]>("/data/instances"),
  generate: (body: { size: "small" | "medium" | "large"; seed: number; disruptions?: string[] }) =>
    request<{ id: string; summary: InstanceSummary; issues: string[] }>("/data/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteInstance: (id: string) => request<{ deleted: string }>(`/data/instances/${id}`, { method: "DELETE" }),
};
