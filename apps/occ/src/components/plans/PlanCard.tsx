"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Plan, Run, TimelineFlight } from "@/lib/api";
import { preventsFromRun, type Diff } from "@/lib/diff";
import { GLOSSARY } from "@/lib/glossary";
import { hhmm } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Define } from "@/components/ui/overlay";
import { CausalChain } from "./CausalChain";
import { Expanded } from "./Expanded";
import { PreventsLine, Reliability, ResultTable, ScoreDefine, actionSentence } from "./shared";

export type PlanStatus = { kind: "recommended" } | { kind: "accepted"; at: number } | { kind: "overridden"; reason: string };

/** A plan card in the fixed order (spec §5.6): do this → impact avoided if we act → why (the chain) — hairline —
 *  result → reliability → buttons. Alternatives collapse to the first two blocks. */
export function PlanCard({
  plan,
  run,
  flights,
  airportNames,
  diff,
  recommended,
  status,
  shownOnBoard,
  onShow,
  onAccept,
  onWhyOverNext,
  onOverride,
  canDecide,
  disabledReason,
}: {
  plan: Plan;
  run: Run;
  flights: Map<string, TimelineFlight>;
  airportNames: Map<string, string>;
  diff: Diff | null;
  recommended: boolean;
  status: PlanStatus | null;
  shownOnBoard: boolean;
  onShow: () => void;
  onAccept: () => void;
  onWhyOverNext?: () => void;
  onOverride: () => void;
  canDecide: boolean;
  disabledReason: string | null;
}) {
  const [open, setOpen] = useState(recommended);
  const [details, setDetails] = useState(false);
  const prevents = diff?.prevents ?? preventsFromRun(run, plan);
  const baseline = run.baseline_metrics ?? {};
  const title = recommended ? `Recommended: plan ${plan.rank}` : `Plan ${plan.rank}`;
  return (
    <article className={cn("rounded-panel border bg-panel", recommended ? "border-ivory/40" : "border-hairline", shownOnBoard && "ring-1 ring-amber/60")} aria-label={title}>
      <header className="flex items-start gap-2 px-4 pt-3">
        {!recommended && (
          <button type="button" onClick={() => setOpen(!open)} className="-ml-1 mt-0.5 rounded p-0.5 text-ivory-3 hover:bg-panel-2 hover:text-ivory" aria-label={open ? "Collapse" : "Expand"}>
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        )}
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {status?.kind === "accepted" && <Pill tone="mint">Accepted {hhmm(status.at)}</Pill>}
          {status?.kind === "overridden" && <Pill tone="neutral">Overridden: {status.reason}</Pill>}
          {(!status || status.kind === "recommended") && recommended && <Pill tone="ivory">Recommended</Pill>}
          {!plan.actions.length && <Pill tone="neutral">Wait</Pill>}
        </div>
      </header>

      <div className="space-y-3 px-4 pb-3 pt-2">
        <section>
          <h4 className="text-[11.5px] text-ivory-3">Do this</h4>
          <p className={cn("mt-0.5 leading-snug text-ivory", recommended ? "text-[15px] font-medium" : "text-[13.5px]")}>{actionSentence(plan, flights, airportNames)}</p>
        </section>
        <section>
          <h4 className="text-[11.5px] text-ivory-3">
            <Define short={GLOSSARY.impact_avoided.short}>Impact avoided if we act</Define>
          </h4>
          <div className="mt-1">
            <PreventsLine prevents={prevents} size={recommended ? "md" : "sm"} />
          </div>
        </section>

        {open && (
          <>
            {plan.actions.length > 0 && (
              <section>
                <h4 className="mb-1.5 text-[11.5px] text-ivory-3">Why</h4>
                <CausalChain plan={plan} flights={flights} diff={diff} limit={6} />
              </section>
            )}
            <div className="border-t border-hairline" />
            <section className="space-y-3">
              <ResultTable plan={plan} baseline={baseline} />
              <div>
                <h4 className="mb-1 text-[11.5px] text-ivory-3">Reliability</h4>
                <Reliability plan={plan} />
                <p className="mt-1.5 text-[11.5px] text-ivory-3">Ranked by <ScoreDefine plan={plan} run={run} />.</p>
              </div>
            </section>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={recommended ? "primary" : "outline"} onClick={onAccept} disabled={!canDecide} title={disabledReason ?? undefined}>
                {status?.kind === "accepted" ? "Accepted" : `Accept plan ${plan.rank}`}
              </Button>
              <Button variant={shownOnBoard ? "outline" : "ghost"} onClick={onShow}>
                {shownOnBoard ? "Shown on the board" : "Show changes"}
              </Button>
              {onWhyOverNext && plan.explanation.why_over_next && (
                <Button variant="ghost" onClick={onWhyOverNext}>
                  Why plan {plan.rank} over plan {(plan.rank ?? 1) + 1}?
                </Button>
              )}
              <button type="button" onClick={() => setDetails(!details)} className="ml-auto text-[12px] text-ivory-2 underline underline-offset-[3px] hover:text-ivory">
                {details ? "Hide how this plan was found" : "How this plan was found"}
              </button>
            </div>
            {canDecide && status?.kind !== "accepted" && (
              <div className="text-[12px] text-ivory-3">
                Disagree?{" "}
                <button type="button" onClick={onOverride} className="underline underline-offset-[3px] hover:text-ivory">
                  Record an override
                </button>
              </div>
            )}
            {details && (
              <div className="border-t border-hairline pt-3">
                <Expanded plan={plan} run={run} flights={flights} diff={diff} baseline={baseline} />
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}
