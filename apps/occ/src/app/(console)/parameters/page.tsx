import { Suspense } from "react";
import type { Metadata } from "next";
import { PageTitle } from "@/components/ui/panel";
import { ParametersPage } from "@/components/parameters/ParametersPage";

export const metadata: Metadata = { title: "Parameters" };

export default function Page() {
  return (
    <>
      <PageTitle title="Parameters" purpose="What the engine minimises, the hard rules it never breaks, and how hard it searches." />
      <Suspense fallback={null}>
        <ParametersPage />
      </Suspense>
    </>
  );
}
