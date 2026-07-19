import OBR from "@owlbear-rodeo/sdk";
import { F_ON_LIST, F_INIT, F_NAME, F_DEX } from "./constants";
import type { Combatant } from "./types";

/** The structural subset of an OBR item this module needs. */
export interface ForgeItem {
  id: string;
  name: string;
  createdUserId: string;
  metadata: Record<string, unknown>;
  text?: { plainText?: string };
}

function isOnList(item: ForgeItem): boolean {
  return item.metadata[F_ON_LIST] === true;
}

/**
 * Forge name, then the on-board label, then the item name. Many tokens share
 * one stat block name but carry distinct board labels ("Robust Goblin"), so
 * the fallback order matters for telling duplicates apart.
 */
export function combatantName(item: ForgeItem): string {
  const forgeName = item.metadata[F_NAME];
  if (typeof forgeName === "string" && forgeName.trim() !== "") return forgeName;
  const plain = item.text?.plainText;
  if (typeof plain === "string" && plain.trim() !== "") return plain;
  return item.name;
}

export function toCombatant(item: ForgeItem, gmId: string | null): Combatant {
  const rawInit = item.metadata[F_INIT];
  return {
    id: item.id,
    name: combatantName(item),
    ownerId: item.createdUserId,
    gmControlled: gmId !== null && item.createdUserId === gmId,
    init: typeof rawInit === "number" ? rawInit : 0,
    dexRaw: item.metadata[F_DEX],
  };
}

/**
 * Forge stores no encounter object. The roster is every scene item flagged
 * `on-list`, so it is derived fresh on every read.
 */
export async function readRoster(gmId: string | null): Promise<Combatant[]> {
  const items = (await OBR.scene.items.getItems()) as unknown as ForgeItem[];
  return items.filter(isOnList).map((i) => toCombatant(i, gmId));
}

/**
 * Write Forge's `init` verbatim. 0 is Forge's "unrolled", so this is the
 * entry point for manual entry, which needs to be able to clear a value.
 * Roll results go through writeInit() instead.
 */
export async function setInit(itemId: string, value: number): Promise<void> {
  await OBR.scene.items.updateItems([itemId], (drafts: ForgeItem[]) => {
    for (const d of drafts) d.metadata[F_INIT] = value;
  });
}

/**
 * The roll path. Clamped to 1 because Forge reads 0 as "unrolled": a natural
 * 1 with a negative modifier would otherwise be swept into the next bulk roll
 * and overwrite itself. dicex has already logged the true total by this
 * point, so the roll record stays honest.
 */
export async function writeInit(itemId: string, total: number): Promise<void> {
  await setInit(itemId, Math.max(1, total));
}
