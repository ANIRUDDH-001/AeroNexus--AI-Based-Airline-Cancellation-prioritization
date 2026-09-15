import type { Metadata } from "next";
import { PageTitle } from "@/components/ui/panel";
import { RunsPage } from "@/components/runs/RunsPage";

export const metadata: Metadata = { title: "Runs" };

export default function Page() {
  return (
    <>
      <PageTitle title="Runs" purpose="Every recommendation the engine has made, with its audit trail." />
      <RunsPage />
    </>
  );
}
