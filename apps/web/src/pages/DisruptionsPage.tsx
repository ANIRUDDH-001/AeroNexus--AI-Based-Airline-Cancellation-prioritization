import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, ApiError, hhmm, type Timeline as TimelineData } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button, Card, Empty, PageTitle, Tag, inputCls } from "@/components/Shell";

type Kind = "fog" | "capacity" | "aog" | "crew" | "atc" | "delay" | "closure";
const KINDS: { kind: Kind; label: string; fields: { key: string; label: string; def: string }[] }[] = [
  { kind: "fog", label: "Fog / low visibility (LVP)", fields: [{ key: "airport", label: "Airport", def: "DEL" }, { key: "start", label: "Start (min)", def: "300" }, { key: "duration", label: "Duration (min)", def: "240" }, { key: "fraction", label: "Capacity ×", def: "0.4" }] },
  { kind: "capacity", label: "Airport capacity cut", fields: [{ key: "airport", label: "Airport", def: "BOM" }, { key: "start", label: "Start (min)", def: "480" }, { key: "duration", label: "Duration (min)", def: "180" }, { key: "fraction", label: "Capacity ×", def: "0.5" }] },
  { kind: "atc", label: "ATC flow restriction", fields: [{ key: "airport", label: "Airport", def: "BLR" }, { key: "start", label: "Start (min)", def: "540" }, { key: "duration", label: "Duration (min)", def: "120" }, { key: "rate", label: "Movements / h", def: "12" }] },
  { kind: "closure", label: "Airport closure", fields: [{ key: "airport", label: "Airport", def: "MAA" }, { key: "start", label: "Start (min)", def: "600" }, { key: "duration", label: "Duration (min)", def: "120" }] },
  { kind: "aog", label: "Aircraft on ground (AOG)", fields: [{ key: "tail", label: "Tail", def: "" }, { key: "at", label: "From (min)", def: "540" }, { key: "duration", label: "Duration (min, 0 = rest of day)", def: "0" }] },
  { kind: "crew", label: "Crews unavailable", fields: [{ key: "base", label: "Base", def: "DEL" }, { key: "n", label: "Crews", def: "3" }, { key: "at", label: "From (min)", def: "420" }] },
  { kind: "delay", label: "Known delay on a flight", fields: [{ key: "flight", label: "Flight id", def: "" }, { key: "minutes", label: "Minutes", def: "90" }] },
];

function toSpec(kind: Kind, v: Record<string, string>): string {
  const g = (k: string) => (v[k] ?? "").trim();
  switch (kind) {
    case "fog":
    case "capacity":
      return `${kind}:${g("airport")}:${g("start")}:${g("duration")}:${g("fraction")}`;
    case "atc":
      return `atc:${g("airport")}:${g("start")}:${g("duration")}:${g("rate")}`;
    case "closure":
      return `closure:${g("airport")}:${g("start")}:${g("duration")}`;
    case "aog":
      return `aog:${g("tail")}:${g("at")}:${g("duration")}`;
    case "crew":
      return `crew:${g("base")}:${g("n")}:${g("at")}`;
    case "delay":
      return `delay:${g("flight")}:${g("minutes")}`;
  }
}

export function DisruptionsPage({ onNavigate }: { onNavigate: (p: "recommendations") => void }) {
  const { instanceId, clock, refreshInstances } = useStore();
  const [tl, setTl] = useState<TimelineData | null>(null);
  const [kind, setKind] = useState<Kind>("fog");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => instanceId && api.timeline(instanceId, clock).then(setTl).catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, clock]);

  const def = KINDS.find((k) => k.kind === kind)!;
  const field = (k: string, d: string) => vals[k] ?? d;

  const add = async () => {
    if (!instanceId) return;
    setBusy(true);
    setError(null);
    try {
      const v: Record<string, string> = {};
      for (const f of def.fields) v[f.key] = field(f.key, f.def);
      await api.addDisruption(instanceId, toSpec(kind, v));
      await refreshInstances();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (did: string) => {
    if (!instanceId) return;
    await api.removeDisruption(instanceId, did);
    await refreshInstances();
    await load();
  };

  if (!instanceId) return <PageTitle title="Disruptions" subtitle="Load an operational day first (Data page)." />;

  return (
    <>
      <PageTitle
        title="Disruptions"
        subtitle="What is happening today. Inject events, see the propagated effect on the Overview, then ask for a recommendation."
        right={
          tl && tl.summary.at_risk > 0 ? (
            <Button onClick={() => onNavigate("recommendations")}>Run recommendation ({tl.summary.at_risk} at risk)</Button>
          ) : undefined
        }
      />

      <Card className="mb-6">
        <div className="font-medium mb-3">Add a disruption</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px] text-ink-2">
            Type
            <select className={`${inputCls} mt-1 block`} value={kind} onChange={(e) => { setKind(e.target.value as Kind); setVals({}); }}>
              {KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          {def.fields.map((f) => (
            <label key={f.key} className="text-[12px] text-ink-2">
              {f.label}
              <input className={`${inputCls} mt-1 block w-32`} value={field(f.key, f.def)} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
            </label>
          ))}
          <Button onClick={add} disabled={busy}>
            <Plus size={14} /> Add
          </Button>
        </div>
        <p className="text-[12px] text-ink-2 mt-2">Times are minutes from 00:00 (e.g. 300 = 05:00). Uncertain end times are sampled during evaluation.</p>
        {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
      </Card>

      <Card>
        <div className="font-medium mb-2">Active disruptions</div>
        {!tl || tl.disruptions.length === 0 ? (
          <Empty>None. The day runs as scheduled.</Empty>
        ) : (
          <table className="ax-table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Type</th>
                <th>Target</th>
                <th>Start</th>
                <th>Expected end</th>
                <th>Severity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tl.disruptions.map((d) => (
                <tr key={d.id}>
                  <td className="font-mono text-[12px]">{d.id}</td>
                  <td>
                    <Tag tone="warn">{d.type}</Tag>
                  </td>
                  <td className="font-medium">{d.target}</td>
                  <td className="font-mono">{hhmm(d.start)}</td>
                  <td className="font-mono">
                    {d.end_nominal == null ? "rest of day" : hhmm(d.end_nominal)}
                    {d.end_distribution && <span className="text-ink-2"> ±</span>}
                  </td>
                  <td className="text-ink-2 font-mono text-[12px]">{JSON.stringify(d.severity)}</td>
                  <td>
                    <button className="text-ink-3 hover:text-bad" onClick={() => remove(d.id)} title="Remove">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
