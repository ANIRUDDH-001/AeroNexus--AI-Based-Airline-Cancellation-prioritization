"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, needsWriteKey, type Entity, type Table as TableData } from "@/lib/api";
import { keys } from "@/lib/query";
import { fmt, hhmm } from "@/lib/format";
import { GLOSSARY, term } from "@/lib/glossary";
import { useDay } from "@/hooks/useDay";
import { useEngine } from "@/hooks/useEngine";
import { useIsPhone } from "@/hooks/useIsTouch";
import { useTimeline } from "@/hooks/useTimeline";
import { Tabs, TabList, Tab, TabsContent, Input, Select, Segmented, Field } from "@/components/ui/controls";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { Sheet, Tooltip } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { stripState } from "@/lib/diff";
import { useNavHref } from "@/components/shell/TopBar";
import Link from "next/link";

const ENTITIES: { key: Entity; label: string }[] = [
  { key: "flights", label: "Flights" },
  { key: "aircraft", label: "Aircraft" },
  { key: "crews", label: "Crews" },
  { key: "airports", label: "Airports" },
  { key: "itineraries", label: "Itineraries" },
];

/** Plain names for the columns a person reads most; anything else is shown as the engine names it. */
const COLUMN_WORDS: Record<string, string> = {
  id: "id", number: "flight", origin: "from", dest: "to", std: "departs", sta: "arrives", tail: "aircraft", aircraft_type: "type", booked_pax: "booked", pax_connecting: "connecting",
  protected: "protected", crew_id: "crew", status: "status", base: "base", is_standby: "standby", fdp_start: "duty start", max_fdp_min: "max duty", sectors_flown: "sectors",
  code: "code", name: "name", is_hub: "hub", slot_capacity_per_hour: "slots per hour", stand_capacity: "stands", min_connection_time_min: "min connection", lat: "lat", lon: "lon", tz: "time zone",
  seats: "seats", capacity: "seats", pax: "passengers", first_flight: "first flight", second_flight: "connects to", legs: "legs", fare_class: "fare", special_assistance: "assistance", high_value: "high value", partner: "partner",
};
const HIDDEN = new Set(["curfew_windows", "lvp_windows", "closure_windows", "attributes"]);
// schedule-time fields that the live state pill already covers; they stay in the drawer
const TABLE_HIDDEN: Record<string, Set<string>> = { flights: new Set(["id", "status", "etd", "eta", "delay_min"]) };
const STATE_TONE = { on_time: "mint", delayed: "amber", at_risk: "amber", cancels_itself: "coral", cancelled_by_plan: "neutral", already_happened: "neutral" } as const;

function cell(col: string, v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if ((col === "std" || col === "sta" || col === "fdp_start" || col.endsWith("_time")) && typeof v === "number") return hhmm(v);
  if (typeof v === "number") return Number.isInteger(v) ? fmt(v) : v.toFixed(2);
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Flights & resources (spec §7): tabs per entity, a sticky-header table (cards on phones), search, filters,
 *  a drawer per row with inline editing of attributes. */
export function EntityBrowser() {
  const { dayId, clock } = useDay();
  const params = useSearchParams();
  const [entity, setEntity] = useState<Entity>((params.get("entity") as Entity) || "flights");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState<string>("all");
  const [airport, setAirport] = useState<string>("");
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [asTable, setAsTable] = useState(false);
  const phone = useIsPhone();
  const { timeline } = useTimeline();
  const table = useQuery({ queryKey: keys.table(dayId ?? "", entity), queryFn: () => api.table(dayId!, entity), enabled: !!dayId, staleTime: 5 * 60_000 });
  const flightsById = useMemo(() => new Map((timeline?.flights ?? []).map((f) => [f.id, f])), [timeline]);
  const withState = useNavHref();

  const t: TableData | null = table.data?.data ?? null;
  const columns = useMemo(() => (t ? t.columns.filter((c) => !HIDDEN.has(c) && !TABLE_HIDDEN[entity]?.has(c)).concat(t.attribute_columns) : []), [t, entity]);
  const airports = useMemo(() => (entity === "flights" && t ? [...new Set(t.rows.flatMap((r) => [String(r.origin), String(r.dest)]))].sort() : []), [t, entity]);
  const rows = useMemo(() => {
    if (!t) return [];
    const q = query.trim().toLowerCase().replace(/\s/g, "");
    return t.rows.filter((r) => {
      if (q && !Object.values(r).some((v) => String(v ?? "").toLowerCase().replace(/\s/g, "").includes(q))) return false;
      if (entity === "flights") {
        const f = flightsById.get(String(r.id));
        if (status !== "all" && (!f || stripState(f) !== status)) return false;
        if (airport && r.origin !== airport && r.dest !== airport) return false;
      }
      return true;
    });
  }, [t, query, entity, status, airport, flightsById]);

  if (!dayId) return <EmptyState>No operational day is open.</EmptyState>;
  return (
    <Tabs value={entity} onValueChange={(v) => { setEntity(v as Entity); setSelected(null); }}>
      <div className="flex flex-wrap items-end gap-3">
        <TabList className="flex-1">
          {ENTITIES.map((e) => (
            <Tab key={e.key} value={e.key}>
              {e.label}
            </Tab>
          ))}
        </TabList>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${entity}`} aria-label="Search" className="w-[220px]" />
        {entity === "flights" && (
          <>
            <Select value={status} onChange={setStatus} ariaLabel="Status" options={[{ value: "all", label: "Any state" }, ...(["at_risk", "cancels_itself", "delayed", "on_time", "cancelled_by_plan", "already_happened"] as const).map((s) => ({ value: s, label: term(`state_${s}`).label }))]} />
            <Select value={airport} onChange={setAirport} ariaLabel="Airport" placeholder="Any airport" options={[{ value: "", label: "Any airport" }, ...airports.map((a) => ({ value: a, label: a }))]} />
          </>
        )}
        <span className="ml-auto text-[12.5px] text-ivory-3">
          {rows.length} of {t?.rows.length ?? 0}
        </span>
        {phone && <Segmented value={asTable ? "table" : "cards"} onChange={(v) => setAsTable(v === "table")} ariaLabel="Layout" size="sm" options={[{ value: "cards", label: "Cards" }, { value: "table", label: "Table" }]} />}
      </div>

      {ENTITIES.map((e) => (
        <TabsContent key={e.key} value={e.key} className="mt-3 outline-none">
          {table.isPending ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : !t ? (
            <EmptyState>{table.error instanceof Error ? table.error.message : "Could not load this table."}</EmptyState>
          ) : phone && !asTable ? (
            <ul className="space-y-2">
              {rows.slice(0, 200).map((r) => {
                const f = entity === "flights" ? flightsById.get(String(r.id)) : undefined;
                return (
                  <li key={String(r[t.key])}>
                    <button type="button" onClick={() => setSelected(r)} className="w-full rounded-panel border border-hairline bg-panel px-3.5 py-3 text-left hover:bg-panel-2">
                      <div className="flex items-center gap-2">
                        <span className="mono text-[14px] font-semibold text-ivory">{cell(t.key, r[columns[1] === "number" ? "number" : t.key] ?? r[t.key])}</span>
                        {f && <Pill tone={STATE_TONE[stripState(f)]}>{term(`state_${stripState(f)}`).label}</Pill>}
                      </div>
                      <div className="mt-1 text-[12.5px] text-ivory-2">{columns.filter((c) => c !== t.key && c !== "number").slice(0, 4).map((c) => `${COLUMN_WORDS[c] ?? c} ${cell(c, r[c])}`).join(", ")}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-panel border border-hairline bg-panel">
              <Table containerClassName="max-h-[70vh]">
                <thead>
                  <tr>
                    {entity === "flights" && <Th>state</Th>}
                    {columns.map((c) => (
                      <Th key={c} num={typeof rows[0]?.[c] === "number" && c !== "std" && c !== "sta"}>
                        <Tooltip content={(GLOSSARY as Record<string, { short: string }>)[c]?.short ?? `The ${COLUMN_WORDS[c] ?? c.replace(/_/g, " ")} column as the engine holds it.`}>
                          <span>{COLUMN_WORDS[c] ?? c.replace(/_/g, " ")}</span>
                        </Tooltip>
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 500).map((r) => {
                    const f = entity === "flights" ? flightsById.get(String(r.id)) : undefined;
                    return (
                      <Tr key={String(r[t.key])} onClick={() => setSelected(r)} selected={selected?.[t.key] === r[t.key]}>
                        {entity === "flights" && <Td>{f ? <Pill tone={STATE_TONE[stripState(f)]}>{term(`state_${stripState(f)}`).label}</Pill> : <span className="text-ivory-3">—</span>}</Td>}
                        {columns.map((c) => (
                          <Td key={c} num={typeof r[c] === "number" && c !== "std" && c !== "sta"} mono={c === t.key || c === "number" || c === "tail" || c === "std" || c === "sta" || c === "crew_id"}>
                            {cell(c, r[c])}
                          </Td>
                        ))}
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
              {rows.length > 500 && <p className="px-3 py-2 text-[12px] text-ivory-3">Showing the first 500; narrow the search to see the rest.</p>}
            </div>
          )}
        </TabsContent>
      ))}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title={selected ? `${ENTITIES.find((e) => e.key === entity)?.label.replace(/s$/, "")} ${cell(t?.key ?? "id", selected[t?.key ?? "id"])}` : ""} width={480}>
        {selected && t && <EntityDrawer entity={entity} table={t} row={selected} dayId={dayId} clock={clock} boardHref={withState("/")} flightState={entity === "flights" ? flightsById.get(String(selected.id)) : undefined} onClose={() => setSelected(null)} />}
      </Sheet>
      {!phone && rows.length === 0 && t && <p className="mt-3 text-[13px] text-ivory-2">Nothing matches.</p>}
      {!phone && t && (
        <p className="mt-3 text-[12px] text-ivory-3">
          Click a row for the full record. <Link href={withState("/")}>Back to operations</Link>
        </p>
      )}
    </Tabs>
  );
}

function EntityDrawer({ entity, table, row, dayId, clock, boardHref, flightState, onClose }: { entity: Entity; table: TableData; row: Record<string, unknown>; dayId: string; clock: number; boardHref: string; flightState?: ReturnType<typeof Object> | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const { demo, health } = useEngine();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const editable = table.attribute_columns.concat(entity === "flights" ? ["protected", "booked_pax"] : entity === "aircraft" ? ["status"] : []);
  const save = useMutation({
    mutationFn: async () => {
      const fields: Record<string, unknown> = {};
      const attributes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft)) {
        const parsed = v === "true" ? true : v === "false" ? false : v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
        if (table.attribute_columns.includes(k)) attributes[k] = parsed;
        else fields[k] = parsed;
      }
      return api.patchRow(dayId, entity, String(row[table.key]), { fields: Object.keys(fields).length ? fields : undefined, attributes: Object.keys(attributes).length ? attributes : undefined });
    },
    onSuccess: async () => {
      toast("Saved; the day is re-propagated");
      setDraft({});
      await qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error(needsWriteKey(e) ? "Editing needs the write key" : e instanceof Error ? e.message : "Could not save"),
  });
  const blocked = demo ? "Unavailable while the engine is asleep" : health?.write_key_required && !process.env.NEXT_PUBLIC_API_KEY ? "Editing needs the write key (set NEXT_PUBLIC_API_KEY)" : null;
  const fs = flightState as { status?: string; delay_min?: number; reason?: string | null; risk_reasons?: string[] } | undefined;
  return (
    <div className="space-y-4 text-[13px]">
      {fs && (
        <div className="rounded-panel border border-hairline bg-well p-3">
          <div className="text-[12px] text-ivory-3">At {hhmm(clock)} if nobody acts</div>
          <div className="mt-0.5 text-ivory">
            {term(`state_${stripState(fs as never)}`).label}
            {fs.delay_min ? `, ${fs.delay_min} min late` : ""}
            {fs.reason ? `: ${fs.reason}` : ""}
          </div>
          {fs.risk_reasons && fs.risk_reasons.length > 0 && <div className="mt-1 text-amber">{fs.risk_reasons.join("; ")}</div>}
          <Link href={boardHref} className="mt-2 inline-block text-[12.5px]">
            Show on the board
          </Link>
        </div>
      )}
      <dl className="grid grid-cols-[minmax(120px,auto)_1fr] gap-x-3 gap-y-1.5">
        {Object.entries(row)
          .filter(([k]) => !HIDDEN.has(k))
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ivory-3">{COLUMN_WORDS[k] ?? k.replace(/_/g, " ")}</dt>
              <dd className={typeof v === "number" || k === "id" || k === "tail" ? "mono text-ivory" : "text-ivory"}>
                {editable.includes(k) ? (
                  <Input value={draft[k] ?? cell(k, v).replace("—", "")} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} disabled={!!blocked} title={blocked ?? undefined} className="h-7" aria-label={k} />
                ) : (
                  cell(k, v)
                )}
              </dd>
            </div>
          ))}
      </dl>
      {editable.length > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" disabled={!!blocked || !Object.keys(draft).length || save.isPending} onClick={() => save.mutate()}>
            Save changes
          </Button>
          {blocked && <span className="text-[12px] text-ivory-3">{blocked}</span>}
          {!blocked && <span className="text-[12px] text-ivory-3">Editable: {editable.map((c) => COLUMN_WORDS[c] ?? c).join(", ")}. Saving re-propagates the day and changes its fingerprint.</span>}
        </div>
      )}
      <Field label="Add a column to every row of this table" hint="A number, yes/no or text attribute the objective terms can use; needs the engine online.">
        <AddColumn entity={entity} dayId={dayId} blocked={blocked} />
      </Field>
    </div>
  );
}

function AddColumn({ entity, dayId, blocked }: { entity: Entity; dayId: string; blocked: string | null }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<"number" | "bool" | "text">("number");
  const [def, setDef] = useState("0");
  const add = useMutation({
    mutationFn: () => api.addColumn(dayId, { entity, name: name.trim(), type, default: type === "number" ? Number(def) : type === "bool" ? def === "true" : def, description: "" }),
    onSuccess: async () => {
      toast(`Column ${name.trim()} added`);
      setName("");
      await qc.invalidateQueries();
    },
    onError: (e) => toast.error(needsWriteKey(e) ? "Editing needs the write key" : e instanceof Error ? e.message : "Could not add the column"),
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="column_name" aria-label="Column name" className="w-[150px]" disabled={!!blocked} />
      <Select value={type} onChange={setType} ariaLabel="Type" options={[{ value: "number", label: "number" }, { value: "bool", label: "yes/no" }, { value: "text", label: "text" }]} />
      <Input value={def} onChange={(e) => setDef(e.target.value)} placeholder="default" aria-label="Default" className="w-[90px]" disabled={!!blocked} />
      <Button size="sm" variant="outline" disabled={!!blocked || !/^[a-z][a-z0-9_]*$/.test(name.trim()) || add.isPending} onClick={() => add.mutate()}>
        Add column
      </Button>
    </div>
  );
}
