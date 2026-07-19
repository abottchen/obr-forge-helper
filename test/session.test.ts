import { describe, it, expect, beforeEach } from "vitest";
import { __testHooks } from "./_mocks/obr-sdk";
import { resolveSession } from "../src/session";

describe("resolveSession", () => {
  beforeEach(() => __testHooks.reset());

  it("uses the local player id as the GM id when we are the GM", async () => {
    __testHooks.setRole("GM");
    __testHooks.setSelf("gm-1");
    const s = await resolveSession();
    expect(s).toEqual({ selfId: "gm-1", isGm: true, gmId: "gm-1" });
  });

  it("finds the GM in the party when we are a player", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([
      { id: "p-1", name: "Simon", role: "PLAYER" },
      { id: "gm-1", name: "Adam", role: "GM" },
    ]);
    const s = await resolveSession();
    expect(s).toEqual({ selfId: "p-1", isGm: false, gmId: "gm-1" });
  });

  it("yields a null gmId when the GM is disconnected", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "p-1", name: "Simon", role: "PLAYER" }]);
    const s = await resolveSession();
    expect(s.gmId).toBeNull();
  });
});
