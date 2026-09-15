import type { Metadata } from "next";
import { PageTitle } from "@/components/ui/panel";
import { EntityBrowser } from "@/components/flights/EntityBrowser";

export const metadata: Metadata = { title: "Flights & resources" };

export default function Page() {
  return (
    <>
      <PageTitle title="Flights & resources" purpose="Look anything up on this day: flights, aircraft, crews, airports, itineraries." />
      <EntityBrowser />
    </>
  );
}
