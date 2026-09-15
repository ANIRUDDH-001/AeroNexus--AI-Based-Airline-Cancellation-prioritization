"use client";
import { useState } from "react";
import type { Plan, TimelineFlight } from "@/lib/api";
import type { Diff } from "@/lib/diff";
import { hhmm } from "@/lib/format";
import { cn } from "@/lib/utils";

type Link = { kind: "decide" | "consequence" | "protected" | "fails"; text: string; detail?: string };

/** The causal chain (spec §5.6): each decided action → what it does in the network → the flights it protects →
 *  what still fails and why. Drawn as a vertical sequence because it is one. */
export function CausalChain({ plan, flights, diff, limit = 6 }: { plan: Plan; flights: Map<string, TimelineFlight>; diff: Diff | null; limit?: number }) {
  const [full, setFull] = useState(false);
  const links: Link[] = [];
  const label = (id: string) => {
    const f = flights.get(id);
    return f ? `${f.number} ${f.origin}–${f.dest} ${hhmm(f.std)}` : id;
  };
  for (const a of plan.actions) {
    const ids = a.target_flights ?? [];
    const params = (a.params ?? {}) as Record<string, unknown>;
    const f0 = flights.get(ids[0] ?? "");
    if (a.type === "CANCEL_CYCLE" || a.type === "CANCEL_LEG") {
      const pax = ids.reduce((s, id) => s + (flights.get(id)?.booked_pax ?? 0), 0);
      links.push({ kind: "decide", text: `Cancel ${ids.map(label).join(", ")}`, detail: `${pax} passengers re-accommodated early; ${f0?.tail ?? "the aircraft"} stays at ${f0?.origin ?? "its station"}` });
      if (f0?.tail) links.push({ kind: "consequence", text: `${f0.tail} is free at ${f0.origin} from ${hhmm(f0.std)}` });
    } else if (a.type === "DELAY") {
      links.push({ kind: "decide", text: `Hold ${label(ids[0] ?? "")} by ${params.delay_min ?? "?"} min`, detail: "its aircraft and crew arrive in time instead of missing the leg" });
    } else if (a.type === "SWAP") {
      links.push({ kind: "decide", text: `Re-fleet ${label(ids[0] ?? "")} onto ${params.swap_tail ?? "another aircraft"}`, detail: "the original aircraft is not where this leg needs it" });
    } else {
      links.push({ kind: "decide", text: `${a.type} ${ids.map(label).join(", ")}` });
    }
  }
  if (diff && diff.protectedIds.length) {
    links.push({ kind: "protected", text: `${diff.protectedIds.map(label).join(", ")} operate${diff.protectedIds.length === 1 ? "s" : ""}`, detail: `would have cancelled ${diff.protectedIds.length === 1 ? "itself" : "themselves"} if nobody acted` });
  }
  for (const fc of plan.explanation.forced_cancellations ?? []) {
    links.push({ kind: "fails", text: `${label(fc.flight)} still cancels itself`, detail: fc.reason });
  }
  if (!links.length) return null;
  const shown = full ? links : links.slice(0, limit);
  return (
    <div>
      <ol className="relative ml-1.5 border-l border-hairline-strong pl-4">
        {shown.map((l, i) => (
          <li key={i} className="relative pb-2.5 text-[12.5px] last:pb-0">
            <span aria-hidden className={cn("absolute -left-[21px] top-[5px] size-2 rounded-full", l.kind === "decide" ? "bg-ivory" : l.kind === "consequence" ? "bg-ivory-3" : l.kind === "protected" ? "bg-mint" : "bg-coral")} />
            <span className={cn(l.kind === "fails" ? "text-coral" : l.kind === "protected" ? "text-mint" : l.kind === "consequence" ? "text-ivory-2" : "text-ivory")}>{l.text}</span>
            {l.detail && <span className="text-ivory-3">, {l.detail}</span>}
          </li>
        ))}
      </ol>
      {links.length > limit && (
        <button type="button" onClick={() => setFull(!full)} className="mt-1.5 text-[12px] text-ivory-2 underline underline-offset-[3px] hover:text-ivory">
          {full ? "Show fewer links" : `Show the full chain (${links.length} links)`}
        </button>
      )}
    </div>
  );
}
