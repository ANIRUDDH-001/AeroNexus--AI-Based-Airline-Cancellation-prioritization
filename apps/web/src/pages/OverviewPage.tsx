import { useEffect, useState } from "react";
import { api, fmt, staticMode, type Timeline as TimelineData } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Card, Empty, Kpi, PageTitle, Tag } from "@/components/Shell";
import { Timeline } from "@/components/Timeline";

export function OverviewPage({ onNavigate }: { onNavigate: (p: "recommendations" | "data") => void }) {
  const { instanceId, clock } = useStore();
  const [tl, setTl] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!instanceId) return;
    setError(null);
    let active = true; // ignore late answers for a day that is no longer selected (stale-id race on load)
    api
      .timeline(instanceId, clock)
      .then((t) => active && setTl(t))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [instanceId, clock]);

  if (!instanceId)
    return (
      <>
        <PageTitle title="Overview" />
        <Empty>
          No operational day loaded.{" "}
          <button className="text-accent underline" onClick={() => onNavigate("data")}>
            Generate one on the Data page.
          </button>
        </Empty>
      </>
    );
  if (error) return <PageTitle title="Overview" subtitle={error} />;
  if (!tl) return <PageTitle title="Overview" subtitle="Loading…" />;
  const s = tl.summary;

  return (
    <>
      <PageTitle title="Overview" subtitle={`Today's operation if nothing is done, propagated from ${tl.clock_hhmm}.`} />
      <div className="grid grid-cols-6 gap-3 mb-6">
        <Kpi label="Flights" value={s.flights} />
        <Kpi label="At risk" value={s.at_risk} tone={s.at_risk ? "warn" : undefined} />
        <Kpi label="Forced cancellations" value={s.forced_cancellations} tone={s.forced_cancellations ? "bad" : "ok"} />
        <Kpi label="Delayed flights" value={s.delayed_flights} tone={s.delayed_flights ? "warn" : undefined} />
        <Kpi label="Missed connections" value={fmt(s.misconnects)} tone={s.misconnects ? "warn" : undefined} />
        <Kpi label="Stranded overnight" value={fmt(s.stranded_overnight)} tone={s.stranded_overnight ? "bad" : "ok"} />
      </div>

      {staticMode.active && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[13px]">
          You are looking at a precomputed demo: the engine is asleep or unreachable. Use <em>Wake engine</em> in the sidebar; live recommendations, edits and what-ifs resume once it answers.
        </div>
      )}
      {tl.committed && tl.committed.count > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 items-center text-[13px]">
          <span className="text-ink-2">Committed today:</span>
          {tl.committed.labels.map((l) => (
            <Tag key={l} tone="blue">
              {l}
            </Tag>
          ))}
          <button
            className="ml-auto text-ink-2 underline"
            onClick={() =>
              instanceId &&
              api
                .resetCommitted(instanceId)
                .then(() => api.timeline(instanceId, clock).then(setTl))
                .catch(() => undefined)
            }
            title="Undo all accepted plans for this day (runs keep their record)"
          >
            reset
          </button>
        </div>
      )}
      {tl.disruptions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2 items-center text-[13px]">
          <span className="text-ink-2">Active disruptions:</span>
          {tl.disruptions.map((d) => (
            <Tag key={d.id} tone="warn" title={JSON.stringify(d.severity)}>
              {d.type} · {d.target}
            </Tag>
          ))}
          {s.at_risk > 0 && (
            <button className="ml-auto text-accent underline" onClick={() => onNavigate("recommendations")}>
              Get recommendation →
            </button>
          )}
        </div>
      )}

      <Card className="mb-6">
        <div className="font-medium mb-2">Rotations</div>
        <Timeline flights={tl.flights} rotations={tl.rotations} clock={tl.clock} />
      </Card>

      <Card>
        <div className="font-medium mb-2">At-risk flights</div>
        {tl.at_risk.length === 0 ? (
          <Empty>Nothing at risk at this decision time.</Empty>
        ) : (
          <table className="ax-table">
            <thead>
              <tr>
                <th>Flight</th>
                <th>Route</th>
                <th>STD</th>
                <th>Tail</th>
                <th>Pax</th>
                <th>Status</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {tl.at_risk.map((r) => {
                const f = tl.flights.find((x) => x.id === r.flight)!;
                return (
                  <tr key={r.flight}>
                    <td className="font-medium">{f.number}</td>
                    <td>
                      {f.origin}→{f.dest}
                    </td>
                    <td className="font-mono">{f.std_hhmm}</td>
                    <td className="font-mono">{f.tail}</td>
                    <td>{f.booked_pax}</td>
                    <td>{r.forced ? <Tag tone="bad">cannot operate</Tag> : <Tag tone="warn">+{r.delay_min} min</Tag>}</td>
                    <td className="text-ink-2">{r.reasons.join("; ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
