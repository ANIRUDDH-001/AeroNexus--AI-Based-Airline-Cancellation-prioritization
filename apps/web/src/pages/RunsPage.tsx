import { useEffect, useState } from "react";
import { api, fmt, hhmm, type Run, type RunRow } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button, Card, Empty, PageTitle, Tag } from "@/components/Shell";

/** Audit log (Plan §18.2 page 7): every recommendation with its config hash, decision and outcome. */
export function RunsPage() {
  const { instanceId } = useStore();
  const [rows, setRows] = useState<RunRow[]>([]);
  const [open, setOpen] = useState<Run | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    api
      .runs(all ? undefined : (instanceId ?? undefined))
      .then(setRows)
      .catch(() => setRows([]));
  }, [instanceId, all]);

  return (
    <>
      <PageTitle
        title="Runs"
        subtitle="Every recommendation is stored with the configuration hash, a content hash of the day it saw, what the search actually used (samples, depth) and the controller's decision. A run reproduces exactly while both hashes still match the current day and configuration."
        right={
          <Button variant="ghost" onClick={() => setAll(!all)}>
            {all ? "This day only" : "All days"}
          </Button>
        }
      />
      {rows.length === 0 ? (
        <Empty>No runs yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="ax-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Decision time</th>
                <th>Top plan</th>
                <th>NIS</th>
                <th>At risk</th>
                <th>Simulated</th>
                <th>Latency</th>
                <th>Config</th>
                <th>Decision</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-ink-2">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="font-mono">{hhmm(r.decision_time)}</td>
                  <td>{r.top_plan.length ? r.top_plan.join(" + ") : <span className="text-ink-2">do nothing</span>}</td>
                  <td className="font-mono">{fmt(r.top_nis)}</td>
                  <td>{r.at_risk}</td>
                  <td>
                  {r.plans_evaluated ?? "—"}
                  {r.effective?.samples != null && <span className="text-ink-2"> · S={r.effective.samples}</span>}
                </td>
                  <td className="font-mono">{fmt(r.latency_ms)} ms</td>
                  <td className="font-mono text-[12px]">
                  {r.config_hash}
                  {r.instance_hash && <div className="text-ink-2">day {r.instance_hash}</div>}
                </td>
                  <td>
                    {r.accepted_plan == null ? (
                      <Tag tone="gray">pending</Tag>
                    ) : r.override_reason ? (
                      <Tag tone="warn">#{r.accepted_plan} override</Tag>
                    ) : (
                      <Tag tone="ok">#{r.accepted_plan} accepted</Tag>
                    )}
                  </td>
                  <td>
                    <button className="text-accent" onClick={() => api.run(r.id).then(setOpen)}>
                      open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Card className="mt-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-medium">Run {open.id}</span>
            <span className="text-[12px] text-ink-2">
              {open.instance_name} · {hhmm(open.decision_time)} · engine {open.engine_version} · config {open.config_hash}
            </span>
            <button className="ml-auto text-ink-2 text-[12px]" onClick={() => setOpen(null)}>
              close
            </button>
          </div>
          {open.override_reason && <p className="text-[13px] mb-2">Override reason: {open.override_reason}</p>}
          <div className="space-y-2">
            {open.plans.map((p) => (
              <div key={p.rank} className="text-[13px]">
                <span className="font-semibold">#{p.rank}</span> {p.explanation.actions.join(" + ") || "Do nothing"} — NIS <span className="font-mono">{fmt(p.nis)}</span>
                <ul className="text-ink-2 ml-4">
                  {p.explanation.reasons.slice(0, 3).map((x, i) => (
                    <li key={i}>• {x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <details className="mt-3 text-[12px]">
            <summary className="cursor-pointer text-ink-2">Raw record (JSON)</summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-sidebar p-3 font-mono text-[11px]">{JSON.stringify(open, null, 2)}</pre>
          </details>
        </Card>
      )}
    </>
  );
}
