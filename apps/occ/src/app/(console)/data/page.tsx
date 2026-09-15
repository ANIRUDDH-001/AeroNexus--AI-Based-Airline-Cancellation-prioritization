import type { Metadata } from "next";
import { PageTitle } from "@/components/ui/panel";
import { DataPage } from "@/components/data/DataPage";

export const metadata: Metadata = { title: "Data" };

export default function Page() {
  return (
    <>
      <PageTitle title="Data" purpose="Which days exist; generate a synthetic day or import your own." />
      <DataPage />
    </>
  );
}
