export type RollMode = "normal" | "advantage" | "disadvantage";

/** dicex's RollTarget union, copied from its dicePlusProtocol.ts. */
export type RollTarget = "everyone" | "self" | "dm" | "gm_only";

/** Outbound Dice+ roll request payload. Shape mirrored from dicex's dicePlusProtocol.ts.
 *  dicex validates incoming requests with `isRollRequest()` and silently drops malformed ones.
 */
export interface RollRequest {
  rollId: string;
  playerId: string;
  playerName: string;
  rollTarget: RollTarget;
  diceNotation: string;
  showResults: boolean;
  timestamp: number;
  /** Requester's extension id; used as the prefix for response channels. */
  source: string;
}

export interface Combatant {
  id: string;
  name: string;
  /** OBR item `createdUserId`. Rewritten when a token is reassigned, so it means "current owner". */
  ownerId: string;
  gmControlled: boolean;
  /** Forge's `init`. 0 means unrolled. */
  init: number;
  /** Raw Z018 value, string or number or absent. Coerced by dexModifier(). */
  dexRaw: unknown;
}

export interface RollSpec {
  itemId: string;
  bonus: number;
  mode: RollMode;
}

/** Popover -> background. A single Roll click sends a one-element array. */
export interface InternalRollMessage {
  rolls: RollSpec[];
}

export interface InternalStatusMessage {
  itemId: string;
  state: "rolling" | "ok" | "error";
  message?: string;
}

export interface DicePlusDie {
  value: number;
  kept: boolean;
}

export interface DicePlusGroup {
  description: string;
  diceType: string;
  dice: DicePlusDie[];
  total: number;
  isNegative: boolean;
}

export interface DicePlusResult {
  totalValue: number;
  rollSummary: string;
  groups: DicePlusGroup[];
}

export interface RollResultMessage {
  rollId: string;
  playerId: string;
  playerName: string;
  rollTarget: RollTarget;
  result: DicePlusResult;
}

export interface RollErrorMessage {
  rollId: string;
  error: string;
  notation: string;
}
