import { describe, it, expect } from "vitest";
import { buildNotation } from "../src/notation";

describe("buildNotation", () => {
  it("builds a plain d20 with no bonus", () => {
    expect(buildNotation("normal", 0)).toBe("1d20");
  });

  it("appends a positive bonus", () => {
    expect(buildNotation("normal", 3)).toBe("1d20+3");
  });

  it("appends a negative bonus with a minus sign", () => {
    expect(buildNotation("normal", -2)).toBe("1d20-2");
  });

  it("uses keep-highest for advantage", () => {
    expect(buildNotation("advantage", 5)).toBe("2d20kh1+5");
  });

  it("uses keep-lowest for disadvantage", () => {
    expect(buildNotation("disadvantage", 0)).toBe("2d20kl1");
  });

  it("handles disadvantage with a negative bonus", () => {
    expect(buildNotation("disadvantage", -1)).toBe("2d20kl1-1");
  });
});
