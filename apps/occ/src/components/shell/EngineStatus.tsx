"use client";
import { useEngine } from "@/hooks/useEngine";
import { Dot, Pill } from "@/components/ui/pill";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { seconds } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Engine status in the top bar (spec §4): online, starting, unavailable, error — in operational words.
 *  Technical detail (version, configuration, narration provider) lives in the popover. */
export function EngineStatus({ compact = false }: { compact?: boolean }) {
  const { state, health, bundle, wakingSeconds: wakingFor, wake, error } = useEngine();

  const label =
    state === "connecting" ? "Connecting" : state === "online" ? "Engine online" : state === "starting" ? "Starting the engine" : state === "error" ? "Engine error" : "Engine unavailable";
  const tone = state === "online" ? "mint" : state === "starting" ? "amber" : state === "error" ? "coral" : "neutral";

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={cn("inline-flex h-8 items-center gap-2 rounded-control px-2 text-[12.5px] hover:bg-panel-2", state === "online" ? "text-ivory" : "text-ivory-2")} aria-label={`Engine status: ${label}`}>
            <Dot tone={tone} pulse={state === "starting" || state === "connecting"} />
            {!compact && <span>{label}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[340px] space-y-2 text-[12.5px]">
          <div className="font-semibold text-ivory">{label}</div>
          {state === "online" && health && (
            <>
              <div className="text-ivory-2">
                Engine v{health.engine_version}, configuration <span className="mono">{health.config_hash}</span> v{health.config_version}.
              </div>
              <div className="text-ivory-2">{health.narration.mode === "llm" ? `Narration by ${health.narration.model}.` : "Narration: template only."}</div>
              {health.write_key_required && <div className="text-ivory-2">Editing needs the write key.</div>}
            </>
          )}
          {state === "unavailable" && (
            <>
              <div className="text-ivory-2">The hosted engine sleeps after 15 idle minutes. Until it answers, the console shows the precomputed demo day, read-only.</div>
              {bundle && (
                <div className="text-ivory-3">
                  Demo bundle built {bundle.generated_at.slice(0, 10)} with configuration <span className="mono">{bundle.config_hash}</span>.
                </div>
              )}
            </>
          )}
          {state === "starting" && <div className="text-ivory-2">Usually under a minute. Waiting {seconds(wakingFor * 1000)} so far; the screen switches to live results by itself.</div>}
          {state === "error" && <div className="text-coral">{error}</div>}
          {state !== "online" && state !== "connecting" && (
            <div className="pt-1">
              <Button variant="primary" size="sm" onClick={() => void wake()} disabled={state === "starting"}>
                {state === "starting" ? "Starting…" : "Wake engine"}
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {state === "unavailable" && !compact && (
        <Button variant="outline" size="sm" onClick={() => void wake()}>
          Wake engine
        </Button>
      )}
    </div>
  );
}

/** The demo pill: unmistakable, persistent, next to the status (spec §4). */
export function ModeTag({ compact = false }: { compact?: boolean }) {
  const { demo, state, bundle } = useEngine();
  if (!demo || state === "connecting") return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-full" aria-label="Demo data, precomputed, read-only">
          <Pill tone="amber">{compact ? "Demo" : "Demo data, precomputed, read-only"}</Pill>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] space-y-1.5 text-[12.5px]">
        <div className="font-semibold text-ivory">Precomputed demo</div>
        <div className="text-ivory-2">Every number on screen was computed earlier by the same engine and stored. Results are tagged “Demo result”; nothing can be changed until the engine is awake.</div>
        {bundle && (
          <div className="text-ivory-3">
            Built {bundle.generated_at.slice(0, 10)}, configuration <span className="mono">{bundle.config_hash}</span>
            {bundle.deterministic ? ", deterministic replay" : ""}.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** One line under the top bar while the engine is unavailable or starting. */
export function EngineBanner() {
  const { state, wake, wakingSeconds: wakingFor } = useEngine();
  if (state !== "unavailable" && state !== "starting") return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline bg-amber-soft px-4 py-1.5 text-[12.5px] text-ivory md:px-6">
      {state === "starting" ? (
        <span>Starting the engine, usually under a minute… {wakingFor > 0 && <span className="text-ivory-2">{wakingFor} s</span>}</span>
      ) : (
        <>
          <span>The engine is unavailable, so this is the precomputed demo day. Wake it to run your own scenarios.</span>
          <button type="button" onClick={() => void wake()} className="font-semibold underline underline-offset-[3px]">
            Wake engine
          </button>
        </>
      )}
    </div>
  );
}
