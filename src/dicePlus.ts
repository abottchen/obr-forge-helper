import OBR from "@owlbear-rodeo/sdk";
import {
  DICE_PLUS_ROLL_REQUEST_CHANNEL,
  ROLL_RESULT_CHANNEL,
  ROLL_ERROR_CHANNEL,
  EXTENSION_ID,
  ROLL_TIMEOUT_MS,
} from "./constants";
import type {
  RollTarget,
  RollRequest,
  DicePlusResult,
  RollResultMessage,
  RollErrorMessage,
} from "./types";

/**
 * dicex tracks a single pending Dice+ request in a module global, so a second
 * roll overwrites the first's routing and the first requester never hears
 * back. Serialize through a promise chain.
 *
 * Scope is per client: our request is LOCAL and dicex ignores requests not
 * addressed to the local player, so two players rolling simultaneously never
 * touch the same state. This queue exists only for same-client concurrency —
 * the GM rolling several monsters, or a player who owns two tokens.
 */
let queue: Promise<unknown> = Promise.resolve();

export function rollViaDicePlus(
  notation: string,
  rollTarget: RollTarget,
): Promise<DicePlusResult> {
  const run = () => rollOnce(notation, rollTarget);
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function rollOnce(
  notation: string,
  rollTarget: RollTarget,
): Promise<DicePlusResult> {
  return new Promise<DicePlusResult>((resolve, reject) => {
    const rollId = crypto.randomUUID();
    const teardowns: Array<() => void> = [];
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      try {
        for (const t of teardowns) {
          try {
            t();
          } catch (err) {
            console.warn("[forge-helper] Teardown failed:", err);
          }
        }
      } finally {
        // Settling is more important than clean teardown: an unsettled roll
        // blocks every subsequent roll in the queue for the rest of the session.
        fn();
      }
    };

    // dicex clears its pending slot only on success, so a stale request can
    // attach to the user's next manual tray roll and deliver that result
    // here. Never trust a result whose rollId is not ours.
    teardowns.push(
      OBR.broadcast.onMessage(ROLL_RESULT_CHANNEL, (event) => {
        const data = event.data as RollResultMessage;
        if (data?.rollId !== rollId) return;
        finish(() => resolve(data.result));
      }),
    );

    teardowns.push(
      OBR.broadcast.onMessage(ROLL_ERROR_CHANNEL, (event) => {
        const data = event.data as RollErrorMessage;
        if (data?.rollId !== rollId) return;
        finish(() => reject(new Error(data.error)));
      }),
    );

    // A malformed request, or one addressed to another player, is dropped
    // silently. This timeout is the only backstop.
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            "dicex did not respond (is the dicex extension installed and this tab active?)",
          ),
        ),
      );
    }, ROLL_TIMEOUT_MS);
    teardowns.push(() => clearTimeout(timer));

    void (async () => {
      try {
        const playerName = await OBR.player.getName();
        // Typed, so a missing or misnamed field is a compile error. dicex
        // validates with isRollRequest() and silently drops anything that
        // fails — no error comes back, only a 20s timeout.
        const payload: RollRequest = {
          rollId,
          // dicex drops the request unless this is the local player.
          playerId: OBR.player.id,
          playerName,
          rollTarget,
          diceNotation: notation,
          showResults: true,
          timestamp: Date.now(),
          // Echoed back as the response channel prefix, and matched against
          // dicex's TRUSTED_ROLL_TARGET_SOURCES to decide visibility.
          source: EXTENSION_ID,
        };
        await OBR.broadcast.sendMessage(DICE_PLUS_ROLL_REQUEST_CHANNEL, payload, {
          destination: "LOCAL",
        });
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    })();
  });
}

export const __dicePlusTestHooks = {
  reset(): void {
    queue = Promise.resolve();
  },
};
