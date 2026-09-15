import { Suspense } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { EngineBanner } from "@/components/shell/EngineStatus";
import { MobileTabBar } from "@/components/shell/MobileTabBar";

/** The console frame: top bar with the decision cluster, the engine banner when the engine is unavailable,
 *  the page, and the phone tab bar. Everything that reads the URL sits under Suspense (Next 16). */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-12 border-b border-hairline bg-panel" />}>
        <TopBar />
        <EngineBanner />
      </Suspense>
      <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-8 md:pt-5">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
      <Suspense fallback={null}>
        <MobileTabBar />
      </Suspense>
    </div>
  );
}
