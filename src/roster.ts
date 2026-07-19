import type { Combatant } from "./types";

export interface RosterView {
  pcs: Combatant[];
  gms: Combatant[];
}

/** Initiative descending, with unrolled (init 0) combatants last. */
export function sortCombatants(list: Combatant[]): Combatant[] {
  return [...list].sort((a, b) => {
    const aUnrolled = a.init === 0;
    const bUnrolled = b.init === 0;
    if (aUnrolled !== bUnrolled) return aUnrolled ? 1 : -1;
    return b.init - a.init;
  });
}

/**
 * Split into the shared PC block and the GM-only block. Sorting is applied
 * within each block, never across them, so the divider stays meaningful.
 */
export function buildRosterView(all: Combatant[], isGm: boolean): RosterView {
  return {
    pcs: sortCombatants(all.filter((c) => !c.gmControlled)),
    gms: isGm ? sortCombatants(all.filter((c) => c.gmControlled)) : [],
  };
}

/**
 * Players roll only tokens they own, which keeps every write inside
 * CHARACTER_OWNER_ONLY. The GM rolls anything, covering absent players.
 */
export function canRoll(c: Combatant, selfId: string, isGm: boolean): boolean {
  return isGm || c.ownerId === selfId;
}
