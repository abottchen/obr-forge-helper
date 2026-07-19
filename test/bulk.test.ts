import { describe, it, expect, beforeEach } from "vitest";
import { OBR, __testHooks, fakeDicex } from "./_mocks/obr-sdk";
import { mount } from "../src/main";
import { handleRolls } from "../src/background";
import { __dicePlusTestHooks } from "../src/dicePlus";
import {
  F_ON_LIST,
  F_INIT,
  F_NAME,
  F_DEX,
  INTERNAL_ROLL_CHANNEL,
  DICE_PLUS_ROLL_REQUEST_CHANNEL,
} from "../src/constants";
import type { RollSpec } from "../src/types";

function token(id: string, owner: string, init = 0, dex = "14") {
  return {
    id,
    name: id,
    createdUserId: owner,
    layer: "CHARACTER",
    metadata: { [F_ON_LIST]: true, [F_INIT]: init, [F_NAME]: id, [F_DEX]: dex },
    text: { plainText: "" },
  };
}

describe("bulk roll", () => {
  let root: HTMLElement;
  beforeEach(() => {
    __testHooks.reset();
    __dicePlusTestHooks.reset();
    __testHooks.setRole("GM");
    __testHooks.setSelf("gm-1", "Adam");
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  it("counts only unrolled GM-controlled combatants", async () => {
    __testHooks.setItems([
      token("gob-a", "gm-1"),
      token("gob-b", "gm-1"),
      token("gob-rolled", "gm-1", 14),
      token("vex", "p-1"),
    ]);
    await mount(root);
    expect(root.querySelector("#fh-bulk")!.textContent).toContain("(2)");
  });

  it("requests every unrolled GM combatant in one message", async () => {
    __testHooks.setItems([
      token("gob-a", "gm-1"),
      token("gob-b", "gm-1"),
      token("gob-rolled", "gm-1", 14),
      token("vex", "p-1"),
    ]);
    await mount(root);
    root.querySelector<HTMLButtonElement>("#fh-bulk")!.click();
    const req = __testHooks.broadcasts.find((b) => b.channel === INTERNAL_ROLL_CHANNEL)!;
    const rolls = (req.data as { rolls: RollSpec[] }).rolls;
    expect(rolls.map((r) => r.itemId).sort()).toEqual(["gob-a", "gob-b"]);
  });

  it("never sweeps in a PC token", async () => {
    __testHooks.setItems([token("gob", "gm-1"), token("vex", "p-1")]);
    await mount(root);
    root.querySelector<HTMLButtonElement>("#fh-bulk")!.click();
    const req = __testHooks.broadcasts.find((b) => b.channel === INTERNAL_ROLL_CHANNEL)!;
    const rolls = (req.data as { rolls: RollSpec[] }).rolls;
    expect(rolls.map((r) => r.itemId)).toEqual(["gob"]);
  });

  it("disables the button when everything is already rolled", async () => {
    __testHooks.setItems([token("gob", "gm-1", 12)]);
    await mount(root);
    expect(root.querySelector<HTMLButtonElement>("#fh-bulk")!.disabled).toBe(true);
  });

  it("rolls each combatant in sequence, one dicex request at a time", async () => {
    __testHooks.setItems([token("a", "gm-1"), token("b", "gm-1"), token("c", "gm-1")]);

    // Distinct bonus per spec produces distinct dicex notation, so the fake
    // dicex below (modeled on dicePlus.test.ts's "serializes concurrent
    // rolls" test) can tell requests apart even though the wire payload
    // carries no itemId — and each combatant's stored initiative therefore
    // proves which roll it actually received, not merely a plausible number.
    const specs: RollSpec[] = [
      { itemId: "a", bonus: 0, mode: "normal" },
      { itemId: "b", bonus: 1, mode: "normal" },
      { itemId: "c", bonus: 2, mode: "normal" },
    ];
    const totals: Record<string, number> = { a: 11, b: 22, c: 33 };
    const idForNotation: Record<string, string> = {
      "1d20": "a",
      "1d20+1": "b",
      "1d20+2": "c",
    };

    // rollViaDicePlus's own module-level queue already serializes every
    // call it makes, independent of how handleRolls invokes it — so
    // counting dice-plus/roll-request broadcasts (or even their order and
    // wire-level overlap) can't prove handleRolls issues them one at a
    // time: a caller that fired all three concurrently would still see the
    // queue serialize them onto the wire in order. What a concurrent caller
    // can't hide is starting the next spec's roster read before the current
    // spec's result has landed, so this also tracks how many roster reads
    // (OBR.scene.items.getItems calls — one per spec, inside handleRolls)
    // have happened by the time each request arrives.
    const getItemsBaseline = OBR.scene.items.getItems.mock.calls.length;
    let inFlight = 0;
    let maxConcurrent = 0;
    const seenOrder: string[] = [];
    const rosterReadsAtArrival: number[] = [];

    OBR.broadcast.onMessage(DICE_PLUS_ROLL_REQUEST_CHANNEL, (ev) => {
      const req = ev.data as {
        rollId: string;
        source: string;
        diceNotation: string;
        playerId: string;
      };
      const id = idForNotation[req.diceNotation];
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      seenOrder.push(id);
      rosterReadsAtArrival.push(
        OBR.scene.items.getItems.mock.calls.length - getItemsBaseline,
      );
      // Reply on a later tick, so an unserialized implementation would
      // genuinely overlap instead of happening to pass by sheer synchrony.
      setTimeout(() => {
        inFlight -= 1;
        void OBR.broadcast.sendMessage(
          `${req.source}/roll-result`,
          {
            rollId: req.rollId,
            playerId: req.playerId,
            playerName: "Self",
            rollTarget: "everyone",
            result: {
              totalValue: totals[id],
              rollSummary: String(totals[id]),
              groups: [],
            },
          },
          { destination: "LOCAL" },
        );
      }, 0);
    });

    await handleRolls(specs);

    expect(seenOrder).toEqual(["a", "b", "c"]);
    expect(maxConcurrent).toBe(1);
    // Exactly one spec's roster read has happened by the time each request
    // goes out: the second and third specs aren't even started until the
    // previous one's result has been written back.
    expect(rosterReadsAtArrival).toEqual([1, 2, 3]);
    for (const id of ["a", "b", "c"]) {
      expect(__testHooks.getItem(id)!.metadata[F_INIT]).toBe(totals[id]);
    }
  });

  it("does not re-select a combatant whose roll was clamped to 1", async () => {
    __testHooks.setItems([token("unlucky", "gm-1")]);
    fakeDicex({ mode: "reply", total: 0 });
    await handleRolls([{ itemId: "unlucky", bonus: 0, mode: "normal" }]);
    expect(__testHooks.getItem("unlucky")!.metadata[F_INIT]).toBe(1);

    const root2 = document.createElement("div");
    document.body.appendChild(root2);
    await mount(root2);
    expect(root2.querySelector<HTMLButtonElement>("#fh-bulk")!.disabled).toBe(true);
  });

  it("excludes a clamped combatant from an actual bulk click while including an unrolled one", async () => {
    // main.ts's bulk click handler holds its own copy of the "init === 0"
    // predicate, independent of the one ui-list.ts uses to disable the
    // button. Asserting on #fh-bulk's disabled state alone (as above)
    // exercises only ui-list.ts's copy. Here we actually dispatch the click
    // and inspect the emitted rolls, so main.ts's copy is pinned too.
    __testHooks.setItems([token("unlucky", "gm-1"), token("fresh", "gm-1")]);
    fakeDicex({ mode: "reply", total: 0 });
    await handleRolls([{ itemId: "unlucky", bonus: 0, mode: "normal" }]);
    expect(__testHooks.getItem("unlucky")!.metadata[F_INIT]).toBe(1);

    const root2 = document.createElement("div");
    document.body.appendChild(root2);
    await mount(root2);
    // The button is enabled: "fresh" is still unrolled even though
    // "unlucky" is clamped.
    expect(root2.querySelector<HTMLButtonElement>("#fh-bulk")!.disabled).toBe(false);

    root2.querySelector<HTMLButtonElement>("#fh-bulk")!.click();
    const req = __testHooks.broadcasts
      .filter((b) => b.channel === INTERNAL_ROLL_CHANNEL)
      .pop()!;
    const rolls = (req.data as { rolls: RollSpec[] }).rolls;
    expect(rolls.map((r) => r.itemId)).toEqual(["fresh"]);
  });

  it("hides GM-only rolls while leaving a PC roll public", async () => {
    __testHooks.setItems([token("gob", "gm-1"), token("vex", "p-1")]);
    fakeDicex({ mode: "reply", total: 11 });
    await handleRolls([
      { itemId: "gob", bonus: 0, mode: "normal" },
      { itemId: "vex", bonus: 0, mode: "normal" },
    ]);
    const targets = __testHooks.broadcasts
      .filter((b) => b.channel === DICE_PLUS_ROLL_REQUEST_CHANNEL)
      .map((b) => (b.data as Record<string, unknown>).rollTarget);
    expect(targets).toEqual(["gm_only", "everyone"]);
  });
});
