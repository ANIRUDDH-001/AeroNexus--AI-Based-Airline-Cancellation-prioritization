import { useEffect, useState } from "react";
import { api, type Health } from "@/lib/api";
import { PageTitle, Shell, Tag, type PageKey } from "@/components/Shell";
import { DataPage } from "@/pages/DataPage";
import { ParametersPage } from "@/pages/ParametersPage";

function Overview({ health }: { health: Health | null }) {
  return (
    <>
      <PageTitle title="Overview" subtitle="Today's operation at a glance. Rotation timeline and at-risk flights arrive with Phase 1–4." />
      <div className="grid grid-cols-4 gap-3">
        {[
          ["Engine", health ? `v${health.engine_version}` : "—"],
          ["Config", health ? health.config_hash : "—"],
          ["Config version", health ? `v${health.config_version}` : "—"],
          ["Status", health ? health.status : "offline"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md border border-border p-4">
            <div className="text-[12px] text-ink-2">{k}</div>
            <div className="text-[18px] font-semibold mt-1 font-mono">{v}</div>
          </div>
        ))}
      </div>
      <section className="mt-8 rounded-md border border-border p-4">
        <div className="font-medium mb-1">Phase 0 status</div>
        <p className="text-ink-2 text-[13px]">
          Schema, configuration registries with a versioned config hash, the synthetic-day generator and the API are in
          place. Use <Tag>Data</Tag> to generate an instance and <Tag>Parameters</Tag> to edit weights and watch the config
          hash change.
        </p>
      </section>
    </>
  );
}

function Placeholder({ title }: { title: string }) {
  return <PageTitle title={title} subtitle="Arrives in a later phase (see docs/AeroNexus_Implementation_Plan.md §22)." />;
}

export default function App() {
  const [page, setPage] = useState<PageKey>("overview");
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, [page]);

  const status = health ? (
    <span>
      API online · <span className="font-mono">{health.config_hash}</span>
    </span>
  ) : (
    <span className="text-bad">API offline — start uvicorn on :8000</span>
  );

  return (
    <Shell page={page} onNavigate={setPage} status={status}>
      {page === "overview" && <Overview health={health} />}
      {page === "data" && <DataPage />}
      {page === "parameters" && <ParametersPage />}
      {page === "disruptions" && <Placeholder title="Disruptions" />}
      {page === "recommendations" && <Placeholder title="Recommendations" />}
      {page === "flights" && <Placeholder title="Flights & resources" />}
      {page === "cases" && <Placeholder title="Cases & benchmarks" />}
      {page === "runs" && <Placeholder title="Runs" />}
    </Shell>
  );
}
