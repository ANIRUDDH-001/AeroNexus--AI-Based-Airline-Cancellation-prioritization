import type { Metadata } from "next";
import { PageTitle } from "@/components/ui/panel";
import { CasesPage } from "@/components/cases/CasesPage";

export const metadata: Metadata = { title: "Cases & benchmarks" };

export default function Page() {
  return (
    <>
      <PageTitle title="Cases & benchmarks" purpose="Evidence that the approach works across scenarios." />
      <CasesPage />
    </>
  );
}
