import type { Metadata } from "next";
import { Operations } from "@/components/ops/Operations";

export const metadata: Metadata = { title: "Operations" };

export default function OperationsPage() {
  return <Operations />;
}
