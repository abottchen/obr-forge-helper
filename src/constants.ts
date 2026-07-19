/**
 * Reverse-DNS extension id.
 *
 * This exact string appears in dicex's TRUSTED_ROLL_TARGET_SOURCES
 * (src/plugin/dicePlusProtocol.ts). Only requests whose `source` is on that
 * allowlist may produce a visible roll. Renaming this silently makes every
 * player's initiative roll private, with no error anywhere.
 */
export const EXTENSION_ID = "com.abottchen.obr-forge-helper";

/** Per-token initiative bonus overrides live in room metadata under this prefix. */
export const OVERRIDE_KEY_PREFIX = `${EXTENSION_ID}/v1/bonus/`;

/** Popover -> background: request one or more rolls. */
export const INTERNAL_ROLL_CHANNEL = `${EXTENSION_ID}/internal-roll`;
/** Background -> popover: per-combatant progress, rendered only if the popover is open. */
export const INTERNAL_STATUS_CHANNEL = `${EXTENSION_ID}/internal-status`;

/** dicex echoes our `source` as the prefix of both response channels. */
export const ROLL_RESULT_CHANNEL = `${EXTENSION_ID}/roll-result`;
export const ROLL_ERROR_CHANNEL = `${EXTENSION_ID}/roll-error`;
export const DICE_PLUS_ROLL_REQUEST_CHANNEL = "dice-plus/roll-request";

export const FORGE = "com.battle-system.forge/";
export const F_ON_LIST = `${FORGE}on-list`;
export const F_INIT = `${FORGE}init`;
export const F_NAME = `${FORGE}name`;
/** Dexterity score. String on some tokens, number on others. */
export const F_DEX = `${FORGE}Z018`;

/**
 * dicex runs a 2s handshake and then a full 3D physics animation, so the
 * budget must be generous. It is also the only backstop: a request dicex
 * rejects produces no reply at all.
 */
export const ROLL_TIMEOUT_MS = 20000;
