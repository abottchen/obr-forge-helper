import { describe, it, expect } from "vitest";
import {
  EXTENSION_ID,
  OVERRIDE_KEY_PREFIX,
  ROLL_RESULT_CHANNEL,
  ROLL_ERROR_CHANNEL,
  DICE_PLUS_ROLL_REQUEST_CHANNEL,
  F_ON_LIST,
  F_INIT,
  F_NAME,
  F_DEX,
} from "../src/constants";

describe("constants", () => {
  it("pins EXTENSION_ID to the value on dicex's TRUSTED_ROLL_TARGET_SOURCES allowlist", () => {
    // dicex src/plugin/dicePlusProtocol.ts matches this string exactly.
    // Changing it silently downgrades every PC roll to hidden, with no error.
    expect(EXTENSION_ID).toBe("com.abottchen.obr-forge-helper");
  });

  it("derives response channels from the extension id", () => {
    expect(ROLL_RESULT_CHANNEL).toBe("com.abottchen.obr-forge-helper/roll-result");
    expect(ROLL_ERROR_CHANNEL).toBe("com.abottchen.obr-forge-helper/roll-error");
  });

  it("uses the dice-plus request channel verbatim", () => {
    expect(DICE_PLUS_ROLL_REQUEST_CHANNEL).toBe("dice-plus/roll-request");
  });

  it("namespaces overrides under our own id", () => {
    expect(OVERRIDE_KEY_PREFIX).toBe("com.abottchen.obr-forge-helper/v1/bonus/");
  });

  it("uses Forge's exact metadata keys", () => {
    expect(F_ON_LIST).toBe("com.battle-system.forge/on-list");
    expect(F_INIT).toBe("com.battle-system.forge/init");
    expect(F_NAME).toBe("com.battle-system.forge/name");
    expect(F_DEX).toBe("com.battle-system.forge/Z018");
  });
});
