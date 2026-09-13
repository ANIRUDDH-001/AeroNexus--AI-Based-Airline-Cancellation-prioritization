import { useEffect, useState } from "react";
import { api, pingLive, type Health } from "@/lib/api";
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
  const [page, setPage] = useState<PageKey>(() => (location.hash.replace("#", "") || "overview") as PageKey);
  const [health, setHealth] = useState<Health | null | "connecting">("connecting");
  const [waking, setWaking] = useState<null | { since: number; tries: number }>(null);
  const { instance } = useStore();

  useEffect(() => {
    if (location.hash.replace("#", "") !== page) location.hash = page;
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [page]);

  // The hosted engine (Render free tier) sleeps after 15 idle minutes and takes up to a minute to wake.
  // While the UI is on the precomputed bundle, probe the live engine and switch back as soon as it answers.
  const asleep = health !== "connecting" && (health === null || health.status === "static");
  useEffect(() => {
    if (!asleep) return;
    let stop = false;
    const tick = async () => {
      const h = await pingLive();
      if (stop) return;
      if (h) {
        setWaking(null);
        location.reload();
        return;
      }
      setWaking((w) => ({ since: w?.since ?? Date.now(), tries: (w?.tries ?? 0) + 1 }));
    };
    const id = setInterval(tick, 15000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [asleep]);

  const wake = async () => {
    setWaking({ since: Date.now(), tries: 0 });
    for (let i = 0; i < 12; i++) {
      const h = await pingLive();
      if (h) {
        location.reload();
        return;
      }
      setWaking({ since: Date.now(), tries: i + 1 });
      await new Promise((r) => setTimeout(r, 8000));
    }
  };
  useEffect(() => {
    const onHash = () => setPage((location.hash.replace("#", "") || "overview") as PageKey);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const dot = (cls: string) => <span className={`inline-block h-2 w-2 rounded-full mr-1.5 align-middle ${cls}`} />;
  const wakeControls = (
    <span className="block mt-1">
      {waking ? (
        <span className="text-ink-2">
          {dot("bg-warn animate-pulse")}Waking the engine… {Math.round((Date.now() - waking.since) / 1000)} s (a cold start takes up to a minute)
        </span>
      ) : (
        <button
          className="rounded border border-border px-2 py-0.5 text-[11px] text-ink hover:bg-hover"
          onClick={wake}
          title="The hosted engine sleeps after 15 idle minutes; this pings it until it answers, then reloads"
        >
          Wake engine
        </button>
      )}
    </span>
  );
  const status =
    health === "connecting" ? (
      <span className="text-ink-2">{dot("bg-ink-2 animate-pulse")}Connecting to the engine…</span>
    ) : health ? (
      <span>
        {health.status === "static" ? <span className="text-warn">{dot("bg-warn")}Precomputed demo — engine asleep or unreachable</span> : <span>{dot("bg-ok")}Engine online</span>} · v
        {health.engine_version} · config <span className="font-mono">{health.config_hash}</span> v{health.config_version}
        {health.narration?.mode === "llm" && <> · narration: {health.narration.model}</>}
        {health.status === "static" && wakeControls}
        {instance && (
          <>
            <br />
            {instance.name}
          </>
        )}
      </span>
    ) : (
      <span className="text-bad">
        {dot("bg-bad")}Engine not reachable and no precomputed demo bundle was found.{import.meta.env.DEV ? " Start the API: uvicorn aeronexus_api.main:app --port 8000" : ""}
        {wakeControls}
      </span>
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
