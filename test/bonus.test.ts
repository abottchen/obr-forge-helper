import { describe, it, expect, beforeEach } from "vitest";
import { OBR, __testHooks } from "./_mocks/obr-sdk";
import {
  dexModifier,
  overrideKey,
  readOverrides,
  resolveBonus,
  writeOverride,
  pruneOverrides,
} from "../src/bonus";

describe("dexModifier", () => {
  it("computes the 5e modifier from a number", () => {
    expect(dexModifier(14)).toBe(2);
  });

  it("computes the modifier from a string, as exported tokens store it", () => {
    expect(dexModifier("12")).toBe(1);
  });

  it("returns 0 for an average score", () => {
    expect(dexModifier(10)).toBe(0);
  });

  it("floors toward negative infinity for odd low scores", () => {
    expect(dexModifier(7)).toBe(-2);
    expect(dexModifier(9)).toBe(-1);
  });

  it("returns 0 when the score is absent", () => {
    expect(dexModifier(undefined)).toBe(0);
    expect(dexModifier(null)).toBe(0);
  });

  it("returns 0 for an empty string rather than treating it as zero", () => {
    expect(dexModifier("")).toBe(0);
    expect(dexModifier("   ")).toBe(0);
  });

  it("returns 0 for a non-numeric score", () => {
    expect(dexModifier("abc")).toBe(0);
  });
});

describe("readOverrides", () => {
  it("extracts only our namespaced keys", () => {
    const md = {
      "com.abottchen.obr-forge-helper/v1/bonus/item-1": 7,
      "com.battle-system.forge/init": 12,
      unrelated: 3,
    };
    expect(readOverrides(md)).toEqual({ "item-1": 7 });
  });

  it("skips null values, which OBR can persist", () => {
    const md = { "com.abottchen.obr-forge-helper/v1/bonus/item-1": null };
    expect(readOverrides(md)).toEqual({});
  });
});

describe("resolveBonus", () => {
  it("prefers an override over the DEX modifier", () => {
    expect(resolveBonus({ "item-1": 7 }, "item-1", 14)).toBe(7);
  });

  it("falls back to the DEX modifier when there is no override", () => {
    expect(resolveBonus({}, "item-1", 14)).toBe(2);
  });

  it("honours an override of zero", () => {
    expect(resolveBonus({ "item-1": 0 }, "item-1", 14)).toBe(0);
  });
});

describe("override persistence", () => {
  beforeEach(() => __testHooks.reset());

  it("writes an override to room metadata", async () => {
    await writeOverride("item-1", 7);
    const md = await OBR.room.getMetadata();
    expect(md[overrideKey("item-1")]).toBe(7);
  });

  it("clears an override when passed null", async () => {
    await writeOverride("item-1", 7);
    await writeOverride("item-1", null);
    const md = await OBR.room.getMetadata();
    expect(overrideKey("item-1") in md).toBe(false);
  });

  it("prunes overrides for items no longer in the scene", async () => {
    await writeOverride("item-1", 7);
    await writeOverride("item-gone", 3);
    await pruneOverrides(new Set(["item-1"]));
    const md = await OBR.room.getMetadata();
    expect(md[overrideKey("item-1")]).toBe(7);
    expect(overrideKey("item-gone") in md).toBe(false);
  });

  it("leaves foreign keys alone when pruning", async () => {
    await OBR.room.setMetadata({ "com.other.ext/thing": 1 });
    await pruneOverrides(new Set());
    const md = await OBR.room.getMetadata();
    expect(md["com.other.ext/thing"]).toBe(1);
  });
});
