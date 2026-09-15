"use client";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, needsWriteKey, type InstanceRow } from "@/lib/api";
import { keys } from "@/lib/query";
import { dayDetail, dayTitle, isSynthetic } from "@/lib/day";
import { useDay } from "@/hooks/useDay";
import { useEngine } from "@/hooks/useEngine";
import { useIsPhone } from "@/hooks/useIsTouch";
import { Panel, EmptyState } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/controls";
import { Table, Th, Td, Tr } from "@/components/ui/table";
import { Dialog } from "@/components/ui/overlay";
import { Pill } from "@/components/ui/pill";

const PRESETS: { key: string; label: string; spec: string }[] = [
  { key: "fog", label: "Fog at Delhi (05:00, four hours, uncertain end)", spec: "fog:DEL:300:240:0.5" },
  { key: "aog", label: "An aircraft on ground from 08:40", spec: "aog:{tail}:520" },
  { key: "crew", label: "Three crews unavailable at Delhi from 07:00", spec: "crew:DEL:3:420" },
  { key: "atc", label: "ATC flow restriction at Mumbai (09:00, two hours)", spec: "atc:BOM:540:120:12" },
  { key: "closure", label: "Chennai closed 10:00–12:00", spec: "closure:MAA:600:120" },
];

/** Data (spec §7): which days exist; generate a synthetic day or import one in the generator's JSON format. */
export function DataPage() {
  const qc = useQueryClient();
  const { days, day, daysOrigin, setDay, refreshDays } = useDay();
  const { demo } = useEngine();
  const phone = useIsPhone();
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");
  const [seed, setSeed] = useState("1");
  const [presets, setPresets] = useState<Set<string>>(new Set(["fog", "aog"]));
  const [confirmDelete, setConfirmDelete] = useState<InstanceRow | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const generate = useMutation({
    mutationFn: () => api.generate({ size, seed: Number(seed) || 1, disruptions: PRESETS.filter((p) => presets.has(p.key)).map((p) => p.spec.replace("{tail}", "VT-IAD")) }),
    onSuccess: async (r) => {
      setIssues(r.data.issues ?? []);
      toast(`Generated ${r.data.summary.name}`);
      await qc.invalidateQueries({ queryKey: keys.instances });
      setDay(r.data.id);
    },
    onError: (e) => toast.error(needsWriteKey(e) ? "Generating needs the write key" : e instanceof Error ? e.message : "Could not generate the day"),
  });
  const importDay = useMutation({
    mutationFn: async (file: File) => api.importInstance(JSON.parse(await file.text())),
    onSuccess: async (r) => {
      setIssues(r.data.issues ?? []);
      toast(`Imported ${r.data.summary.name}`);
      await qc.invalidateQueries({ queryKey: keys.instances });
      setDay(r.data.id);
    },
    onError: (e) => {
      const detail = e instanceof Error ? e.message : String(e);
      const parsed = (() => {
        try {
          return JSON.parse(detail) as { issues?: string[] };
        } catch {
          return null;
        }
      })();
      if (parsed?.issues) setIssues(parsed.issues);
      toast.error(needsWriteKey(e) ? "Importing needs the write key" : parsed?.issues ? "The file has problems; see the list" : detail);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteInstance(id),
    onSuccess: async () => {
      toast("Day deleted");
      await qc.invalidateQueries();
      void refreshDays();
    },
    onError: (e) => toast.error(needsWriteKey(e) ? "Deleting needs the write key" : e instanceof Error ? e.message : "Could not delete"),
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Panel title="Days" aside={<span className="text-ivory-3">{days.length} day{days.length === 1 ? "" : "s"}{daysOrigin === "demo" ? ", precomputed demo" : ""}</span>} bodyClassName="p-0">
        {days.length === 0 ? (
          <EmptyState className="m-3.5 border-0">No operational day exists yet. Generate one on the right.</EmptyState>
        ) : phone ? (
          <ul className="divide-y divide-hairline">
            {days.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px] text-ivory">
                    {dayTitle(r)} {isSynthetic(r) && <Pill tone="neutral">Synthetic</Pill>}
                  </div>
                  <div className="text-[12px] text-ivory-3">{dayDetail(r)}</div>
                </div>
                <Button size="sm" variant={r.id === day?.id ? "primary" : "outline"} onClick={() => setDay(r.id)}>
                  {r.id === day?.id ? "Open" : "Open"}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>day</Th>
                <Th>size</Th>
                <Th num>seed</Th>
                <Th num>flights</Th>
                <Th num>airports</Th>
                <Th num>disruptions</Th>
                <Th>created</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {days.map((r) => (
                <Tr key={r.id} selected={r.id === day?.id} onClick={() => setDay(r.id)}>
                  <Td>
                    <span className="text-ivory">{dayTitle(r)}</span> {isSynthetic(r) && <Pill tone="neutral">Synthetic</Pill>}
                    <div className="mono text-[11px] text-ivory-3">{r.name}</div>
                  </Td>
                  <Td>{r.size}</Td>
                  <Td num mono>{r.seed ?? "—"}</Td>
                  <Td num>{String(r.summary?.flights ?? "—")}</Td>
                  <Td num>{String(r.summary?.airports ?? "—")}</Td>
                  <Td num>{String(r.summary?.disruptions ?? 0)}</Td>
                  <Td mono>{r.created_at.slice(0, 16).replace("T", " ")}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant={r.id === day?.id ? "primary" : "outline"} onClick={(e) => { e.stopPropagation(); setDay(r.id); }}>
                        {r.id === day?.id ? "Open" : "Open"}
                      </Button>
                      {!demo && (
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setConfirmDelete(r); }}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <div className="space-y-5">
        <Panel title="Generate a synthetic day">
          <div className="space-y-3">
            <Field label="Size" hint="Small is quick to explore; medium is the demo scale (about 250 flights); large is heavier.">
              <Select value={size} onChange={setSize} ariaLabel="Size" className="w-full" options={[{ value: "small", label: "Small (about 80 flights)" }, { value: "medium", label: "Medium (about 250 flights)" }, { value: "large", label: "Large (about 600 flights)" }]} />
            </Field>
            <Field label="Seed" hint="The same seed always gives the same day.">
              <Input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="Seed" />
            </Field>
            <div className="space-y-1.5">
              <div className="text-[12.5px] text-ivory-2">Disruptions to start with</div>
              {PRESETS.map((p) => (
                <Switch key={p.key} checked={presets.has(p.key)} onChange={(on) => setPresets((s) => { const n = new Set(s); if (on) n.add(p.key); else n.delete(p.key); return n; })} label={<span className="text-[12.5px]">{p.label}</span>} />
              ))}
            </div>
            <Button variant="primary" onClick={() => generate.mutate()} disabled={demo || generate.isPending} title={demo ? "Unavailable while the engine is asleep" : undefined}>
              {generate.isPending ? "Generating…" : "Generate day"}
            </Button>
            {demo && <p className="text-[12px] text-ivory-3">Unavailable while the engine is asleep; wake it to generate a day.</p>}
          </div>
        </Panel>
        <Panel title="Import a day">
          <p className="text-[12.5px] text-ivory-2">A day in the generator&apos;s JSON format (what the API returns for a day). Problems the engine finds are listed here.</p>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importDay.mutate(f); e.target.value = ""; }} />
          <Button variant="outline" className="mt-3" onClick={() => fileRef.current?.click()} disabled={demo || importDay.isPending}>
            {importDay.isPending ? "Importing…" : "Choose a JSON file"}
          </Button>
          {issues.length > 0 && (
            <ul className="mt-3 space-y-1 text-[12.5px] text-coral">
              {issues.map((i, n) => (
                <li key={n}>{i}</li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Delete this day?"
        description={confirmDelete ? `${dayTitle(confirmDelete)} (${dayDetail(confirmDelete)}) and every run made on it are removed. This cannot be undone.` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => { if (confirmDelete) remove.mutate(confirmDelete.id); setConfirmDelete(null); }}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
