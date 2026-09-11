import { useEffect, useState } from "react";
import { Check, Save } from "lucide-react";
import { api, ApiError, type ConfigEnvelope, type ObjectiveTerm } from "@/lib/api";
import { Button, PageTitle, Tag } from "@/components/Shell";

const LEVEL_LABEL: Record<ObjectiveTerm["level"], string> = {
  L1: "Network continuity",
  L2: "Passenger harm",
  L3: "Cost",
  L4: "Robustness",
};

/** Phase 0 slice of the Parameters page: objective terms (weights, enable) and the constraint list.
 *  Editing expressions and adding new terms/constraints arrives with the full page in Phase 4. */
export function ParametersPage() {
  const [env, setEnv] = useState<ConfigEnvelope | null>(null);
  const [terms, setTerms] = useState<ObjectiveTerm[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api
      .config()
      .then((e) => {
        setEnv(e);
        setTerms(e.config.objective_terms);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const update = (i: number, patch: Partial<ObjectiveTerm>) => {
    setTerms((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setDirty(true);
    setSaved(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const e = await api.putTerms(terms);
      setEnv(e);
      setTerms(e.config.objective_terms);
      setDirty(false);
      setSaved(`Saved · config v${e.version} · ${e.hash}`);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!env) return <PageTitle title="Parameters" subtitle={error ?? "Loading…"} />;

  return (
    <>
      <PageTitle
        title="Parameters"
        subtitle="Everything that can change a recommendation lives here and is versioned. Weights are placeholders until tuned on the hand-crafted cases."
      />
      <div className="flex items-center gap-3 mb-4 text-[12px] text-ink-2">
        <span>
          Config <span className="font-mono">{env.hash}</span> · v{env.version}
        </span>
        <span className="flex-1" />
        {saved && (
          <span className="text-ok inline-flex items-center gap-1">
            <Check size={13} /> {saved}
          </span>
        )}
        <Button onClick={save} disabled={!dirty || saving}>
          <Save size={14} /> Save
        </Button>
      </div>
      {error && <p className="mb-3 text-[13px] text-bad">{error}</p>}

      <h2 className="text-[20px] font-semibold mt-6 mb-2">Objective terms</h2>
      <table className="ax-table">
        <thead>
          <tr>
            <th>On</th>
            <th>Term</th>
            <th>Level</th>
            <th>Expression</th>
            <th>Weight</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {terms.map((t, i) => (
            <tr key={t.name}>
              <td>
                <input type="checkbox" checked={t.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
              </td>
              <td className="font-medium">{t.name}</td>
              <td>
                <Tag>{t.level}</Tag> <span className="text-ink-2">{LEVEL_LABEL[t.level]}</span>
              </td>
              <td className="font-mono text-[12px]">{t.expression}</td>
              <td>
                <input
                  type="number"
                  className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-[13px]"
                  value={t.weight}
                  onChange={(e) => update(i, { weight: Number(e.target.value) })}
                />
              </td>
              <td className="text-ink-2">{t.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="text-[20px] font-semibold mt-10 mb-2">Hard constraints</h2>
      <table className="ax-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Constraint</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {env.config.constraints.map((c) => (
            <tr key={c.id}>
              <td className="font-mono text-[12px]">{c.id}</td>
              <td className="font-medium">{c.name}</td>
              <td className="text-ink-2">{c.kind === "builtin" ? c.plugin : "user rule"}</td>
              <td>{c.enabled ? <Tag tone="ok">enabled</Tag> : <Tag tone="gray">off</Tag>}</td>
              <td className="text-ink-2">{c.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
