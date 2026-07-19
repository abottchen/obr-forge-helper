import { describe, it, expect, beforeEach } from "vitest";
import { renderList, type ListModel } from "../src/ui-list";
import type { Combatant } from "../src/types";

function c(over: Partial<Combatant> & { id: string }): Combatant {
  return {
    name: over.id,
    ownerId: "owner",
    gmControlled: false,
    init: 0,
    dexRaw: 14,
    ...over,
  };
}

function model(over: Partial<ListModel> = {}): ListModel {
  return {
    view: { pcs: [], gms: [] },
    selfId: "p-1",
    isGm: false,
    // Defaults to a connected GM so existing scenarios below aren't
    // incidentally blocked; the null case is exercised explicitly.
    gmId: "gm-1",
    overrides: {},
    modes: new Map(),
    drafts: new Map(),
    statuses: new Map(),
    ownerNames: new Map(),
    ...over,
  };
}

describe("renderList", () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    // Appended so focus() works — the focus-preservation tests need it.
    document.body.appendChild(root);
  });

  it("shows an empty state when nobody is on the list", () => {
    renderList(root, model());
    expect(root.textContent).toContain("No combatants on Forge's initiative list");
  });

  it("blocks the roster instead of listing anyone when a player's GM id is unresolved", () => {
    renderList(
      root,
      model({
        isGm: false,
        gmId: null,
        view: { pcs: [c({ id: "goblin" })], gms: [] },
      }),
    );
    expect(root.textContent).toContain("Waiting for the GM to connect.");
    expect(root.querySelectorAll(".fh-row")).toHaveLength(0);
    // Distinguishable from the ordinary empty-roster message.
    expect(root.textContent).not.toContain("No combatants on Forge's initiative list");
  });

  it("renders a row per combatant under a column header", () => {
    renderList(root, model({ view: { pcs: [c({ id: "a" }), c({ id: "b" })], gms: [] } }));
    expect(root.querySelectorAll(".fh-row")).toHaveLength(2);
    expect(
      Array.from(root.querySelectorAll(".fh-cols > *")).map((el) => el.textContent),
    ).toEqual(["Init", "Name", "Mod", "Mode", "Roll"]);
  });

  it("omits the column header when there is nothing to list", () => {
    renderList(root, model({ view: { pcs: [], gms: [] } }));
    expect(root.querySelector(".fh-cols")).toBeNull();
  });

  it("shows a GM-only divider when GM rows are present", () => {
    renderList(
      root,
      model({
        isGm: true,
        view: { pcs: [c({ id: "pc" })], gms: [c({ id: "gob", gmControlled: true })] },
      }),
    );
    expect(root.querySelector(".fh-divider")!.textContent).toContain("GM only");
  });

  it("omits the divider when there are no GM rows", () => {
    renderList(root, model({ view: { pcs: [c({ id: "pc" })], gms: [] } }));
    expect(root.querySelector(".fh-divider")).toBeNull();
  });

  it("renders an unrolled initiative as an em dash", () => {
    renderList(root, model({ view: { pcs: [c({ id: "a", init: 0 })], gms: [] } }));
    expect(root.querySelector(".fh-init")!.textContent).toBe("—");
  });

  it("renders a rolled initiative as its number", () => {
    renderList(root, model({ view: { pcs: [c({ id: "a", init: 17 })], gms: [] } }));
    expect(root.querySelector(".fh-init")!.textContent).toBe("17");
  });

  it("prefills the bonus from the DEX modifier", () => {
    renderList(root, model({ view: { pcs: [c({ id: "a", dexRaw: 14 })], gms: [] } }));
    expect(root.querySelector<HTMLInputElement>(".fh-bonus")!.value).toBe("2");
  });

  it("prefers a saved override over the DEX modifier", () => {
    renderList(
      root,
      model({
        view: { pcs: [c({ id: "a", dexRaw: 14 })], gms: [] },
        overrides: { a: 7 },
      }),
    );
    expect(root.querySelector<HTMLInputElement>(".fh-bonus")!.value).toBe("7");
  });

  it("disables Roll on a token the player does not own", () => {
    renderList(
      root,
      model({ view: { pcs: [c({ id: "a", ownerId: "p-2" })], gms: [] }, selfId: "p-1" }),
    );
    expect(root.querySelector<HTMLButtonElement>(".fh-roll")!.disabled).toBe(true);
  });

  it("enables Roll on the player's own token", () => {
    renderList(
      root,
      model({ view: { pcs: [c({ id: "a", ownerId: "p-1" })], gms: [] }, selfId: "p-1" }),
    );
    expect(root.querySelector<HTMLButtonElement>(".fh-roll")!.disabled).toBe(false);
  });

  it("enables Roll on every row for the GM", () => {
    renderList(
      root,
      model({
        isGm: true,
        selfId: "gm-1",
        view: { pcs: [c({ id: "a", ownerId: "p-1" })], gms: [] },
      }),
    );
    expect(root.querySelector<HTMLButtonElement>(".fh-roll")!.disabled).toBe(false);
  });

  it("escapes combatant names", () => {
    renderList(
      root,
      model({ view: { pcs: [c({ id: "a", name: "<img src=x>" })], gms: [] } }),
    );
    expect(root.querySelector(".fh-name")!.innerHTML).not.toContain("<img");
    expect(root.textContent).toContain("<img src=x>");
  });

  it("marks the active mode button as pressed", () => {
    renderList(
      root,
      model({
        view: { pcs: [c({ id: "a" })], gms: [] },
        modes: new Map([["a", "advantage"]]),
      }),
    );
    const pressed = root.querySelector<HTMLButtonElement>('.fh-mode[aria-pressed="true"]')!;
    expect(pressed.dataset.mode).toBe("advantage");
  });

  it("disables the row and marks it while a roll is in flight", () => {
    renderList(
      root,
      model({
        view: { pcs: [c({ id: "a", ownerId: "p-1" })], gms: [] },
        statuses: new Map([["a", { itemId: "a", state: "rolling" }]]),
      }),
    );
    expect(root.querySelector<HTMLElement>(".fh-row")!.dataset.state).toBe("rolling");
    expect(root.querySelector<HTMLButtonElement>(".fh-roll")!.disabled).toBe(true);
  });

  it("preserves focus, uncommitted text and caret across a re-render", () => {
    const m = model({ view: { pcs: [c({ id: "a", ownerId: "p-1" })], gms: [] } });
    renderList(root, m);
    const input = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    input.focus();
    input.value = "17";
    input.setSelectionRange(1, 1);

    renderList(root, m);

    const after = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe("17");
    expect(after.selectionStart).toBe(1);
  });

  it("does not restore focus to a row that becomes disabled between renders", () => {
    const enabled = model({
      view: { pcs: [c({ id: "a", ownerId: "p-1" })], gms: [] },
      selfId: "p-1",
    });
    renderList(root, enabled);
    const input = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    expect(input.disabled).toBe(false);
    input.focus();
    input.value = "99";
    input.setSelectionRange(1, 1);
    expect(document.activeElement).toBe(input);

    const disabled = model({
      view: { pcs: [c({ id: "a", ownerId: "p-1" })], gms: [] },
      selfId: "p-1",
      statuses: new Map([["a", { itemId: "a", state: "rolling" }]]),
    });
    renderList(root, disabled);

    const after = root.querySelector<HTMLInputElement>(".fh-bonus")!;
    expect(after.disabled).toBe(true);
    // A disabled input can't become document.activeElement in the DOM
    // regardless of this guard, so the real proof the guard did its job
    // is that the stale uncommitted draft was never written into it.
    expect(document.activeElement).not.toBe(after);
    expect(after.value).not.toBe("99");
  });

  it("omits the owner label when the owner is not connected", () => {
    renderList(
      root,
      model({
        view: { pcs: [c({ id: "a", ownerId: "offline-player" })], gms: [] },
        ownerNames: new Map([["gm-1", "Adam"]]),
      }),
    );
    expect(root.querySelector(".fh-owner")).toBeNull();
  });

  it("shows the error message on a failed row", () => {
    renderList(
      root,
      model({
        view: { pcs: [c({ id: "a", ownerId: "p-1" })], gms: [] },
        statuses: new Map([
          ["a", { itemId: "a", state: "error", message: "dicex did not respond" }],
        ]),
      }),
    );
    expect(root.querySelector(".fh-error")!.textContent).toContain("did not respond");
  });
});
