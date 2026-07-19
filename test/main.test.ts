import { describe, it, expect, beforeEach } from "vitest";
import { OBR, __testHooks } from "./_mocks/obr-sdk";
import { mount } from "../src/main";
import {
  F_ON_LIST,
  F_INIT,
  F_NAME,
  F_DEX,
  INTERNAL_ROLL_CHANNEL,
  INTERNAL_STATUS_CHANNEL,
  OVERRIDE_KEY_PREFIX,
} from "../src/constants";

function token(id: string, owner: string, init = 0, dex = "14") {
  return {
    id,
    name: id,
    createdUserId: owner,
    layer: "CHARACTER",
    metadata: { [F_ON_LIST]: true, [F_INIT]: init, [F_NAME]: id, [F_DEX]: dex },
    text: { plainText: "" },
  };
}

describe("mount", () => {
  let root: HTMLElement;
  beforeEach(() => {
    __testHooks.reset();
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  async function editInit(id: string, value: string): Promise<HTMLInputElement> {
    const badge = Array.from(root.querySelectorAll<HTMLElement>(".fh-init")).find(
      (b) => b.dataset.id === id,
    )!;
    badge.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    input.value = value;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    return input;
  }

  it("renders the roster for a player, hiding GM tokens", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([
      { id: "p-1", name: "Simon", role: "PLAYER" },
      { id: "gm-1", name: "Adam", role: "GM" },
    ]);
    __testHooks.setItems([token("grieg", "p-1"), token("goblin", "gm-1")]);
    await mount(root);
    expect(root.textContent).toContain("grieg");
    expect(root.textContent).not.toContain("goblin");
  });

  it("shows a blocked message instead of leaking GM-controlled tokens when the GM is disconnected", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    // No GM entry at all — resolveSession() cannot identify the GM, so
    // toCombatant() would otherwise mark every token (including the GM's
    // own monster) as gmControlled: false and dump it into the PC block.
    __testHooks.setParty([{ id: "p-1", name: "Simon", role: "PLAYER" }]);
    __testHooks.setItems([token("grieg", "p-1"), token("goblin", "gm-1")]);
    await mount(root);
    expect(root.textContent).toContain("Waiting for the GM to connect.");
    expect(root.textContent).not.toContain("goblin");
    expect(root.textContent).not.toContain("grieg");
  });

  it("recovers from the blocked state once the GM connects, via a re-resolved session", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "p-1", name: "Simon", role: "PLAYER" }]); // no GM yet
    __testHooks.setItems([token("grieg", "p-1")]);
    await mount(root);
    expect(root.textContent).toContain("Waiting for the GM to connect.");

    __testHooks.setParty([
      { id: "p-1", name: "Simon", role: "PLAYER" },
      { id: "gm-1", name: "Adam", role: "GM" },
    ]);
    await new Promise((r) => setTimeout(r, 0));

    expect(root.textContent).not.toContain("Waiting for the GM to connect.");
    expect(root.textContent).toContain("grieg");
  });

  it("shows the owning player's name next to the combatant", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([
      { id: "p-1", name: "Simon", role: "PLAYER" },
      { id: "gm-1", name: "Adam", role: "GM" },
    ]);
    __testHooks.setItems([token("grieg", "p-1")]);
    await mount(root);
    expect(root.querySelector(".fh-owner")!.textContent).toBe("Simon");
  });

  it("sends a one-element roll request when Roll is clicked", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1")]);
    await mount(root);
    root.querySelector<HTMLButtonElement>(".fh-roll")!.click();
    const req = __testHooks.broadcasts.find((b) => b.channel === INTERNAL_ROLL_CHANNEL)!;
    expect(req.destination).toBe("LOCAL");
    expect(req.data).toEqual({
      rolls: [{ itemId: "grieg", bonus: 2, mode: "normal" }],
    });
  });

  it("sends the selected mode with the roll", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1")]);
    await mount(root);
    root.querySelector<HTMLButtonElement>('.fh-mode[data-mode="advantage"]')!.click();
    root.querySelector<HTMLButtonElement>(".fh-roll")!.click();
    const req = __testHooks.broadcasts.find((b) => b.channel === INTERNAL_ROLL_CHANNEL)!;
    expect((req.data as { rolls: Array<{ mode: string }> }).rolls[0]!.mode).toBe(
      "advantage",
    );
  });

  it("persists an edited bonus as an override", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1")]);
    await mount(root);
    const input = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    input.value = "7";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    const md = await OBR.room.getMetadata();
    expect(md[`${OVERRIDE_KEY_PREFIX}grieg`]).toBe(7);
  });

  it("resets the mode to normal after rolling", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1")]);
    await mount(root);
    root.querySelector<HTMLButtonElement>('.fh-mode[data-mode="advantage"]')!.click();
    root.querySelector<HTMLButtonElement>(".fh-roll")!.click();
    const pressed = root.querySelector<HTMLButtonElement>(
      '.fh-mode[aria-pressed="true"]',
    )!;
    expect(pressed.dataset.mode).toBe("normal");
  });

  it("re-renders when a token's initiative changes", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1")]);
    await mount(root);
    expect(root.querySelector(".fh-init")!.textContent).toBe("—");
    __testHooks.setItems([token("grieg", "p-1", 18)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector(".fh-init")!.textContent).toBe("18");
  });

  it("marks a row as rolling when the background reports status", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1")]);
    await mount(root);
    await OBR.broadcast.sendMessage(
      INTERNAL_STATUS_CHANNEL,
      { itemId: "grieg", state: "rolling" },
      { destination: "LOCAL" },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector<HTMLElement>(".fh-row")!.dataset.state).toBe("rolling");
  });

  it("does not let a stale refresh overwrite a fresher one", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("a", "p-1")]);
    await mount(root);

    // Gate the *first* post-mount call to getItems() so that refresh #1
    // (triggered below) captures a 2-item snapshot but does not resolve
    // until released, while refresh #2 (also triggered below, ungated)
    // resolves normally with a 3-item snapshot in the meantime.
    const original = OBR.scene.items.getItems.getMockImplementation()!;
    let releaseStale: (() => void) | undefined;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    let callCount = 0;
    OBR.scene.items.getItems.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        const snapshot = await original();
        await staleGate;
        return snapshot;
      }
      return original();
    });

    try {
      __testHooks.setItems([token("a", "p-1"), token("b", "p-1")]); // refresh #1: stale, gated
      __testHooks.setItems([
        token("a", "p-1"),
        token("b", "p-1"),
        token("c", "p-1"),
      ]); // refresh #2: fresh, ungated

      await new Promise((r) => setTimeout(r, 0));
      expect(root.querySelectorAll(".fh-row").length).toBe(3);

      releaseStale!();
      await new Promise((r) => setTimeout(r, 0));

      // The stale refresh (2 items) resolved last in wall-clock time, but it
      // started before the fresh one (3 items) and must not win.
      expect(root.querySelectorAll(".fh-row").length).toBe(3);
    } finally {
      OBR.scene.items.getItems.mockImplementation(original);
    }
  });

  it("shows GM rows and the bulk button for the GM", async () => {
    __testHooks.setRole("GM");
    __testHooks.setSelf("gm-1");
    __testHooks.setItems([token("grieg", "p-1"), token("goblin", "gm-1")]);
    await mount(root);
    expect(root.textContent).toContain("goblin");
    expect(root.querySelector("#fh-bulk")).not.toBeNull();
  });

  it("gives players no bulk button", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1")]);
    await mount(root);
    expect(root.querySelector("#fh-bulk")).toBeNull();
  });

  it("keeps an override for a token that is in the scene but off Forge's initiative list", async () => {
    __testHooks.setRole("GM");
    __testHooks.setSelf("gm-1");
    const offListToken = token("goblin", "gm-1");
    offListToken.metadata[F_ON_LIST] = false;
    __testHooks.setItems([offListToken]);
    await OBR.room.setMetadata({ [`${OVERRIDE_KEY_PREFIX}goblin`]: 5 });

    await mount(root);
    // The GM-only prune runs fire-and-forget at the end of mount(); flush
    // the microtask queue so it has a chance to (wrongly) run to completion.
    await new Promise((r) => setTimeout(r, 0));

    const md = await OBR.room.getMetadata();
    expect(md[`${OVERRIDE_KEY_PREFIX}goblin`]).toBe(5);
  });

  it("clears the override, not a literal 0, when the bonus box is emptied", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1")]); // dex 14 -> prefill 2
    await mount(root);

    const input = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    input.value = "7";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect((await OBR.room.getMetadata())[`${OVERRIDE_KEY_PREFIX}grieg`]).toBe(7);

    const input2 = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    input2.value = "";
    input2.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const md = await OBR.room.getMetadata();
    expect(`${OVERRIDE_KEY_PREFIX}grieg` in md).toBe(false);
    const finalInput = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    expect(finalInput.value).toBe("2");
  });

  it("rejects a non-numeric bonus, keeping the previously stored override", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1")]); // dex 14 -> prefill 2
    await mount(root);

    const input = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    input.value = "7";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect((await OBR.room.getMetadata())[`${OVERRIDE_KEY_PREFIX}grieg`]).toBe(7);

    const input2 = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    input2.value = "3x";
    input2.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    // Number("3x") is NaN — must not fall through to a bogus override of 0.
    const md = await OBR.room.getMetadata();
    expect(md[`${OVERRIDE_KEY_PREFIX}grieg`]).toBe(7);
    const after = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    expect(after.value).toBe("7");
  });

  it("turns the initiative badge into an editor when clicked", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 12)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();

    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    expect(input.value).toBe("12");
    expect(document.activeElement).toBe(input);
  });

  it("ignores a click on an initiative the player may not edit", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("someone-else", "p-2", 12)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();

    expect(root.querySelector(".fh-init-edit")).toBeNull();
  });

  it("closes the editor on Escape without writing", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 12)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    input.value = "20";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(root.querySelector(".fh-init-edit")).toBeNull();
    expect(root.querySelector(".fh-init")!.textContent).toBe("12");
    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(12);
  });

  it("opens row B's editor when clicking from row A's open editor onto row B's badge, in real mousedown-before-click order", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([
      token("grieg", "p-1", 12),
      token("aria", "p-1", 8),
    ]);
    await mount(root);

    // Open row A's editor the ordinary way.
    root.querySelector<HTMLElement>('.fh-init[data-id="grieg"]')!.click();
    const rowA = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    expect(rowA.dataset.id).toBe("grieg");

    // Capture row B's badge before dispatching anything — with the bug, this
    // is the node that gets silently detached mid-sequence.
    const rowB = root.querySelector<HTMLElement>('.fh-init[data-id="aria"]')!;

    // Reproduce the real browser ordering for a click that lands on a
    // different element than the one currently focused: mousedown first
    // (its default action is what blurs row A's input), then focusout
    // bubbling from the now-blurred input, then click. A plain
    // `rowB.click()` only dispatches the synthetic `click` and never
    // reproduces the race this guards against.
    rowB.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    rowA.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    // mouseup always precedes click in the browser's native order (see
    // handlePointerUp) and clears pointerDownInFlight before click fires.
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    rowB.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const editors = root.querySelectorAll<HTMLInputElement>(".fh-init-edit");
    expect(editors.length).toBe(1);
    expect(editors[0]!.dataset.id).toBe("aria");
  });

  it("does not leave a stale editor in the DOM when the click after a suppressed close matches no branch", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 12)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const rowA = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    expect(rowA).not.toBeNull();

    // A row's name element matches none of handleClick's branches.
    const nameEl = root.querySelector<HTMLElement>(".fh-name")!;

    nameEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    rowA.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    // mouseup always precedes click in the browser's native order (see
    // handlePointerUp) and clears pointerDownInFlight before click fires.
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    nameEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(root.querySelector(".fh-init-edit")).toBeNull();
  });

  it("does not wedge the editor open forever when a mousedown inside the panel is never followed by a click reaching root", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 12)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    expect(input).not.toBeNull();

    // A mousedown lands inside the panel (sets pointerDownInFlight), but the
    // matching mouseup lands outside it — released after a drag off the
    // panel, a right-click, or the pointer leaving the window. None of these
    // ever produce a `click` that bubbles to root, so handleClick's own
    // clear never runs. Dispatching the mouseup on `window`, not on `root`,
    // is the point: a root-scoped listener would never see it either.
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    // With the flag still (wrongly) true, Escape's closeInitEditor() call
    // would clear model.editingInit but skip the render, leaving the stale
    // editor sitting in the DOM forever.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(root.querySelector(".fh-init-edit")).toBeNull();
  });

  it("closes the editor when focus leaves it untouched", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 12)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(root.querySelector(".fh-init-edit")).toBeNull();
    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(12);
  });

  it("writes the typed initiative to Forge on Enter alone", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 0)]);
    await mount(root);

    await editInit("grieg", "18");

    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(18);
    expect(root.querySelector(".fh-init-edit")).toBeNull();
    expect(root.querySelector(".fh-init")!.textContent).toBe("18");
  });

  // The whole point of handling Enter directly instead of relying on `change`:
  // the browser fires no change event when the value was never modified.
  it("writes even when the typed value matches what the box already held", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 12)]);
    await mount(root);

    const badge = root.querySelector<HTMLElement>(".fh-init")!;
    badge.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    expect(input.value).toBe("12"); // untouched
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(OBR.scene.items.updateItems).toHaveBeenCalledWith(
      ["grieg"],
      expect.any(Function),
    );
    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(12);
  });

  it("clears the initiative back to unrolled when the box is emptied", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 18)]);
    await mount(root);

    await editInit("grieg", "");

    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(0);
    expect(root.querySelector(".fh-init")!.textContent).toBe("—");
  });

  it("treats a typed 0 as a clear", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 18)]);
    await mount(root);

    await editInit("grieg", "0");

    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(0);
  });

  // A negative is a value the user meant, not a clear. Written through it
  // would read as unrolled and be swept into the next bulk roll, so it gets
  // the same floor of 1 the roll path applies.
  it("clamps a negative initiative to 1", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 18)]);
    await mount(root);

    await editInit("grieg", "-3");

    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(1);
  });

  // Math.trunc(-0.5) is -0, and -0 < 0 is false — a clamp that branches on
  // the truncated value instead of the parsed one would let this slip past
  // the negative check and write -0 (which Forge reads as unrolled) instead
  // of the floor of 1.
  it("clamps a fractional negative initiative to 1, not -0", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 18)]);
    await mount(root);

    await editInit("grieg", "-0.5");

    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(1);
  });

  it("truncates a fractional initiative", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 0)]);
    await mount(root);

    await editInit("grieg", "13.7");

    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(13);
  });

  it("rejects a non-numeric initiative, leaving the stored value alone", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 18)]);
    await mount(root);

    await editInit("grieg", "3x");

    // Number("3x") is NaN — must not fall through to a bogus 0.
    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(18);
    expect(root.querySelector(".fh-init")!.textContent).toBe("18");
  });

  it("writes once when Enter is followed by the blur it causes", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 0)]);
    await mount(root);

    const input = await editInit("grieg", "18");
    OBR.scene.items.updateItems.mockClear();
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(OBR.scene.items.updateItems).not.toHaveBeenCalled();
    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(18);
  });

  it("keeps a newer draft when an older write for the same field resolves after it", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1")]); // dex 14 -> prefill 2
    await mount(root);

    // Gate the second setMetadata call (the second edit's write) so it
    // stays in flight while the first edit's write resolves on its own,
    // reproducing "two quick edits to the same field" deterministically.
    const original = OBR.room.setMetadata.getMockImplementation()!;
    let releaseSecondWrite: (() => void) | undefined;
    const secondWriteGate = new Promise<void>((resolve) => {
      releaseSecondWrite = resolve;
    });
    let callCount = 0;
    OBR.room.setMetadata.mockImplementation((patch: Record<string, unknown>) => {
      callCount += 1;
      if (callCount === 2) return secondWriteGate.then(() => original(patch));
      return original(patch);
    });

    try {
      const input = root.querySelector<HTMLInputElement>(".fh-bonus")!;
      input.value = "5";
      input.dispatchEvent(new Event("change", { bubbles: true })); // write #1 (5), ungated

      input.value = "9";
      input.dispatchEvent(new Event("change", { bubbles: true })); // draft -> 9, write #2 (9) gated

      // Let write #1 resolve and its `.then()` fire, and let the refresh it
      // triggers render, all before write #2 has landed.
      await new Promise((r) => setTimeout(r, 0));

      const midInput = root.querySelector<HTMLInputElement>(".fh-bonus")!;
      expect(midInput.value).toBe("9");

      releaseSecondWrite!();
      await new Promise((r) => setTimeout(r, 0));

      const md = await OBR.room.getMetadata();
      expect(md[`${OVERRIDE_KEY_PREFIX}grieg`]).toBe(9);
    } finally {
      OBR.room.setMetadata.mockImplementation(original);
    }
  });
});
