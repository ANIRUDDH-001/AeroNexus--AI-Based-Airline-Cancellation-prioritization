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
  const [health, setHealth] = useState<Health | null>(null);
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

  const status = health ? (
    <span>
      {health.status === "static" ? <span className="text-warn">Static demo mode (API unreachable)</span> : "API online"} · engine v{health.engine_version} · config{" "}
      <span className="font-mono">{health.config_hash}</span> v{health.config_version}
      {instance && (
        <>
          <br />
          {instance.name}
        </>
      )}
    </span>
  ) : (
    <span className="text-bad">API offline — start uvicorn on :8000 (no static bundle found)</span>
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
