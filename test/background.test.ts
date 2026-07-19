import { describe, it, expect, beforeEach, vi } from "vitest";
import { OBR, __testHooks, fakeDicex, notifications } from "./_mocks/obr-sdk";
import { handleRolls, startBackground } from "../src/background";
import { __dicePlusTestHooks } from "../src/dicePlus";
import {
  F_ON_LIST,
  F_INIT,
  F_NAME,
  F_DEX,
  INTERNAL_ROLL_CHANNEL,
  INTERNAL_STATUS_CHANNEL,
  DICE_PLUS_ROLL_REQUEST_CHANNEL,
} from "../src/constants";

function token(id: string, owner: string, dex = "14") {
  return {
    id,
    name: id,
    createdUserId: owner,
    layer: "CHARACTER",
    metadata: { [F_ON_LIST]: true, [F_INIT]: 0, [F_NAME]: id, [F_DEX]: dex },
    text: { plainText: "" },
  };
}

describe("handleRolls", () => {
  beforeEach(() => {
    __testHooks.reset();
    __dicePlusTestHooks.reset();
    __testHooks.setRole("GM");
    __testHooks.setSelf("gm-1", "Adam");
  });

  it("writes the rolled initiative to Forge", async () => {
    __testHooks.setItems([token("goblin", "gm-1")]);
    fakeDicex({ mode: "reply", total: 14 });
    await handleRolls([{ itemId: "goblin", bonus: 2, mode: "normal" }]);
    expect(__testHooks.getItem("goblin")!.metadata[F_INIT]).toBe(14);
  });

  it("sends gm_only for a GM-controlled token", async () => {
    __testHooks.setItems([token("goblin", "gm-1")]);
    fakeDicex({ mode: "reply", total: 9 });
    await handleRolls([{ itemId: "goblin", bonus: 0, mode: "normal" }]);
    const req = __testHooks.broadcasts.find(
      (b) => b.channel === DICE_PLUS_ROLL_REQUEST_CHANNEL,
    )!;
    expect((req.data as Record<string, unknown>).rollTarget).toBe("gm_only");
  });

  it("sends everyone for a PC token, even when the GM rolls it", async () => {
    __testHooks.setItems([token("vex", "p-1")]);
    fakeDicex({ mode: "reply", total: 9 });
    await handleRolls([{ itemId: "vex", bonus: 0, mode: "normal" }]);
    const req = __testHooks.broadcasts.find(
      (b) => b.channel === DICE_PLUS_ROLL_REQUEST_CHANNEL,
    )!;
    expect((req.data as Record<string, unknown>).rollTarget).toBe("everyone");
  });

  it("builds notation from the requested mode and bonus", async () => {
    __testHooks.setItems([token("goblin", "gm-1")]);
    fakeDicex({ mode: "reply", total: 9 });
    await handleRolls([{ itemId: "goblin", bonus: 3, mode: "advantage" }]);
    const req = __testHooks.broadcasts.find(
      (b) => b.channel === DICE_PLUS_ROLL_REQUEST_CHANNEL,
    )!;
    expect((req.data as Record<string, unknown>).diceNotation).toBe("2d20kh1+3");
  });

  it("emits rolling then ok status for a successful roll", async () => {
    __testHooks.setItems([token("goblin", "gm-1")]);
    fakeDicex({ mode: "reply", total: 9 });
    await handleRolls([{ itemId: "goblin", bonus: 0, mode: "normal" }]);
    const states = __testHooks.broadcasts
      .filter((b) => b.channel === INTERNAL_STATUS_CHANNEL)
      .map((b) => (b.data as Record<string, unknown>).state);
    expect(states).toEqual(["rolling", "ok"]);
  });

  it("notifies on failure even with no status listener attached", async () => {
    __testHooks.setItems([token("goblin", "gm-1")]);
    fakeDicex({ mode: "error", message: "boom" });
    await handleRolls([{ itemId: "goblin", bonus: 0, mode: "normal" }]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.message).toContain("boom");
    expect(notifications[0]!.level).toBe("ERROR");
  });

  it("continues the batch past a failing combatant", async () => {
    __testHooks.setItems([token("a", "gm-1"), token("b", "gm-1")]);
    let calls = 0;
    OBR.broadcast.onMessage(DICE_PLUS_ROLL_REQUEST_CHANNEL, (ev) => {
      const req = ev.data as { rollId: string; source: string; diceNotation: string };
      calls += 1;
      const channel = calls === 1 ? `${req.source}/roll-error` : `${req.source}/roll-result`;
      const payload =
        calls === 1
          ? { rollId: req.rollId, error: "first failed", notation: req.diceNotation }
          : {
              rollId: req.rollId,
              playerId: "gm-1",
              playerName: "Adam",
              rollTarget: "gm_only",
              result: {
                totalValue: 12,
                rollSummary: "12",
                groups: [],
              },
            };
      void OBR.broadcast.sendMessage(channel, payload, { destination: "LOCAL" });
    });
    await handleRolls([
      { itemId: "a", bonus: 0, mode: "normal" },
      { itemId: "b", bonus: 0, mode: "normal" },
    ]);
    expect(__testHooks.getItem("b")!.metadata[F_INIT]).toBe(12);
    expect(__testHooks.getItem("a")!.metadata[F_INIT]).toBe(0);
  });

  it("skips a combatant that has left the initiative list", async () => {
    __testHooks.setItems([]);
    fakeDicex({ mode: "reply", total: 9 });
    await handleRolls([{ itemId: "ghost", bonus: 0, mode: "normal" }]);
    const requests = __testHooks.broadcasts.filter(
      (b) => b.channel === DICE_PLUS_ROLL_REQUEST_CHANNEL,
    );
    expect(requests).toHaveLength(0);
    expect(notifications).toHaveLength(1);
  });

  it("notifies and clears the row's stuck status instead of dying silently when a shared dependency throws", async () => {
    __testHooks.setItems([token("goblin", "gm-1")]);
    // resolveSession() is called once, ahead of the per-spec loop; a throw
    // here previously aborted handleRolls as an unhandled rejection with no
    // notification and no status update, leaving the popover's optimistic
    // "rolling" row (set at click time, before the background is ever
    // invoked) disabled for the rest of the session.
    OBR.player.getRole.mockImplementationOnce(async () => {
      throw new Error("role fetch failed");
    });

    await expect(
      handleRolls([{ itemId: "goblin", bonus: 0, mode: "normal" }]),
    ).resolves.toBeUndefined();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.message).toContain("role fetch failed");
    const states = __testHooks.broadcasts
      .filter((b) => b.channel === INTERNAL_STATUS_CHANNEL)
      .map((b) => (b.data as Record<string, unknown>).state);
    expect(states).toContain("error");
  });

  it("still notifies when invoked the way production does, through the roll-request broadcast listener", async () => {
    // The module's own `OBR.onReady(() => startBackground())` only fires
    // once, at import time — __testHooks.reset() (in beforeEach) wipes the
    // listener it registered along with everything else, so it must be
    // re-registered here to exercise the real
    // `void handleRolls(...).catch(...)` call site rather than calling
    // handleRolls() directly.
    startBackground();
    __testHooks.setItems([token("goblin", "gm-1")]);
    OBR.player.getRole.mockImplementationOnce(async () => {
      throw new Error("role fetch failed");
    });

    await OBR.broadcast.sendMessage(
      INTERNAL_ROLL_CHANNEL,
      { rolls: [{ itemId: "goblin", bonus: 0, mode: "normal" }] },
      { destination: "LOCAL" },
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(notifications).toHaveLength(1);
  });

  it("logs to the console when the notification channel itself rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      __testHooks.setItems([token("goblin", "gm-1")]);
      OBR.notification.show.mockRejectedValueOnce(new Error("notify channel down"));
      fakeDicex({ mode: "error", message: "boom" });

      await handleRolls([{ itemId: "goblin", bonus: 0, mode: "normal" }]);
      await new Promise((r) => setTimeout(r, 0));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[forge-helper]"),
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
