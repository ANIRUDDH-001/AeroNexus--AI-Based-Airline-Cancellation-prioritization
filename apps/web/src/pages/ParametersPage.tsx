import { useEffect, useState } from "react";
import { Check, Plus, Save, Trash2 } from "lucide-react";
import { api, ApiError, type ConfigEnvelope, type ConstraintDef, type ObjectiveTerm, type SearchSettings } from "@/lib/api";
import { Button, Card, PageTitle, Tag, inputCls } from "@/components/Shell";

const LEVEL_LABEL: Record<ObjectiveTerm["level"], string> = { L1: "Network continuity", L2: "Passenger harm", L3: "Cost", L4: "Robustness" };
type Tab = "terms" | "constraints" | "search" | "presets";
const SEARCH_FIELDS: { key: keyof SearchSettings & string; label: string; help: string }[] = [
  { key: "K", label: "Beam width K", help: "partial plans kept per depth" },
  { key: "D", label: "Depth D", help: "max actions per plan" },
  { key: "M", label: "Candidates M", help: "candidates simulated per node (pre-ranked)" },
  { key: "N", label: "Finalists N", help: "plans re-evaluated under scenarios" },
  { key: "S", label: "Scenarios S", help: "sampled futures per finalist" },
  { key: "latency_budget_ms", label: "Latency budget (ms)", help: "engine reduces S, then depth, to stay inside" },
  { key: "hysteresis_pct", label: "Hysteresis %", help: "top plan only changes if better by more than this" },
  { key: "at_risk_delay_threshold_min", label: "At-risk delay threshold (min)", help: "" },
  { key: "max_delay_min", label: "Max DELAY action (min)", help: "" },
  { key: "forced_cancel_delay_min", label: "Forced-cancel delay (min)", help: "propagation: a leg that cannot depart within this is cancelled" },
  { key: "top_n_returned", label: "Plans returned", help: "" },
];

export function ParametersPage() {
  const [env, setEnv] = useState<ConfigEnvelope | null>(null);
  const [tab, setTab] = useState<Tab>("terms");
  const [terms, setTerms] = useState<ObjectiveTerm[]>([]);
  const [cons, setCons] = useState<ConstraintDef[]>([]);
  const [search, setSearch] = useState<SearchSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<string[]>([]);
  const [presets, setPresets] = useState<{ name: string; version: number; hash: string }[]>([]);
  const [presetName, setPresetName] = useState("");
  const [newTerm, setNewTerm] = useState<ObjectiveTerm>({ name: "", level: "L2", expression: "", weight: 1, enabled: true, description: "" });
  const [newRule, setNewRule] = useState({ id: "", name: "", forbid_if: "", applies_to: "CANCEL_LEG,CANCEL_CYCLE" });

  const apply = (e: ConfigEnvelope) => {
    setEnv(e);
    setTerms(e.config.objective_terms);
    setCons(e.config.constraints);
    setSearch(e.config.search);
    setDirty(false);
  };
  useEffect(() => {
    api.config().then(apply).catch((e) => setError(String(e)));
    api.metrics().then((m) => setMetrics(m.metrics)).catch(() => undefined);
    api.presets().then(setPresets).catch(() => undefined);
  }, []);

  const touch = () => {
    setDirty(true);
    setSaved(null);
  };
  const save = async () => {
    if (!env || !search) return;
    setSaving(true);
    setError(null);
    try {
      let e = env;
      if (tab === "terms") e = await api.putTerms(terms);
      else if (tab === "constraints") e = await api.putConstraints(cons);
      else if (tab === "search") e = await api.putSearch(search);
      apply(e);
      setSaved(`Saved · config v${e.version} · ${e.hash}`);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!env || !search) return <PageTitle title="Parameters" subtitle={error ?? "Loading…"} />;

  return (
    <>
      <PageTitle
        title="Parameters"
        subtitle="Everything that can change a recommendation lives here and is versioned. Weights are placeholders (1 point ≈ ₹1,000) until tuned on the hand-crafted cases."
        right={
          <div className="flex items-center gap-3 text-[12px] text-ink-2">
            <span>
              config <span className="font-mono">{env.hash}</span> · v{env.version}
            </span>
            {saved && (
              <span className="text-ok inline-flex items-center gap-1">
                <Check size={13} /> {saved}
              </span>
            )}
            {tab !== "presets" && (
              <Button onClick={save} disabled={!dirty || saving}>
                <Save size={14} /> Save
              </Button>
            )}
          </div>
        }
      />
      {error && <p className="mb-3 text-[13px] text-bad">{error}</p>}
      <div className="flex gap-1 mb-4 border-b border-border">
        {(["terms", "constraints", "search", "presets"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-[13px] -mb-px border-b-2 ${tab === t ? "border-ink font-medium" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t === "terms" ? "Objective terms" : t === "constraints" ? "Hard constraints" : t === "search" ? "Search settings" : "Presets"}
          </button>
        ))}
      </div>

      {tab === "terms" && (
        <>
          <table className="ax-table">
            <thead>
              <tr>
                <th>On</th>
                <th>Term</th>
                <th>Level</th>
                <th>Expression</th>
                <th>Weight</th>
                <th>Description</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {terms.map((t, i) => (
                <tr key={t.name}>
                  <td>
                    <input type="checkbox" checked={t.enabled} onChange={(e) => { setTerms(terms.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x))); touch(); }} />
                  </td>
                  <td className="font-medium">{t.name}</td>
                  <td>
                    <select className={inputCls} value={t.level} onChange={(e) => { setTerms(terms.map((x, j) => (j === i ? { ...x, level: e.target.value as ObjectiveTerm["level"] } : x))); touch(); }}>
                      {(["L1", "L2", "L3", "L4"] as const).map((l) => (
                        <option key={l} value={l}>
                          {l} {LEVEL_LABEL[l]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className={`${inputCls} w-72 font-mono text-[12px]`} value={t.expression} onChange={(e) => { setTerms(terms.map((x, j) => (j === i ? { ...x, expression: e.target.value } : x))); touch(); }} />
                  </td>
                  <td>
                    <input type="number" step="any" className={`${inputCls} w-24`} value={t.weight} onChange={(e) => { setTerms(terms.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x))); touch(); }} />
                  </td>
                  <td className="text-ink-2">{t.description}</td>
                  <td>
                    <button className="text-ink-3 hover:text-bad" onClick={() => { setTerms(terms.filter((_, j) => j !== i)); touch(); }} title="Remove term">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Card className="mt-4">
            <div className="font-medium mb-2">Add a term</div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[12px] text-ink-2">
                Name
                <input className={`${inputCls} mt-1 block w-40 font-mono`} value={newTerm.name} onChange={(e) => setNewTerm({ ...newTerm, name: e.target.value })} placeholder="vip_impact" />
              </label>
              <label className="text-[12px] text-ink-2">
                Level
                <select className={`${inputCls} mt-1 block`} value={newTerm.level} onChange={(e) => setNewTerm({ ...newTerm, level: e.target.value as ObjectiveTerm["level"] })}>
                  {(["L1", "L2", "L3", "L4"] as const).map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="text-[12px] text-ink-2">
                Expression
                <input className={`${inputCls} mt-1 block w-80 font-mono`} value={newTerm.expression} onChange={(e) => setNewTerm({ ...newTerm, expression: e.target.value })} placeholder="sum_affected('vip_count') * 300" />
              </label>
              <label className="text-[12px] text-ink-2">
                Weight
                <input type="number" step="any" className={`${inputCls} mt-1 block w-24`} value={newTerm.weight} onChange={(e) => setNewTerm({ ...newTerm, weight: Number(e.target.value) })} />
              </label>
              <Button
                variant="ghost"
                disabled={!/^[a-z][a-z0-9_]*$/.test(newTerm.name) || !newTerm.expression}
                onClick={async () => {
                  const v = await api.validateTerms([newTerm]);
                  if (!v.ok) {
                    setError(`Expression rejected: ${JSON.stringify(v.problems)}`);
                    return;
                  }
                  setError(null);
                  setTerms([...terms, newTerm]);
                  setNewTerm({ ...newTerm, name: "", expression: "" });
                  touch();
                }}
              >
                <Plus size={14} /> Add
              </Button>
            </div>
            <p className="text-[12px] text-ink-2 mt-2">
              Available names: {metrics.join(", ")}; global parameters; helpers sum_affected('col'), max_affected('col'), count_affected(), min, max, abs, round, clamp. Expressions are validated before they are saved.
            </p>
          </Card>
        </>
      )}

      {tab === "constraints" && (
        <>
          <table className="ax-table">
            <thead>
              <tr>
                <th>On</th>
                <th>ID</th>
                <th>Constraint</th>
                <th>Kind</th>
                <th>Configuration (JSON, editable)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cons.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    <input type="checkbox" checked={c.enabled} onChange={(e) => { setCons(cons.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x))); touch(); }} />
                  </td>
                  <td className="font-mono text-[12px]">{c.id}</td>
                  <td>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-ink-2 text-[12px]">{c.description}</div>
                  </td>
                  <td className="text-ink-2">{c.kind === "builtin" ? c.plugin : "user rule"}</td>
                  <td>
                    <ConfigEditor value={c.config} onChange={(v) => { setCons(cons.map((x, j) => (j === i ? { ...x, config: v } : x))); touch(); }} />
                  </td>
                  <td>
                    {c.kind === "expression" && (
                      <button className="text-ink-3 hover:text-bad" onClick={() => { setCons(cons.filter((_, j) => j !== i)); touch(); }} title="Remove rule">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Card className="mt-4">
            <div className="font-medium mb-2">Add a user rule (hard constraint)</div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[12px] text-ink-2">
                ID
                <input className={`${inputCls} mt-1 block w-32 font-mono`} value={newRule.id} onChange={(e) => setNewRule({ ...newRule, id: e.target.value })} placeholder="H10_vip" />
              </label>
              <label className="text-[12px] text-ink-2">
                Name
                <input className={`${inputCls} mt-1 block w-56`} value={newRule.name} onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} placeholder="Never cancel with > 50 VIPs" />
              </label>
              <label className="text-[12px] text-ink-2">
                Forbid if
                <input className={`${inputCls} mt-1 block w-80 font-mono`} value={newRule.forbid_if} onChange={(e) => setNewRule({ ...newRule, forbid_if: e.target.value })} placeholder="flight.attrs.get('vip_count', 0) > 50" />
              </label>
              <label className="text-[12px] text-ink-2">
                Applies to
                <input className={`${inputCls} mt-1 block w-56 font-mono`} value={newRule.applies_to} onChange={(e) => setNewRule({ ...newRule, applies_to: e.target.value })} />
              </label>
              <Button
                variant="ghost"
                disabled={!/^[A-Za-z][A-Za-z0-9_]*$/.test(newRule.id) || !newRule.forbid_if}
                onClick={() => {
                  setCons([...cons, { id: newRule.id, name: newRule.name || newRule.id, kind: "expression", plugin: null, enabled: true, severity: "hard", description: "user rule",
                    config: { applies_to: newRule.applies_to.split(",").map((s) => s.trim()).filter(Boolean), forbid_if: newRule.forbid_if } }]);
                  setNewRule({ id: "", name: "", forbid_if: "", applies_to: "CANCEL_LEG,CANCEL_CYCLE" });
                  touch();
                }}
              >
                <Plus size={14} /> Add rule
              </Button>
            </div>
          </Card>
        </>
      )}

      {tab === "search" && (
        <Card>
          <div className="grid grid-cols-3 gap-4">
            {SEARCH_FIELDS.map((f) => (
              <label key={f.key} className="text-[12px] text-ink-2">
                {f.label}
                <input type="number" step="any" className={`${inputCls} mt-1 block w-full`} value={Number(search[f.key])} onChange={(e) => { setSearch({ ...search, [f.key]: Number(e.target.value) }); touch(); }} />
                {f.help && <span className="block text-ink-3 mt-0.5">{f.help}</span>}
              </label>
            ))}
            <label className="text-[12px] text-ink-2">
              Ranking mode
              <select className={`${inputCls} mt-1 block w-full`} value={search.ranking_mode} onChange={(e) => { setSearch({ ...search, ranking_mode: e.target.value as SearchSettings["ranking_mode"] }); touch(); }}>
                <option value="composite">composite (weighted sum — student brief)</option>
                <option value="priority">priority (lexicographic with tolerances)</option>
              </select>
            </label>
          </div>
        </Card>
      )}

      {tab === "presets" && (
        <Card>
          <div className="flex items-end gap-3 mb-4">
            <label className="text-[12px] text-ink-2">
              Save current configuration as
              <input className={`${inputCls} mt-1 block w-56`} value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="fog-season" />
            </label>
            <Button variant="ghost" disabled={!presetName} onClick={async () => { await api.savePreset(presetName); setPresets(await api.presets()); setPresetName(""); }}>
              Save preset
            </Button>
            <Button variant="ghost" onClick={async () => { apply(await api.resetConfig()); setSaved("Reloaded from YAML"); }}>
              Reset from YAML
            </Button>
          </div>
          <table className="ax-table">
            <thead>
              <tr>
                <th>Preset</th>
                <th>Version</th>
                <th>Hash</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {presets.map((p) => (
                <tr key={p.name}>
                  <td className="font-medium">{p.name === "current" ? <Tag>current</Tag> : p.name}</td>
                  <td>v{p.version}</td>
                  <td className="font-mono text-[12px]">{p.hash}</td>
                  <td>{p.name !== "current" && <Button variant="ghost" onClick={async () => { apply(await api.loadPreset(p.name)); setSaved(`Loaded preset ${p.name}`); }}>Load</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function ConfigEditor({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const [text, setText] = useState(JSON.stringify(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(JSON.stringify(value)), [value]);
  return (
    <input
      className={`${inputCls} w-[28rem] font-mono text-[11px] ${bad ? "border-bad" : ""}`}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        try {
          const v = JSON.parse(e.target.value);
          setBad(false);
          onChange(v);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}
