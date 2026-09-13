import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError, hhmm, type Entity, type Table } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button, Card, Empty, PageTitle, Tag, inputCls } from "@/components/Shell";

const ENTITIES: { key: Entity; label: string }[] = [
  { key: "flights", label: "Flights" },
  { key: "aircraft", label: "Aircraft" },
  { key: "crews", label: "Crews" },
  { key: "airports", label: "Airports" },
  { key: "itineraries", label: "Itineraries" },
];
const TIME_COLS = new Set(["std", "sta", "etd", "eta", "duty_start", "rest_until", "maintenance_due_at"]);
const HIDE = new Set(["attributes", "curfew_windows", "lvp_windows", "closure_windows", "mel_restrictions", "legs", "pairing", "type_ratings", "special_quals", "slot_capacity_per_hour", "min_turnaround_min", "lat", "lon", "tz"]);
const EDITABLE_CORE: Record<Entity, string[]> = {
  flights: ["booked_pax", "pax_connecting", "pax_special_assistance", "pax_high_value", "pax_partner", "protected", "protection_reason"],
  aircraft: ["status", "location"],
  crews: ["is_standby", "callout_min", "fdp_limit_min"],
  airports: ["stand_capacity", "min_connection_time_min", "is_hub"],
  itineraries: ["pax_count", "category"],
};

/** Database-style tables (Plan §18.2 page 4). Inline edit on editable core fields and every attribute
 *  column; "Add column" registers a parameter so score terms and rules can use it immediately (§15.2). */
export function FlightsPage() {
  const { instanceId, refreshInstances } = useStore();
  const [entity, setEntity] = useState<Entity>("flights");
  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [colName, setColName] = useState("");
  const [colType, setColType] = useState<"number" | "bool" | "text">("number");
  const [colDefault, setColDefault] = useState("0");
  const [filter, setFilter] = useState("");

  const load = () => instanceId && api.table(instanceId, entity).then(setTable).catch((e) => setError(String(e)));
  useEffect(() => {
    setTable(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, entity]);

  const commit = async (key: string, col: string, raw: string, isAttr: boolean, current: unknown) => {
    if (!instanceId) return;
    let value: unknown = raw;
    if (typeof current === "number") value = Number(raw);
    else if (typeof current === "boolean") value = raw === "true";
    else if (raw === "") value = null;
    setError(null);
    try {
      const body = isAttr ? { attributes: { [col]: value } } : { fields: { [col]: value } };
      const r = await api.patchRow(instanceId, entity, key, body);
      setSaved(`Saved ${col} for ${key}${r.issues.length ? ` — ${r.issues.length} validation issue(s)` : ""}`);
      await load();
      await refreshInstances();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
      await load();
    }
  };

  const addColumn = async () => {
    if (!instanceId || !colName) return;
    setError(null);
    try {
      const def: unknown = colType === "number" ? Number(colDefault) : colType === "bool" ? colDefault === "true" : colDefault;
      const r = await api.addColumn(instanceId, { entity, name: colName, type: colType, default: def });
      setSaved(`Column ${colName} added to ${entity}${r.config_hash ? ` · parameter registered · config ${r.config_hash}` : ""}`);
      setColName("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    }
  };

  if (!instanceId) return <PageTitle title="Flights & resources" subtitle="Load an operational day first (Data page)." />;

  const cols = table ? table.columns.filter((c) => !HIDE.has(c)) : [];
  const rows = table ? table.rows.filter((r) => !filter || JSON.stringify(r).toLowerCase().includes(filter.toLowerCase())) : [];

  return (
    <>
      <PageTitle title="Flights & resources" subtitle="Everything the engine sees. Edit a cell to change the state; add a column to add a parameter." />
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {ENTITIES.map((e) => (
          <button key={e.key} onClick={() => setEntity(e.key)} className={`rounded-md px-3 py-1.5 text-[13px] ${entity === e.key ? "bg-hover font-medium" : "text-ink-2 hover:bg-hover"}`}>
            {e.label}
          </button>
        ))}
        <input placeholder="Filter…" className={`${inputCls} ml-auto w-56`} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-[13px] font-medium mr-2">Add column to {entity}</div>
          <label className="text-[12px] text-ink-2">
            Name
            <input className={`${inputCls} mt-1 block w-44 font-mono`} placeholder="vip_count" value={colName} onChange={(e) => setColName(e.target.value)} />
          </label>
          <label className="text-[12px] text-ink-2">
            Type
            <select className={`${inputCls} mt-1 block`} value={colType} onChange={(e) => setColType(e.target.value as typeof colType)}>
              <option value="number">number</option>
              <option value="bool">bool</option>
              <option value="text">text</option>
            </select>
          </label>
          <label className="text-[12px] text-ink-2">
            Default
            <input className={`${inputCls} mt-1 block w-24`} value={colDefault} onChange={(e) => setColDefault(e.target.value)} />
          </label>
          <Button onClick={addColumn} disabled={!/^[a-z][a-z0-9_]*$/.test(colName)}>
            <Plus size={14} /> Add column
          </Button>
          <span className="text-[12px] text-ink-2">Then reference it from a score term with sum_affected('{colName || "name"}') or from a rule as flight.attrs.{colName || "name"}.</span>
        </div>
      </Card>

      {error && <p className="mb-2 text-[13px] text-bad">{error}</p>}
      {saved && !error && <p className="mb-2 text-[12px] text-ok">{saved}</p>}

      {!table ? (
        <Empty>Loading…</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="ax-table">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
                {table.attribute_columns.map((c) => (
                  <th key={`a:${c}`} className="text-accent">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = String(r[table.key]);
                return (
                  <tr key={key}>
                    {cols.map((c) => (
                      <td key={c}>
                        <Cell value={r[c]} col={c} editable={EDITABLE_CORE[entity].includes(c)} onCommit={(v) => commit(key, c, v, false, r[c])} />
                      </td>
                    ))}
                    {table.attribute_columns.map((c) => (
                      <td key={`a:${c}`}>
                        <Cell value={r[`attr:${c}`]} col={c} editable onCommit={(v) => commit(key, c, v, true, r[`attr:${c}`])} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="text-[12px] text-ink-2 mt-2">
            {rows.length} of {table.rows.length} rows · editable cells are underlined on hover · <Tag>blue headers</Tag> are attribute columns
          </div>
        </div>
      )}
    </>
  );
}

function Cell({ value, col, editable, onCommit }: { value: unknown; col: string; editable: boolean; onCommit: (raw: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const display = value == null ? "" : TIME_COLS.has(col) && typeof value === "number" ? hhmm(value) : typeof value === "boolean" ? (value ? "yes" : "no") : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (!editable) return <span className={typeof value === "number" ? "font-mono" : ""}>{display}</span>;
  if (!editing)
    return (
      <span className="cursor-text hover:underline decoration-dotted" onClick={() => { setDraft(value == null ? "" : String(value)); setEditing(true); }}>
        {display || <span className="text-ink-3">—</span>}
      </span>
    );
  return (
    <input
      autoFocus
      className={`${inputCls} w-28 py-0`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft !== String(value ?? "")) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}
