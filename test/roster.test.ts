import { describe, it, expect } from "vitest";
import { sortCombatants, buildRosterView, canRoll } from "../src/roster";
import type { Combatant } from "../src/types";

function c(over: Partial<Combatant> & { id: string }): Combatant {
  return {
    name: over.id,
    ownerId: "owner",
    gmControlled: false,
    init: 0,
    dexRaw: 10,
    ...over,
  };
}

describe("sortCombatants", () => {
  it("orders by initiative descending", () => {
    const out = sortCombatants([c({ id: "a", init: 5 }), c({ id: "b", init: 17 })]);
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("puts unrolled combatants last regardless of the others' values", () => {
    const out = sortCombatants([
      c({ id: "unrolled", init: 0 }),
      c({ id: "low", init: 1 }),
      c({ id: "high", init: 20 }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["high", "low", "unrolled"]);
  });

  it("does not mutate its input", () => {
    const input = [c({ id: "a", init: 1 }), c({ id: "b", init: 2 })];
    sortCombatants(input);
    expect(input.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("buildRosterView", () => {
  const all = [
    c({ id: "pc", gmControlled: false, init: 3 }),
    c({ id: "monster", gmControlled: true, init: 9 }),
  ];

  it("gives the GM both blocks", () => {
    const v = buildRosterView(all, true);
    expect(v.pcs.map((x) => x.id)).toEqual(["pc"]);
    expect(v.gms.map((x) => x.id)).toEqual(["monster"]);
  });

  it("hides GM-controlled combatants from players", () => {
    const v = buildRosterView(all, false);
    expect(v.pcs.map((x) => x.id)).toEqual(["pc"]);
    expect(v.gms).toEqual([]);
  });

  it("sorts within each block independently", () => {
    const v = buildRosterView(
      [
        c({ id: "pc-low", gmControlled: false, init: 2 }),
        c({ id: "pc-high", gmControlled: false, init: 18 }),
        c({ id: "gm-mid", gmControlled: true, init: 10 }),
      ],
      true,
    );
    expect(v.pcs.map((x) => x.id)).toEqual(["pc-high", "pc-low"]);
    expect(v.gms.map((x) => x.id)).toEqual(["gm-mid"]);
  });
});

describe("canRoll", () => {
  it("lets the GM roll anything", () => {
    expect(canRoll(c({ id: "x", ownerId: "someone" }), "gm-1", true)).toBe(true);
  });

  it("lets a player roll their own token", () => {
    expect(canRoll(c({ id: "x", ownerId: "p-1" }), "p-1", false)).toBe(true);
  });

  it("stops a player rolling someone else's token", () => {
    expect(canRoll(c({ id: "x", ownerId: "p-2" }), "p-1", false)).toBe(false);
  });
});
