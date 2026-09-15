import { describe, expect, it } from "vitest";
import { fmt, hhmm, inr, minutes, plural, seconds } from "./format";

describe("hhmm", () => {
  it("pads and rolls past midnight", () => {
    expect(hhmm(300)).toBe("05:00");
    expect(hhmm(1445)).toBe("00:05+1");
    expect(hhmm(null)).toBe("—");
  });
});

describe("inr", () => {
  it("speaks in lakh and crore", () => {
    expect(inr(410_000)).toBe("₹4.1 lakh");
    expect(inr(2_860_000)).toBe("₹29 lakh");
    expect(inr(12_000_000)).toBe("₹1.2 crore");
    expect(inr(850)).toBe("₹850");
    expect(inr(-150_000)).toBe("−₹1.5 lakh");
  });
});

describe("fmt, minutes, plural, seconds", () => {
  it("formats counts and durations", () => {
    expect(fmt(1234567)).toBe("12,34,567");
    expect(minutes(40)).toBe("40 min");
    expect(minutes(135)).toBe("2 h 15 min");
    expect(minutes(180)).toBe("3 h");
    expect(plural(1, "flight")).toBe("1 flight");
    expect(plural(3, "flight")).toBe("3 flights");
    expect(seconds(2140)).toBe("2.1 s");
    expect(seconds(850)).toBe("850 ms");
  });
});
