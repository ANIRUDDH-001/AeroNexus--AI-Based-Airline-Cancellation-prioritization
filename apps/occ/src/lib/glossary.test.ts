import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GLOSSARY, metricTerm } from "./glossary";

describe("glossary", () => {
  it("defines every metric the engine reports", () => {
    const file = resolve(__dirname, "../../../../data/static-runs/metrics.json");
    const { metrics } = JSON.parse(readFileSync(file, "utf-8")) as { metrics: string[] };
    const missing = metrics.filter((m) => !(m in GLOSSARY));
    expect(missing).toEqual([]);
  });
  it("every entry has a label and a one-sentence meaning", () => {
    for (const [k, t] of Object.entries(GLOSSARY)) {
      expect(t.label, k).toBeTruthy();
      expect(t.short.length, k).toBeGreaterThan(20);
      expect(t.label, k).toBe(t.label.toLowerCase() === t.label ? t.label : t.label);
    }
    expect(metricTerm("not_a_metric").label).toBe("not a metric");
  });
});
