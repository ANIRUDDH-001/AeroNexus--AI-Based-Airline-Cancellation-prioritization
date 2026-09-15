import type { Metadata } from "next";
import { PageTitle } from "@/components/ui/panel";
import { HowItWorks } from "@/components/how/HowItWorks";

export const metadata: Metadata = { title: "How it works" };

export default function Page() {
  return (
    <>
      <PageTitle title="How it works" purpose="The pipeline, step by step, with today's numbers." />
      <HowItWorks />
    </>
  );
}
