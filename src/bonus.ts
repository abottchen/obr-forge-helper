import OBR from "@owlbear-rodeo/sdk";
import { OVERRIDE_KEY_PREFIX } from "./constants";

/**
 * 5e ability modifier. Hardcoded rather than read from Forge's `initmexp`
 * room setting: it is the only formula Forge ships with, and the override
 * box is the escape hatch for anything it does not capture.
 *
 * Returns 0 for absent or unparseable scores. The empty-string guard matters:
 * Number("") is 0, which would otherwise yield a -5 modifier.
 */
export function dexModifier(raw: unknown): number {
  const s = String(raw ?? "").trim();
  if (s === "") return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.floor((n - 10) / 2);
}

export function overrideKey(itemId: string): string {
  return `${OVERRIDE_KEY_PREFIX}${itemId}`;
}

export function itemIdFromOverrideKey(key: string): string {
  return key.slice(OVERRIDE_KEY_PREFIX.length);
}

export function readOverrides(
  metadata: Record<string, unknown>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!k.startsWith(OVERRIDE_KEY_PREFIX) || v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[itemIdFromOverrideKey(k)] = n;
  }
  return out;
}

export function resolveBonus(
  overrides: Record<string, number>,
  itemId: string,
  dexRaw: unknown,
): number {
  const o = overrides[itemId];
  return o !== undefined ? o : dexModifier(dexRaw);
}

/**
 * One key per token, so concurrent writers never touch the same key and
 * OBR's shallow metadata merge is sufficient. No locking needed.
 */
export async function writeOverride(
  itemId: string,
  bonus: number | null,
): Promise<void> {
  await OBR.room.setMetadata({ [overrideKey(itemId)]: bonus ?? undefined });
}

/** Drop overrides whose token has left the scene. GM-only, run at boot. */
export async function pruneOverrides(liveItemIds: Set<string>): Promise<void> {
  const md = await OBR.room.getMetadata();
  const patch: Record<string, undefined> = {};
  for (const k of Object.keys(md)) {
    if (!k.startsWith(OVERRIDE_KEY_PREFIX)) continue;
    if (!liveItemIds.has(itemIdFromOverrideKey(k))) patch[k] = undefined;
  }
  if (Object.keys(patch).length > 0) await OBR.room.setMetadata(patch);
}
