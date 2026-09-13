import { useEffect, useState } from "react";
import { api, type Health } from "@/lib/api";
import { StoreProvider, useStore } from "@/lib/store";
import { PageTitle, Shell, type PageKey } from "@/components/Shell";
import { DataPage } from "@/pages/DataPage";
import { DisruptionsPage } from "@/pages/DisruptionsPage";
import { FlightsPage } from "@/pages/FlightsPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { ParametersPage } from "@/pages/ParametersPage";
import { RecommendationsPage } from "@/pages/RecommendationsPage";
import { RunsPage } from "@/pages/RunsPage";
import { CasesPage } from "@/pages/CasesPage";

function Inner() {
  const [page, setPage] = useState<PageKey>(() => ((location.hash.replace("#", "") || "overview") as PageKey));
  const [health, setHealth] = useState<Health | null | "connecting">("connecting");
  const { instance } = useStore();

  useEffect(() => {
    if (location.hash.replace("#", "") !== page) location.hash = page;
    api.health().then(setHealth).catch(() => setHealth(null));
  }, [page]);
  useEffect(() => {
    const onHash = () => setPage((location.hash.replace("#", "") || "overview") as PageKey);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const status = health === "connecting" ? (
    <span className="text-ink-2">Connecting to the engine…</span>
  ) : health ? (
    <span>
      {health.status === "static" ? <span className="text-warn">Precomputed demo (engine not reachable)</span> : "Engine online"} · v{health.engine_version} · config{" "}
      <span className="font-mono">{health.config_hash}</span> v{health.config_version}
      {health.narration?.mode === "llm" && <> · narration: {health.narration.model}</>}
      {instance && (
        <>
          <br />
          {instance.name}
        </>
      )}
    </span>
  ) : (
    <span className="text-bad">Engine not reachable and no precomputed demo bundle was found.{import.meta.env.DEV ? " Start the API: uvicorn aeronexus_api.main:app --port 8000" : ""}</span>
  );

  return (
    <Shell page={page} onNavigate={setPage} status={status}>
      {page === "overview" && <OverviewPage onNavigate={setPage} />}
      {page === "disruptions" && <DisruptionsPage onNavigate={setPage} />}
      {page === "recommendations" && <RecommendationsPage />}
      {page === "flights" && <FlightsPage />}
      {page === "parameters" && <ParametersPage />}
      {page === "cases" && <CasesPage />}
      {page === "runs" && <RunsPage />}
      {page === "data" && <DataPage />}
      {!["overview", "disruptions", "recommendations", "flights", "parameters", "cases", "runs", "data"].includes(page) && <PageTitle title="Not found" />}
    </Shell>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Inner />
    </StoreProvider>
  );
}
