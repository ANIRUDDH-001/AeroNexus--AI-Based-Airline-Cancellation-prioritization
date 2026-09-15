import { describe, expect, it } from "vitest";
import { diffTimelines, stripState } from "./diff";
import type { Timeline, TimelineFlight } from "./api";

const flight = (over: Partial<TimelineFlight>): TimelineFlight => ({
  id: "f1", number: "6E 2011", origin: "DEL", dest: "BOM", std: 340, sta: 470, std_hhmm: "05:40", sta_hhmm: "07:50", tail: "VT-IAD", crew_id: "c1",
  aircraft_type: "A320", booked_pax: 180, pax_connecting: 20, status: "OPERATED", dep: 340, arr: 470, delay_min: 0, reason: null, standby_called: false,
  at_risk: false, risk_reasons: [], protected: false, ...over,
});
const tl = (flights: TimelineFlight[], summary: Partial<Timeline["summary"]> = {}): Timeline => ({
  instance_id: "d", clock: 300, clock_hhmm: "05:00", flights, rotations: {}, disruptions: [], at_risk: [],
  committed: { cancelled: [], delays: {}, swaps: [], tail_override: {}, labels: [], count: 0 },
  summary: { flights: flights.length, at_risk: 0, forced_cancellations: 0, delayed_flights: 0, total_delay_min: 0, misconnects: 0, stranded_overnight: 0, standby_used: 0, aircraft_available: 10, standby_crews: 2, ...summary },
});

describe("stripState", () => {
  it("names each state", () => {
    expect(stripState(flight({}))).toBe("on_time");
    expect(stripState(flight({ delay_min: 30 }))).toBe("delayed");
    expect(stripState(flight({ at_risk: true }))).toBe("at_risk");
    expect(stripState(flight({ status: "CANCELLED_FORCED" }))).toBe("cancels_itself");
    expect(stripState(flight({ status: "CANCELLED_DECISION" }))).toBe("cancelled_by_plan");
    expect(stripState(flight({ status: "PAST" }))).toBe("already_happened");
  });
});

describe("diffTimelines", () => {
  it("finds protected, cancelled-by-plan, re-fleeted and held flights and the prevented impact", () => {
    const before = tl(
      [
        flight({ id: "a", status: "CANCELLED_FORCED", dest: "BLR" }),
        flight({ id: "b", status: "OPERATED" }),
        flight({ id: "c", status: "OPERATED", tail: "VT-IAD" }),
        flight({ id: "d", status: "OPERATED", delay_min: 0 }),
      ],
      { forced_cancellations: 1, stranded_overnight: 120, total_delay_min: 200, misconnects: 30 },
    );
    const after = tl(
      [
        flight({ id: "a", status: "OPERATED", dest: "BLR" }),
        flight({ id: "b", status: "CANCELLED_DECISION" }),
        flight({ id: "c", status: "OPERATED", tail: "VT-IFM" }),
        flight({ id: "d", status: "OPERATED", delay_min: 40 }),
      ],
      { forced_cancellations: 0, stranded_overnight: 20, total_delay_min: 240, misconnects: 12 },
    );
    const d = diffTimelines(before, after);
    expect(d.protectedIds).toEqual(["a"]);
    expect(d.cancelledByPlanIds).toEqual(["b"]);
    expect(d.reFleetedIds).toEqual(["c"]);
    expect(d.byId.get("c")?.label).toBe("was VT-IAD");
    expect(d.byId.get("d")?.kind).toBe("held");
    expect(d.byId.get("d")?.label).toBe("+40 min");
    expect(d.changes).toHaveLength(4);
    expect([...d.tails].sort()).toEqual(["VT-IAD", "VT-IFM"]);
    expect(d.prevents).toEqual({ cancellations: 1, stranded: 100, delayMin: -40, misconnects: 18 });
    expect(d.airportDelta.get("DEL")).toEqual({ before: 1, after: 0 });
    expect(d.airportDelta.get("BLR")).toEqual({ before: 1, after: 0 });
  });
  it("reports nothing when nothing changes", () => {
    const a = tl([flight({})]);
    expect(diffTimelines(a, a).changes).toEqual([]);
  });
});
