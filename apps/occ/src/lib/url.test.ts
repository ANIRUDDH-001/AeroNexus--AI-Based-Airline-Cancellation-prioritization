import { describe, expect, it } from "vitest";
import { parseClock, parseView, withParams } from "./url";

describe("parseClock", () => {
  it("snaps to the 15-minute grid inside the day", () => {
    expect(parseClock("300")).toBe(300);
    expect(parseClock("307")).toBe(300);
    expect(parseClock("308")).toBe(315);
    expect(parseClock("-20")).toBe(0);
    expect(parseClock("9999")).toBe(1425);
    expect(parseClock("abc")).toBe(300);
    expect(parseClock(null, 360)).toBe(360);
  });
});

describe("withParams", () => {
  it("writes keys in a fixed order and drops nulls", () => {
    expect(withParams("", { t: 300, day: "abc" })).toBe("?day=abc&t=300");
    expect(withParams("?day=abc&t=300&run=r1", { run: null })).toBe("?day=abc&t=300");
    expect(withParams("?x=1", { day: "d" })).toBe("?day=d&x=1");
    expect(withParams("?day=d", { day: null })).toBe("");
  });
});

describe("parseView", () => {
  it("defaults to today", () => {
    expect(parseView("board")).toBe("board");
    expect(parseView("nonsense")).toBe("today");
    expect(parseView(null)).toBe("today");
  });
});
