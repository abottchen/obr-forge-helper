import { describe, it, expect, beforeEach } from "vitest";
import { OBR, __testHooks } from "./_mocks/obr-sdk";

describe("test harness", () => {
  beforeEach(() => __testHooks.reset());

  it("round-trips room metadata", async () => {
    await OBR.room.setMetadata({ foo: 1 });
    expect(await OBR.room.getMetadata()).toEqual({ foo: 1 });
  });

  it("round-trips scene items", async () => {
    __testHooks.setItems([
      { id: "a", name: "A", createdUserId: "u1", layer: "CHARACTER", metadata: {} },
    ]);
    const items = await OBR.scene.items.getItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("a");
  });
});
