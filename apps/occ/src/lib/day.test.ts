import { describe, expect, it } from "vitest";
import { dayDetail, dayTitle, isSynthetic, pickDefaultDay } from "./day";
import type { InstanceRow } from "./api";

const row = (over: Partial<InstanceRow>): InstanceRow => ({
  id: "x", name: "synthetic-small-seed2", size: "small", seed: 2, created_at: "2026-09-13T00:00:00Z",
  summary: { name: "synthetic-small-seed2", size: "small", seed: 2, day_start: "2026-12-15", airports: 8, hubs: 2, aircraft: 10, flights: 80, crews: 40, standby_crews: 4, itineraries: 100, booked_pax: 9000, connecting_pax: 800, disruptions: 0 },
  ...over,
});

describe("pickDefaultDay", () => {
  it("prefers the fog + AOG demo day, else the newest", () => {
    const demo = row({ id: "demo", name: "synthetic-medium-seed1", size: "medium", seed: 1, summary: { ...row({}).summary, disruptions: 2 } });
    expect(pickDefaultDay([row({ id: "a" }), demo])?.id).toBe("demo");
    expect(pickDefaultDay([row({ id: "a" }), row({ id: "b" })])?.id).toBe("a");
    expect(pickDefaultDay([])).toBeNull();
  });
});

describe("dayTitle and dayDetail", () => {
  it("names the day for people, not for the generator", () => {
    const r = row({ name: "synthetic-medium-seed1", size: "medium", seed: 1, summary: { ...row({}).summary, flights: 253, airports: 12, disruptions: 2 } });
    expect(dayTitle(r)).toBe("Medium synthetic day");
    expect(dayDetail(r)).toBe("Seed 1, 253 flights, 12 airports, 2 disruptions");
    expect(isSynthetic(r)).toBe(true);
    expect(dayTitle({ name: "ops-2026-12-15", size: "custom", seed: null })).toBe("ops-2026-12-15");
  });
});
