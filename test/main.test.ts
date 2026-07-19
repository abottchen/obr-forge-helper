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

  // Not "no editor appears on the forbidden row" — renderRow's own `allowed`
  // gate already refuses to draw an editor for a token the viewer does not
  // own regardless of what handleClick does (see ui-list.test.ts's "refuses
  // to render an editor on a token the player does not own"), so that
  // assertion is satisfied even with handleClick's canRoll check deleted
  // entirely and proves nothing about the handler-side guard `CLAUDE.md`
  // calls load-bearing. What the handler-side check actually guards: without
  // it, a click on a forbidden badge still reassigns model.editingInit away
  // from whatever legitimate row was open and unconditionally re-renders,
  // silently discarding that in-progress edit even though nothing
  // permitted-looking ever appears on screen. Assert that survives instead.
  it("ignores a click on an initiative the player may not edit, without disturbing an editor already open elsewhere", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([
      token("mine", "p-1", 12),
      token("someone-else", "p-2", 8),
    ]);
    await mount(root);

    root.querySelector<HTMLElement>('.fh-init[data-id="mine"]')!.click();
    const before = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    expect(before.dataset.id).toBe("mine");

    root.querySelector<HTMLElement>('.fh-init[data-id="someone-else"]')!.click();

    expect(
      root.querySelector<HTMLInputElement>('.fh-init-edit[data-id="someone-else"]'),
    ).toBeNull();
    const after = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    expect(after).not.toBeNull();
    expect(after.dataset.id).toBe("mine");
  });

  // Finding 1's zombie-editor bug (a suppressed closeInitEditor leaving
  // model.editingInit null but the old input still attached) has two
  // call sites inside the .fh-init branch's early returns, plus the
  // no-branch-matched fallback at the end of handleClick. The test above
  // covers the permission check with a plain click; "does not leave a stale
  // editor..." below covers the fallback. This one drives the race that
  // actually lands on the permission-check early return itself, so all
  // three repaintStaleEditor() call sites have direct coverage.
  it("repaints a stale editor left by a suppressed close when the next click is denied by the permission check", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([
      token("mine", "p-1", 12),
      token("someone-else", "p-2", 8),
    ]);
    await mount(root);

    root.querySelector<HTMLElement>('.fh-init[data-id="mine"]')!.click();
    const editor = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    expect(editor.dataset.id).toBe("mine");

    const forbidden = root.querySelector<HTMLElement>(
      '.fh-init[data-id="someone-else"]',
    )!;

    // Real browser order (see the row-to-row test below): mousedown blurs
    // the open editor, firing focusout and suppressing closeInitEditor's
    // render (pointerDownInFlight is true) — model.editingInit is null but
    // the "mine" input is still attached by the time the click lands on a
    // badge the player may not touch, reaching the canRoll early return
    // itself rather than the no-branch-matched fallback.
    forbidden.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    forbidden.dispatchEvent(new MouseEvent("click", { bubbles: true }));

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

  // Escape must close immediately even while the mouse button is still
  // down (e.g. mid text-selection drag inside the box): unlike a
  // blur-family close (focusout, or the change a commit fires), Escape is
  // not part of a mousedown/click pair racing against a re-render, so it
  // must not wait for pointerDownInFlight to clear. Before this fix,
  // closeInitEditor had no notion of *why* it was closing and suppressed
  // every render while the flag was true, including Escape's — leaving the
  // box attached, focused, and silently discarding whatever was typed next.
  it("closes the editor on Escape immediately, even while the mouse button is still held down", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 12)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    input.value = "20";

    // Mouse button goes down inside the editor (starting a text-selection
    // drag) and stays down — no mouseup yet — while Escape is pressed.
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // The editor must be gone right away, without waiting for the mouseup
    // that finally releases the held button below.
    expect(root.querySelector(".fh-init-edit")).toBeNull();
    expect(root.querySelector(".fh-init")!.textContent).toBe("12");

    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

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

    // Reveal whether the flag actually cleared via a blur-family close, not
    // Escape: closeInitEditor("keyboard") (Escape's and Enter's reason) never
    // checks pointerDownInFlight at all, so it renders regardless of whether
    // the flag is stuck and would pass this test even with handlePointerUp
    // deleted, proving nothing about the listener under test. `focusout`
    // uses closeInitEditor("blur"), which does check the flag: with the flag
    // still (wrongly) true, its call would clear model.editingInit but skip
    // the render, leaving the stale editor sitting in the DOM forever.
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(root.querySelector(".fh-init-edit")).toBeNull();
  });

  // handlePointerUp's mouseup listener only catches releases; it never fires
  // once a native drag has actually started (e.g. dragging selected text out
  // of the box), because the browser stops dispatching mouse events entirely
  // for the rest of that gesture and fires `dragend` on release instead. The
  // native drag itself isn't reproducible in jsdom, but the fix is just
  // another window-scoped listener plus the same flag clear, and that much
  // is testable with the same synthetic-dispatch technique as the mouseup
  // wedge test above.
  it("does not wedge the editor open forever when a mousedown is followed by dragend instead of mouseup", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 12)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    expect(input).not.toBeNull();

    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.dispatchEvent(new Event("dragend"));

    // Same discriminator as the mouseup version above: `focusout` closes via
    // closeInitEditor("blur"), which does check the flag, so this only
    // passes if dragend actually cleared it.
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
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

    // Clear the mock *after* the setup click above (mount()/click() call no
    // scene-item methods, but this keeps the assertion below honest even if
    // that ever changes) and *before* the retype, so the call count below
    // can only be satisfied by the Enter this test is actually about.
    OBR.scene.items.updateItems.mockClear();
    input.value = "12"; // retyped, unchanged from what the box already held
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(OBR.scene.items.updateItems).toHaveBeenCalledTimes(1);
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

  // Reject paths write nothing, so unlike the success path (which self-heals
  // via the write's own scene-change refresh) nothing else was ever going to
  // repaint a stranded editor here. commitInit must therefore close with
  // Enter's own "keyboard" immediacy rather than the "blur" reason's gate —
  // see CloseReason and commitInit's doc comment in main.ts.
  it("closes immediately without writing when Enter commits invalid input while the mouse button is held", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 18)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    input.value = "3x";

    // Mouse button goes down inside the editor (starting a text-selection
    // drag) and stays down — no mouseup yet — while Enter commits the
    // invalid value.
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // The editor must be gone right away, without waiting for the mouseup
    // that finally releases the held button below — the same shape as the
    // Escape-while-held test above, now for Enter's reject path.
    expect(root.querySelector(".fh-init-edit")).toBeNull();
    expect(root.querySelector(".fh-init")!.textContent).toBe("18");

    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(18);
  });

  // NOTE: this does not test commitInit's `editingInit !== id` guard, despite
  // resembling a test that would. editInit()'s Enter already commits and
  // calls closeInitEditor(), which (pointerDownInFlight being false here)
  // renders — and renderList's innerHTML replacement detaches the very node
  // editInit() then returns. The `change`/`focusout` dispatched below target
  // that detached node: a bubbling event with no attached ancestor never
  // reaches root, so handleChange/handleFocusOut never run at all. The
  // assertion below passes because nothing ran, not because a guard stopped
  // anything — it would pass identically with commitInit's guard deleted.
  // What this test actually documents is the detachment itself: Enter's own
  // re-render removes the editor from the DOM, so no follow-on event —
  // guarded or not — can ever reach a handler through it. See "commitInit's
  // guard stops a second write..." below for a test that reaches the guard
  // on a node that is still attached.
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

  // A real click-away does not detach the input the way Enter's own
  // re-render does, so — unlike the false positive above — this genuinely
  // reaches live code on an attached node. But trace where the *second*
  // event actually goes: handleFocusOut calls closeInitEditor(), never
  // commitInit(). So this sequence exercises closeInitEditor's own
  // `editingInit === null` early return, not commitInit's `editingInit !==
  // id` guard — the two guards look alike but sit on different functions.
  // Kept because "exactly one write during an ordinary click-away" is a
  // real, valuable regression in its own right; see the test below for one
  // that actually reaches commitInit's guard on a live node.
  it("commits once during a click-away, via closeInitEditor's own idempotency check (not commitInit's guard — see below)", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 0)]);
    await mount(root);
    // updateItems is a module-level mock shared across every test in this
    // file and __testHooks.reset() does not clear vi.fn() call history —
    // only the earlier tests that assert an exact call count bother to
    // clear it first (see "writes once when Enter is followed by the blur
    // it causes"). Do the same here so this test's count isn't polluted by
    // whatever ran before it.
    OBR.scene.items.updateItems.mockClear();

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    input.value = "20";

    // The mousedown lands on the row's name label — anywhere inside root
    // other than the input qualifies (see pointerDownInFlight's
    // declaration) — reproducing a click away from the editor onto empty
    // panel space, the ordinary way an editor closes without a badge or
    // button underneath the pointer.
    const nameEl = root.querySelector<HTMLElement>(".fh-name")!;
    nameEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // If closeInitEditor had rendered on the commit above, this node would
    // already be detached and the focusout below would be a no-op that
    // proves nothing — the exact false positive this test replaces. Confirm
    // that did not happen before trusting what follows.
    expect(root.contains(input)).toBe(true);

    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(OBR.scene.items.updateItems).toHaveBeenCalledTimes(1);
    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(20);

    // Finish the click-away: mouseup clears pointerDownInFlight, then the
    // click that lands on no branch falls into handleClick's stale-editor
    // fallback and renders, closing the editor.
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    nameEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(root.querySelector(".fh-init-edit")).toBeNull();
  });

  // commitInit has exactly two call sites: handleKeyDown (Enter, reason
  // "keyboard") and handleChange (`change` on `.fh-init-edit`, reason
  // "blur") — handleFocusOut never calls it (see the test above). Since the
  // CloseReason fix, only a "blur"-reasoned commit can ever leave the editor
  // attached afterward — "keyboard" (Escape and Enter) never checks
  // pointerDownInFlight at all and always renders immediately, so two
  // successive Enters can no longer reach commitInit on the same still-live
  // node the way they used to: the first one's own render detaches it before
  // a second keydown could ever be dispatched on it. `change` is the one
  // event left that can leave the box attached while clearing
  // model.editingInit, so the only way to make commitInit re-enter itself on
  // a still-attached node is `change` followed by a second commit-triggering
  // event. Real-world trigger: the user starts a text-selection drag inside
  // the box (mousedown on the input itself — already focused, so this does
  // not blur it, only sets pointerDownInFlight), the box commits via
  // `change` without losing focus, and — before releasing the mouse
  // button — presses Enter on the still-attached box. The `change` commits
  // and clears model.editingInit, but closeInitEditor("blur") sees
  // pointerDownInFlight still true and skips its render, so the box stays
  // open, attached, and focused — exactly the state needed for the Enter's
  // keydown to reach handleKeyDown -> commitInit again with the same input,
  // where only the `editingInit !== id` check stops a second write. That
  // check runs before any reason-based render decision, so it stops this
  // "keyboard"-reasoned call just as it would a "blur"-reasoned one.
  it("commitInit's guard stops a second write when Enter reaches an editor a same-value change already committed and left attached", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 0)]);
    await mount(root);
    // See the mockClear() comment in the test above — same reason.
    OBR.scene.items.updateItems.mockClear();

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    input.value = "20";

    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    // The change's closeInitEditor("blur") call must have skipped its
    // render (pointerDownInFlight still true) for the Enter below to have
    // anywhere live to land. Confirm that before trusting what follows.
    expect(root.contains(input)).toBe(true);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(OBR.scene.items.updateItems).toHaveBeenCalledTimes(1);
    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(20);

    // Release the held mousedown and click away, so the panel ends in a
    // clean state like every other test.
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    root.querySelector<HTMLElement>(".fh-name")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(root.querySelector(".fh-init-edit")).toBeNull();
  });

  it("writes an edited initiative when focus leaves the box", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 0)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const input = root.querySelector<HTMLInputElement>(".fh-init-edit")!;
    input.value = "15";
    // What a real blur-with-modification emits, in order.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(15);
  });

  // The bonus box and the init editor both live in a row and both fire
  // `change`; the handler must not confuse them.
  it("still persists a bonus override while an init editor is open", async () => {
    __testHooks.setRole("PLAYER");
    __testHooks.setSelf("p-1");
    __testHooks.setParty([{ id: "gm-1", name: "Adam", role: "GM" }]);
    __testHooks.setItems([token("grieg", "p-1", 0)]);
    await mount(root);

    root.querySelector<HTMLElement>(".fh-init")!.click();
    const bonus = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    bonus.value = "7";
    bonus.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect((await OBR.room.getMetadata())[`${OVERRIDE_KEY_PREFIX}grieg`]).toBe(7);
    expect(__testHooks.getItem("grieg")!.metadata[F_INIT]).toBe(0);
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
