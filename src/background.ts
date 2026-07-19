import OBR from "@owlbear-rodeo/sdk";
import { INTERNAL_ROLL_CHANNEL, INTERNAL_STATUS_CHANNEL } from "./constants";
import type {
  InternalRollMessage,
  InternalStatusMessage,
  RollSpec,
} from "./types";
import { buildNotation } from "./notation";
import { rollViaDicePlus } from "./dicePlus";
import { readRoster, writeInit } from "./forge";
import { resolveSession } from "./session";

function status(msg: InternalStatusMessage): void {
  void OBR.broadcast
    .sendMessage(INTERNAL_STATUS_CHANNEL, msg, { destination: "LOCAL" })
    .catch(() => {
      /* the popover may be closed; status is advisory only */
    });
}

function notify(message: string): void {
  // No optional chaining: `notification.show` is non-optional in the SDK's
  // types, so `?.` here would only ever mask a genuine failure by
  // short-circuiting to a silent no-op — defeating the one channel the rest
  // of this module relies on to guarantee the user hears about a failure.
  OBR.notification.show(message, "ERROR").catch((err) => {
    console.warn("[forge-helper] notification.show failed", err);
  });
}

/**
 * Roll each spec in turn and write the result to Forge.
 *
 * Runs in the background page because dicex calls OBR.action.open() on every
 * roll, which unmounts the popover: a pipeline living there would die after
 * the first roll of a batch.
 *
 * Everything below is inside a single try/catch: resolveSession() and
 * readRoster() can throw just like the per-spec roll itself, and the popover
 * has already optimistically marked every requested row "rolling" before
 * this function is ever invoked. A throw here must still (a) reach the user
 * via notify() — the only channel guaranteed to exist, since the popover
 * that requested the roll is usually gone by the time it completes — and
 * (b) clear those rows' stuck "rolling" state via a status broadcast, or
 * their Roll buttons stay disabled for the rest of the session.
 */
export async function handleRolls(specs: RollSpec[]): Promise<void> {
  const failures: string[] = [];
  const settled = new Set<string>();

  try {
    const session = await resolveSession();

    for (const spec of specs) {
      // Re-read per roll so visibility is derived from live item data. A popover
      // rendered before a token was reassigned must not be able to make a
      // monster's roll public.
      const roster = await readRoster(session.gmId);
      const combatant = roster.find((c) => c.id === spec.itemId);
      if (!combatant) {
        const message = "no longer on the initiative list";
        failures.push(`${spec.itemId}: ${message}`);
        status({ itemId: spec.itemId, state: "error", message });
        settled.add(spec.itemId);
        continue;
      }

      status({ itemId: spec.itemId, state: "rolling" });
      try {
        const result = await rollViaDicePlus(
          buildNotation(spec.mode, spec.bonus),
          combatant.gmControlled ? "gm_only" : "everyone",
        );
        await writeInit(spec.itemId, result.totalValue);
        status({ itemId: spec.itemId, state: "ok" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push(`${combatant.name}: ${message}`);
        status({ itemId: spec.itemId, state: "error", message });
      }
      settled.add(spec.itemId);
    }
  } catch (e) {
    // A dependency shared by the whole batch (resolveSession, readRoster)
    // threw outside the per-spec try above. Only the specs that never got a
    // status of their own are still stuck "rolling" in the popover.
    const message = e instanceof Error ? e.message : String(e);
    failures.push(`initiative roll failed: ${message}`);
    for (const spec of specs) {
      if (settled.has(spec.itemId)) continue;
      status({ itemId: spec.itemId, state: "error", message });
    }
  }

  if (failures.length > 0) {
    notify(`Initiative roll failed — ${failures.join("; ")}`);
  }
}

export function startBackground(): void {
  OBR.broadcast.onMessage(INTERNAL_ROLL_CHANNEL, (event) => {
    const msg = event.data as InternalRollMessage;
    if (!msg || !Array.isArray(msg.rolls) || msg.rolls.length === 0) return;
    // handleRolls is expected to swallow its own failures via notify()
    // above, but this .catch is the last line of defense against an
    // unhandled rejection if it ever doesn't.
    void handleRolls(msg.rolls).catch((e) =>
      console.warn("[forge-helper] handleRolls failed", e),
    );
  });
}

OBR.onReady(() => {
  startBackground();
});
