import { describe, it, expect, beforeEach } from "vitest";
import { OBR, __testHooks } from "./_mocks/obr-sdk";
import { combatantName, readRoster, writeInit } from "../src/forge";
import { F_ON_LIST, F_INIT, F_NAME, F_DEX } from "../src/constants";

function token(over: {
  id: string;
  owner?: string;
  onList?: boolean;
  init?: number;
  forgeName?: string;
  plainText?: string;
  dex?: unknown;
  itemName?: string;
}) {
  const metadata: Record<string, unknown> = {};
  if (over.onList !== undefined) metadata[F_ON_LIST] = over.onList;
  if (over.init !== undefined) metadata[F_INIT] = over.init;
  if (over.forgeName !== undefined) metadata[F_NAME] = over.forgeName;
  if (over.dex !== undefined) metadata[F_DEX] = over.dex;
  return {
    id: over.id,
    name: over.itemName ?? "item-name",
    createdUserId: over.owner ?? "owner",
    layer: "CHARACTER",
    metadata,
    text: { plainText: over.plainText ?? "" },
  };
}

describe("combatantName", () => {
  it("prefers the Forge name", () => {
    expect(
      combatantName(token({ id: "a", forgeName: "Goblin", plainText: "Robust Goblin" })),
    ).toBe("Goblin");
  });

  it("falls back to the board label when Forge has no name", () => {
    expect(combatantName(token({ id: "a", plainText: "Robust Goblin" }))).toBe(
      "Robust Goblin",
    );
  });

  it("falls back to the item name when both are absent", () => {
    expect(combatantName(token({ id: "a", itemName: "Untitled" }))).toBe("Untitled");
  });
});

describe("readRoster", () => {
  beforeEach(() => __testHooks.reset());

  it("includes only tokens on Forge's initiative list", async () => {
    __testHooks.setItems([
      token({ id: "on", onList: true }),
      token({ id: "off", onList: false }),
      token({ id: "absent" }),
    ]);
    const roster = await readRoster(null);
    expect(roster.map((c) => c.id)).toEqual(["on"]);
  });

  it("marks tokens owned by the GM as GM-controlled", async () => {
    __testHooks.setItems([
      token({ id: "monster", onList: true, owner: "gm-1" }),
      token({ id: "pc", onList: true, owner: "p-1" }),
    ]);
    const roster = await readRoster("gm-1");
    expect(roster.find((c) => c.id === "monster")!.gmControlled).toBe(true);
    expect(roster.find((c) => c.id === "pc")!.gmControlled).toBe(false);
  });

  it("treats every token as PC-controlled when the GM id is unknown", async () => {
    __testHooks.setItems([token({ id: "monster", onList: true, owner: "gm-1" })]);
    const roster = await readRoster(null);
    expect(roster[0]!.gmControlled).toBe(false);
  });

  it("defaults a missing init to 0", async () => {
    __testHooks.setItems([token({ id: "a", onList: true })]);
    expect((await readRoster(null))[0]!.init).toBe(0);
  });

  it("carries the raw DEX value through unconverted", async () => {
    __testHooks.setItems([token({ id: "a", onList: true, dex: "12" })]);
    expect((await readRoster(null))[0]!.dexRaw).toBe("12");
  });
});

describe("writeInit", () => {
  beforeEach(() => __testHooks.reset());

  it("writes the rolled total", async () => {
    __testHooks.setItems([token({ id: "a", onList: true })]);
    await writeInit("a", 17);
    expect(__testHooks.getItem("a")!.metadata[F_INIT]).toBe(17);
  });

  it("clamps zero to 1 so the combatant does not read as unrolled", async () => {
    __testHooks.setItems([token({ id: "a", onList: true })]);
    await writeInit("a", 0);
    expect(__testHooks.getItem("a")!.metadata[F_INIT]).toBe(1);
  });

  it("clamps a negative total to 1", async () => {
    __testHooks.setItems([token({ id: "a", onList: true })]);
    await writeInit("a", -3);
    expect(__testHooks.getItem("a")!.metadata[F_INIT]).toBe(1);
  });

  it("preserves the rest of the stat block", async () => {
    __testHooks.setItems([
      token({ id: "a", onList: true, forgeName: "Goblin", dex: "14" }),
    ]);
    await writeInit("a", 12);
    const md = __testHooks.getItem("a")!.metadata;
    expect(md[F_NAME]).toBe("Goblin");
    expect(md[F_DEX]).toBe("14");
    expect(md[F_ON_LIST]).toBe(true);
    expect(md[F_INIT]).toBe(12);
  });

  it("targets only the named item", async () => {
    __testHooks.setItems([
      token({ id: "a", onList: true }),
      token({ id: "b", onList: true, init: 5 }),
    ]);
    await writeInit("a", 12);
    expect(__testHooks.getItem("b")!.metadata[F_INIT]).toBe(5);
    expect(OBR.scene.items.updateItems).toHaveBeenCalledWith(["a"], expect.any(Function));
  });
});
