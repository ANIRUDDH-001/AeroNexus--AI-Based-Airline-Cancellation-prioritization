"use client";
import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { makeQueryClient } from "@/lib/query";
import { TooltipProvider } from "@/components/ui/overlay";
import { EngineProvider } from "@/hooks/useEngine";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={200}>
        <EngineProvider>{children}</EngineProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            unstyled: true,
            classNames: {
              toast: "flex items-center gap-2 rounded-control border border-hairline-strong bg-panel-2 px-3.5 py-2.5 text-[13px] text-ivory shadow-[0_12px_32px_rgba(0,0,0,0.45)]",
              description: "text-ivory-2",
            },
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
