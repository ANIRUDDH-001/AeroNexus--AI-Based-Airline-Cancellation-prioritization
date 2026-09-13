import { useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { api, ApiError, type InstanceRow } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button, PageTitle, Tag } from "@/components/Shell";

export function DataPage() {
  const { refreshInstances, setInstanceId } = useStore();
  const [rows, setRows] = useState<InstanceRow[]>([]);
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");
  const [seed, setSeed] = useState(1);
  const [disruptions, setDisruptions] = useState("fog:DEL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const load = () => api.instances().then(setRows).catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, []);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const specs = disruptions.split(",").map((s) => s.trim()).filter(Boolean);
      const r = await api.generate({ size, seed, disruptions: specs });
      setIssues(r.issues);
      await load();
      await refreshInstances();
      setInstanceId(r.id);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle title="Data" subtitle="Generate a synthetic IndiGo-like day, or import one. Every instance is seeded and reproducible." />

      <section className="rounded-md border border-border p-4 mb-8">
        <div className="grid grid-cols-[120px_100px_1fr_auto] gap-3 items-end">
          <label className="text-[12px] text-ink-2">
            Size
            <select
              className="mt-1 block w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px]"
              value={size}
              onChange={(e) => setSize(e.target.value as typeof size)}
            >
              <option value="small">small</option>
              <option value="medium">medium</option>
              <option value="large">large</option>
            </select>
          </label>
          <label className="text-[12px] text-ink-2">
            Seed
            <input
              type="number"
              className="mt-1 block w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px]"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
          </label>
          <label className="text-[12px] text-ink-2">
            Disruptions (comma-separated specs: fog:DEL, aog:VT-IAB:600, crew:DEL:3:420, capacity:BOM:480:180:0.5)
            <input
              className="mt-1 block w-full rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] font-mono"
              value={disruptions}
              onChange={(e) => setDisruptions(e.target.value)}
            />
          </label>
          <Button onClick={generate} disabled={busy}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Generate
          </Button>
        </div>
        {error && <p className="mt-3 text-[13px] text-bad">{error}</p>}
        {issues.length > 0 && (
          <div className="mt-3 text-[13px] text-warn">
            Validation issues: {issues.slice(0, 5).join("; ")}
            {issues.length > 5 ? " …" : ""}
          </div>
        )}
      </section>

      <table className="ax-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Seed</th>
            <th>Flights</th>
            <th>Aircraft</th>
            <th>Crews</th>
            <th>Pax</th>
            <th>Disruptions</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="text-ink-2">
                No instances yet. Generate one above.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-medium">{r.name}</td>
              <td>
                <Tag tone="gray">{r.size}</Tag>
              </td>
              <td>{r.seed ?? "—"}</td>
              <td>{r.summary.flights}</td>
              <td>{r.summary.aircraft}</td>
              <td>
                {r.summary.crews} <span className="text-ink-2">({r.summary.standby_crews} standby)</span>
              </td>
              <td>{r.summary.booked_pax.toLocaleString()}</td>
              <td>{r.summary.disruptions > 0 ? <Tag tone="warn">{r.summary.disruptions}</Tag> : <span className="text-ink-2">none</span>}</td>
              <td className="text-ink-2">{new Date(r.created_at).toLocaleString()}</td>
              <td>
                <button
                  className="text-ink-3 hover:text-bad"
                  title="Delete"
                  onClick={() => api.deleteInstance(r.id).then(load).then(refreshInstances)}
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
