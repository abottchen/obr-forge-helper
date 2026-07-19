import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OBR, __testHooks, fakeDicex } from "./_mocks/obr-sdk";
import { rollViaDicePlus, __dicePlusTestHooks } from "../src/dicePlus";
import { EXTENSION_ID, DICE_PLUS_ROLL_REQUEST_CHANNEL } from "../src/constants";

describe("rollViaDicePlus", () => {
  beforeEach(() => {
    __testHooks.reset();
    __dicePlusTestHooks.reset();
  });
  afterEach(() => vi.useRealTimers());

  it("resolves with the dicex result", async () => {
    fakeDicex({ mode: "reply", total: 17 });
    const result = await rollViaDicePlus("1d20+3", "everyone");
    expect(result.totalValue).toBe(17);
  });

  it("sends a well-formed request addressed to the local player", async () => {
    fakeDicex({ mode: "reply", total: 5 });
    await rollViaDicePlus("1d20", "gm_only");
    const req = __testHooks.broadcasts.find(
      (b) => b.channel === DICE_PLUS_ROLL_REQUEST_CHANNEL,
    )!;
    const data = req.data as Record<string, unknown>;
    expect(req.destination).toBe("LOCAL");
    expect(data.source).toBe(EXTENSION_ID);
    expect(data.playerId).toBe("player-self");
    expect(data.rollTarget).toBe("gm_only");
    expect(data.diceNotation).toBe("1d20");
    expect(typeof data.rollId).toBe("string");
  });

  it("rejects with the dicex error message", async () => {
    fakeDicex({ mode: "error", message: "Invalid die type: d3" });
    await expect(rollViaDicePlus("1d3", "everyone")).rejects.toThrow(
      "Invalid die type: d3",
    );
  });

  it("ignores a result carrying someone else's rollId", async () => {
    vi.useFakeTimers();
    fakeDicex({ mode: "foreignId" });
    const p = rollViaDicePlus("1d20", "everyone");
    const assertion = expect(p).rejects.toThrow(/did not respond/);
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
  });

  it("times out when dicex never replies", async () => {
    vi.useFakeTimers();
    fakeDicex({ mode: "silent" });
    const p = rollViaDicePlus("1d20", "everyone");
    const assertion = expect(p).rejects.toThrow(/did not respond/);
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
  });

  it("serializes concurrent rolls so dicex never sees two at once", async () => {
    // Reply on a later tick, so an unserialized implementation would overlap.
    // Asserting on broadcast counts immediately after the calls would not work:
    // rollViaDicePlus schedules its work on the promise chain, so nothing has
    // been sent yet at that point.
    let inFlight = 0;
    let maxConcurrent = 0;
    const seen: string[] = [];
    OBR.broadcast.onMessage(DICE_PLUS_ROLL_REQUEST_CHANNEL, (ev) => {
      const req = ev.data as {
        rollId: string;
        source: string;
        diceNotation: string;
      };
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      seen.push(req.diceNotation);
      setTimeout(() => {
        inFlight -= 1;
        void OBR.broadcast.sendMessage(
          `${req.source}/roll-result`,
          {
            rollId: req.rollId,
            playerId: "player-self",
            playerName: "Self",
            rollTarget: "everyone",
            result: { totalValue: 7, rollSummary: "7", groups: [] },
          },
          { destination: "LOCAL" },
        );
      }, 0);
    });

    await Promise.all([
      rollViaDicePlus("1d20", "everyone"),
      rollViaDicePlus("1d20+1", "everyone"),
    ]);

    expect(seen).toEqual(["1d20", "1d20+1"]);
    expect(maxConcurrent).toBe(1);
  });

  it("keeps the queue alive after a rejection", async () => {
    const stop = fakeDicex({ mode: "error", message: "boom" });
    await expect(rollViaDicePlus("1d20", "everyone")).rejects.toThrow("boom");
    stop();
    fakeDicex({ mode: "reply", total: 11 });
    await expect(rollViaDicePlus("1d20", "everyone")).resolves.toMatchObject({
      totalValue: 11,
    });
  });

  it("survives a throwing teardown and keeps the queue alive", async () => {
    let callCount = 0;
    const subscriptions: Record<string, Array<(ev: { data: unknown; connectionId: string }) => void>> = {};

    vi.spyOn(OBR.broadcast, "onMessage").mockImplementation((channel, cb) => {
      callCount++;
      if (!subscriptions[channel]) subscriptions[channel] = [];
      subscriptions[channel].push(cb);

      // Make the second onMessage's unsubscribe throw (first result listener in rollOnce)
      if (callCount === 2) {
        return () => {
          throw new Error("Teardown failed");
        };
      }

      // Normal unsubscribe for other calls
      return () => {
        const arr = subscriptions[channel] ?? [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      };
    });

    // Patch sendMessage to use our subscriptions map
    vi.spyOn(OBR.broadcast, "sendMessage").mockImplementation(async (channel, data) => {
      for (const l of [...(subscriptions[channel] ?? [])]) {
        l({ data, connectionId: "test" });
      }
    });

    vi.useFakeTimers();
    fakeDicex({ mode: "silent" });
    const p1 = rollViaDicePlus("1d20", "everyone");
    const assertion1 = expect(p1).rejects.toThrow(/did not respond/);
    await vi.advanceTimersByTimeAsync(20000);
    await assertion1;

    vi.useRealTimers();

    // Verify the queue is still alive with a second roll
    fakeDicex({ mode: "reply", total: 13 });
    const result = await rollViaDicePlus("1d20", "everyone");
    expect(result.totalValue).toBe(13);
  });
});
