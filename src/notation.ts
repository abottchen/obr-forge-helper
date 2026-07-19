import type { RollMode } from "./types";

/**
 * Build dicex notation for an initiative roll.
 *
 * Advantage and disadvantage are expressed purely in notation; the Dice+
 * protocol has no advantage field. dicex returns both d20 faces, marking the
 * discarded one `kept: false`.
 */
export function buildNotation(mode: RollMode, bonus: number): string {
  const base =
    mode === "advantage"
      ? "2d20kh1"
      : mode === "disadvantage"
        ? "2d20kl1"
        : "1d20";
  if (bonus === 0) return base;
  return bonus > 0 ? `${base}+${bonus}` : `${base}-${Math.abs(bonus)}`;
}
