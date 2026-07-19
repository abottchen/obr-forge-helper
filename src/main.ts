import OBR from "@owlbear-rodeo/sdk";
import {
  INTERNAL_ROLL_CHANNEL,
  INTERNAL_STATUS_CHANNEL,
} from "./constants";
import type {
  InternalStatusMessage,
  RollMode,
  RollSpec,
  Combatant,
} from "./types";
import { injectStyles, BASE_CSS } from "./styles";
import { readRoster, setInit } from "./forge";
import { resolveSession, type Session } from "./session";
import { buildRosterView, canRoll } from "./roster";
import { readOverrides, writeOverride, pruneOverrides, resolveBonus } from "./bonus";
import {
  renderList,
  bonusFor,
  pendingBulkRolls,
  type ListModel,
} from "./ui-list";

export async function mount(root: HTMLElement): Promise<() => void> {
  // Re-resolved on every refresh() (see below), not just here — a player who
  // opens the popover before the GM connects must recover once it does.
  let session: Session = await resolveSession();

  const model: ListModel = {
    view: { pcs: [], gms: [] },
    selfId: session.selfId,
    isGm: session.isGm,
    gmId: session.gmId,
    overrides: {},
    modes: new Map<string, RollMode>(),
    drafts: new Map<string, number>(),
    statuses: new Map<string, InternalStatusMessage>(),
    ownerNames: new Map<string, string>(),
    editingInit: null,
  };

  let combatants: Combatant[] = [];

  // Set the instant a mousedown lands inside the panel; cleared on the
  // mouseup that (natively) always follows it — see handlePointerDown,
  // handlePointerUp, and closeInitEditor. A mousedown that blurs a focused
  // init editor fires `focusout` synchronously, *before* click. If
  // closeInitEditor were allowed to re-render on that focusout, renderList's
  // innerHTML replacement would detach whatever node the browser already
  // captured as the pending click's target, and the click that follows would
  // land on nothing — silently swallowed, forcing the user to click twice.
  // This flag lets closeInitEditor tell "a click is still coming, don't
  // render yet" apart from "nothing more is coming, render now" (e.g.
  // Escape).
  //
  // Cleared on mouseup rather than click: mouseup always fires before click
  // in the browser's native order, and the flag only needs to stay true
  // across the mousedown -> focusout window, so mouseup is the earliest safe
  // place to clear it. It also covers cases where no click ever reaches
  // root at all — mousedown followed by a release outside the panel (drag
  // off it, a non-primary button, the pointer leaving the window before the
  // button comes up) fires no click on root, and without this the flag
  // would stay true for the rest of the session, wedging every future
  // closeInitEditor() call — including the one Escape depends on — into
  // skipping its render forever.
  let pointerDownInFlight = false;

  // Guards against out-of-order completion: refresh() is re-entrant (fired
  // by several subscriptions, including one triggered by our own
  // writeOverride), so two overlapping calls can resolve in either order.
  // Only the most recently started call is allowed to apply its result.
  let refreshSeq = 0;

  async function refresh(): Promise<void> {
    const seq = ++refreshSeq;
    // Re-resolved every call, not just at mount: OBR.party.onChange fires
    // when the GM connects, and a stale `gmId` captured at boot would leave
    // a player stuck in the "GM disconnected" state forever. This is
    // another await, so it must land before the generation guard below —
    // a superseded run must still mutate nothing.
    const freshSession = await resolveSession();
    const nextCombatants = await readRoster(freshSession.gmId);
    // Player display names for the owner label.
    const players = await OBR.party.getPlayers();
    const metadata = await OBR.room.getMetadata();
    if (seq !== refreshSeq) return; // superseded by a newer refresh; discard
    // Assigned together, after every await, so a click handler landing in
    // between never sees a `combatants` list that disagrees with the
    // rendered `model.view`.
    session = freshSession;
    combatants = nextCombatants;
    model.overrides = readOverrides(metadata);
    model.selfId = freshSession.selfId;
    model.isGm = freshSession.isGm;
    model.gmId = freshSession.gmId;
    model.ownerNames = new Map(players.map((p) => [p.id, p.name]));
    model.view = buildRosterView(combatants, freshSession.isGm);
    renderList(root, model);
  }

  function requestRolls(rolls: RollSpec[]): void {
    if (rolls.length === 0) return;
    for (const r of rolls) {
      model.statuses.set(r.itemId, { itemId: r.itemId, state: "rolling" });
      // Advantage is situational; never let it carry into the next round.
      model.modes.set(r.itemId, "normal");
    }
    renderList(root, model);
    void OBR.broadcast
      .sendMessage(INTERNAL_ROLL_CHANNEL, { rolls }, { destination: "LOCAL" })
      .catch((e) => console.warn("[forge-helper] roll request failed", e));
  }

  // Repaints a stale `.fh-init-edit` left in the DOM by a closeInitEditor()
  // call that skipped its render because pointerDownInFlight was true (see
  // its declaration above): model.editingInit is already null, but the old
  // editor node is still attached, focused, and accepting keystrokes that go
  // nowhere. Every place in handleClick that can observe that state — every
  // early return in the `.fh-init` branch, and the catch-all at the very end
  // for a click that matched no branch at all — must call this before
  // giving up, or the zombie editor lingers until some unrelated render
  // happens to clear it.
  function repaintStaleEditor(): void {
    if (model.editingInit === null && root.querySelector(".fh-init-edit")) {
      renderList(root, model);
    }
  }

  const handleClick = (ev: MouseEvent): void => {
    // pointerDownInFlight is not cleared here. It no longer needs to be:
    // mouseup always fires before click in the browser's native order, so
    // handlePointerUp (registered on window, see below) has already cleared
    // it by the time any click reaches this handler. Clearing it a second
    // time here bought nothing but a second place for the two to drift.
    const target = ev.target as HTMLElement;

    const initCell = target.closest<HTMLElement>(".fh-init");
    if (initCell?.dataset.id) {
      const id = initCell.dataset.id;
      const c = combatants.find((x) => x.id === id);
      // The badge renders on every row, editable or not, so the permission
      // check lives here rather than in the selector. Without it, a row the
      // viewer cannot touch would enter an edit mode that renders no editor
      // and has nothing to close it.
      if (!c || !canRoll(c, session.selfId, session.isGm)) {
        repaintStaleEditor();
        return;
      }
      if (model.statuses.get(id)?.state === "rolling") {
        repaintStaleEditor();
        return;
      }
      model.editingInit = id;
      renderList(root, model);
      // Nothing was focused before this render, so renderList's restoration
      // has nothing to restore — focus the fresh editor explicitly. select()
      // so typing replaces the current value instead of appending to it.
      const editor = root.querySelector<HTMLInputElement>(".fh-init-edit");
      editor?.focus();
      editor?.select();
      return;
    }

    const modeBtn = target.closest<HTMLElement>(".fh-mode");
    if (modeBtn?.dataset.id && modeBtn.dataset.mode) {
      model.modes.set(modeBtn.dataset.id, modeBtn.dataset.mode as RollMode);
      renderList(root, model);
      return;
    }

    const rollBtn = target.closest<HTMLElement>(".fh-roll");
    if (rollBtn?.dataset.id) {
      const id = rollBtn.dataset.id;
      const c = combatants.find((x) => x.id === id);
      if (!c || !canRoll(c, session.selfId, session.isGm)) return;
      requestRolls([
        {
          itemId: id,
          bonus: bonusFor(model, c),
          mode: model.modes.get(id) ?? "normal",
        },
      ]);
      return;
    }

    if (target.closest("#fh-bulk")) {
      // GM-only, unrolled, not already in flight. Snapshotted at click time.
      const specs = pendingBulkRolls(model).map((c) => ({
        itemId: c.id,
        bonus: bonusFor(model, c),
        mode: model.modes.get(c.id) ?? "normal",
      }));
      requestRolls(specs);
      return;
    }

    // No branch above matched, so nothing above re-rendered. If a pointer
    // interaction (this click's own mousedown) suppressed a closeInitEditor
    // render earlier in this same interaction — see closeInitEditor —
    // model.editingInit is already null but the old .fh-init-edit is still
    // sitting in the DOM, e.g. this click landed on empty space inside the
    // panel rather than another badge. Repaint so it cannot linger.
    repaintStaleEditor();
  };

  const handleChange = (ev: Event): void => {
    const initInput = (ev.target as HTMLElement).closest<HTMLInputElement>(
      ".fh-init-edit",
    );
    if (initInput) {
      // Blurring an edited box commits it. The focusout that follows finds
      // editingInit already cleared and does nothing. "blur" because this
      // handler only ever runs off a `change` event — see CloseReason above.
      commitInit(initInput, "blur");
      return;
    }

    const input = (ev.target as HTMLElement).closest<HTMLInputElement>(".fh-bonus");
    if (!input?.dataset.id) return;
    const id = input.dataset.id;
    const c = combatants.find((x) => x.id === id);
    if (!c) return;

    if (input.value.trim() === "") {
      // An emptied box means "no override", not a literal 0 — Number("") is
      // 0, which would otherwise persist a bogus override. Drop the draft
      // immediately so the box falls back to its computed prefill once the
      // clear lands.
      model.drafts.delete(id);
      void writeOverride(id, null).catch((e) =>
        console.warn("[forge-helper] override write failed", e),
      );
      return;
    }

    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) {
      // Reject non-numeric input outright — Number("3x") is NaN, and letting
      // that fall through would silently persist a bogus override of 0.
      // Leave whatever was previously stored untouched, and re-render so the
      // box reverts to showing it instead of the rejected text.
      renderList(root, model);
      return;
    }

    const value = Math.trunc(parsed);
    model.drafts.set(id, value);
    // Persist only a real override; clear the key when it matches the prefill.
    const prefill = resolveBonus({}, id, c.dexRaw);
    void writeOverride(id, value === prefill ? null : value)
      .then(() => {
        // Drop the draft once it is persisted, so room metadata is the single
        // source of truth again — but only if it still holds the value this
        // write was for. A second, newer edit may have landed while this
        // write was in flight; deleting unconditionally would drop that
        // newer draft and fall back to the stale persisted override until
        // the newer write's own metadata change arrives.
        if (model.drafts.get(id) === value) {
          model.drafts.delete(id);
        }
      })
      .catch((e) => {
        // Write failed, so nothing was persisted — keep showing what the
        // user typed rather than reverting to a stale value.
        console.warn("[forge-helper] override write failed", e);
      });
  };

  /**
   * Why the editor is closing. Controls whether the render this call would
   * otherwise trigger is suppressed while a pointer interaction is in
   * flight — see the `pointerDownInFlight` gate below.
   *
   * - `"blur"`: a `focusout`, or the `change`-driven commit that a modified
   *   blur fires first (see commitInit). Both can land between a
   *   `mousedown` and the `click` it precedes, so they must respect the
   *   gate — see pointerDownInFlight's declaration above.
   * - `"keyboard"`: Escape, or the Enter-driven commit — both delivered
   *   through handleKeyDown, never through a blur. Neither is ever the tail
   *   end of a mousedown/click pair, so neither needs to wait: the flag
   *   being true only means a mouse button happens to be down somewhere,
   *   and rendering right away can at worst swallow a click that was headed
   *   back to the very editor being closed.
   */
  type CloseReason = "blur" | "keyboard";

  function closeInitEditor(reason: CloseReason): void {
    if (model.editingInit === null) return;
    model.editingInit = null;
    if (reason === "blur" && pointerDownInFlight) {
      // A mousedown just landed inside the panel and its native click has
      // not fired yet (see pointerDownInFlight's declaration). Rendering now
      // would replace every node under root, including whichever one the
      // browser already captured as that pending click's target — the click
      // would then land on a detached node and be silently swallowed. Leave
      // the DOM as-is; handleClick renders once the click actually arrives,
      // either by matching a branch or via its own stale-editor fallback.
      return;
    }
    renderList(root, model);
  }

  /**
   * Parse, clamp, write, close.
   *
   * The editingInit check at the top is what makes this idempotent. Enter
   * commits and closes the editor, and the `change` and `focusout` that
   * follow the resulting blur would otherwise each try to commit again.
   *
   * `reason` is the CloseReason this call was itself invoked under — Enter
   * passes `"keyboard"`, `change` passes `"blur"` — and is threaded straight
   * through to every closeInitEditor() call below, so an Enter-driven commit
   * closes with the same immediacy as Escape while a `change`-driven one
   * stays subject to the pointerDownInFlight gate. Every call here used to be
   * hardcoded to `"blur"`, which was wrong for Enter: on the success path the
   * mistake self-heals, because the write's own scene-change event triggers
   * a refresh() that repaints regardless — but on the two reject paths below
   * (lost permission, non-numeric input) nothing writes anything, so an
   * Enter pressed while a mouse button was held would clear model.editingInit
   * and then sit there with the stale box still attached and focused, with
   * nothing left to ever repaint it.
   */
  function commitInit(input: HTMLInputElement, reason: CloseReason): void {
    const id = input.dataset.id;
    if (id === undefined || model.editingInit !== id) return;
    const c = combatants.find((x) => x.id === id);
    if (!c || !canRoll(c, session.selfId, session.isGm)) {
      // Permission was re-checked against live data and lost since the
      // editor opened (e.g. the combatant left the roster) — nothing to
      // write, but the editor must still close. Nothing else will: no
      // further keydown, change, or focusout is coming for a control the
      // next render won't draw.
      closeInitEditor(reason);
      return;
    }

    const raw = input.value.trim();
    let value: number;
    if (raw === "") {
      // An emptied box means "unrolled", and 0 is how Forge spells that.
      value = 0;
    } else {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        // Number("3x") is NaN. Reject outright rather than writing a bogus
        // 0 — closing re-renders the badge from the stored value.
        closeInitEditor(reason);
        return;
      }
      const truncated = Math.trunc(parsed);
      // 0 clears. A negative is a value the user meant, so it gets the roll
      // path's floor of 1 instead: written through, it would read as
      // unrolled and be swept into the next bulk roll.
      //
      // The sign check is on `parsed`, not `truncated`: Math.trunc(-0.5) is
      // -0, and -0 < 0 is false in JS, so branching on the truncated value
      // would let every input strictly between -1 and 0 slip past this
      // check and write -0 — Forge reads that as unrolled, same as 0. Do
      // not "simplify" this to Math.max(1, truncated) either — that clamps
      // the legitimate 0-means-clear case up to 1 and breaks clearing.
      //
      // A literal "-0" typed by the user takes this same non-negative path
      // for the same reason (Number("-0") is -0, and -0 < 0 is false), so it
      // writes -0 — numerically zero, so it clears exactly like "0" does.
      // That is consistent with 0-means-clear and deliberate, not a gap.
      value = parsed < 0 ? 1 : truncated;
    }

    closeInitEditor(reason);
    void setInit(id, value).catch((e) =>
      console.warn("[forge-helper] init write failed", e),
    );
  }

  const handleKeyDown = (ev: KeyboardEvent): void => {
    const input = (ev.target as HTMLElement).closest<HTMLInputElement>(".fh-init-edit");
    if (!input) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      // Never gated by pointerDownInFlight — see CloseReason above. Without
      // this, Escape pressed while the mouse button is still down (e.g. a
      // text-selection drag started inside the box) would clear
      // model.editingInit but skip the render, leaving the box attached and
      // focused, silently swallowing whatever the user typed next.
      closeInitEditor("keyboard");
    }
    if (ev.key === "Enter") {
      // Handled here rather than via `change`, which the browser skips when
      // it considers the value unmodified. Enter always commits, and — like
      // Escape — never waits on pointerDownInFlight; see CloseReason and
      // commitInit above for why a held mouse button must not strand it.
      ev.preventDefault();
      commitInit(input, "keyboard");
    }
  };

  // Closes an editor the user tabbed or clicked away from without changing.
  // A *modified* blur fires `change` first, which commits and clears
  // editingInit, so this finds nothing left to do — see handleChange.
  const handleFocusOut = (ev: FocusEvent): void => {
    if (!(ev.target as HTMLElement).closest(".fh-init-edit")) return;
    closeInitEditor("blur");
  };

  // Marks a pointer interaction as in flight for closeInitEditor — see
  // pointerDownInFlight's declaration above. Every mousedown inside the
  // panel qualifies, not just ones on a badge: a mousedown anywhere in root
  // can blur a focused editor elsewhere in the row list and trigger the same
  // focusout-before-click race.
  const handlePointerDown = (): void => {
    pointerDownInFlight = true;
  };

  // Clears pointerDownInFlight — see its declaration above. Registered on
  // window, not root: the whole point is to catch releases the panel never
  // sees — the button coming up after a drag off the panel, outside its
  // bounds, or even outside the browser window. A root-scoped listener would
  // miss exactly those cases and the flag would wedge true forever, taking
  // every future closeInitEditor() — including Escape's — down with it. Do
  // not "tidy" this onto root.
  const handlePointerUp = (): void => {
    pointerDownInFlight = false;
  };

  // Clears pointerDownInFlight through a different hole in the mouseup
  // guarantee above: once a native drag starts (e.g. dragging selected text
  // out of the init editor), the browser stops dispatching mouse events
  // altogether and fires `dragend` instead of `mouseup` on release. Without
  // this, that sequence would wedge the flag true exactly like the
  // drag-off-panel case handlePointerUp itself guards against. Not
  // reproducible in jsdom, so unlike handlePointerUp this has no test.
  const handleDragEnd = (): void => {
    pointerDownInFlight = false;
  };

  root.addEventListener("click", handleClick);
  root.addEventListener("change", handleChange);
  root.addEventListener("keydown", handleKeyDown);
  root.addEventListener("focusout", handleFocusOut);
  root.addEventListener("mousedown", handlePointerDown);
  window.addEventListener("mouseup", handlePointerUp);
  window.addEventListener("dragend", handleDragEnd);

  const unsubItems = OBR.scene.items.onChange(() => {
    void refresh();
  });
  const unsubRoom = OBR.room.onMetadataChange(() => {
    void refresh();
  });
  const unsubParty = OBR.party.onChange(() => {
    void refresh();
  });
  const unsubStatus = OBR.broadcast.onMessage(INTERNAL_STATUS_CHANNEL, (event) => {
    const msg = event.data as InternalStatusMessage;
    if (!msg?.itemId) return;
    if (msg.state === "ok") model.statuses.delete(msg.itemId);
    else model.statuses.set(msg.itemId, msg);
    renderList(root, model);
  });

  await refresh();

  if (session.isGm) {
    // Prune against every item in the scene, not just the roster: the
    // roster is filtered to Forge's on-list flag, and a token toggled off
    // the list mid-encounter (the normal state between encounters) is still
    // in the scene. Pruning against the roster would delete its override
    // the moment this popover reopens, which dicex does on every roll.
    void OBR.scene.items
      .getItems()
      .then((items) => pruneOverrides(new Set(items.map((i) => i.id))))
      .catch((e) => console.warn("[forge-helper] override prune failed", e));
  }

  return () => {
    root.removeEventListener("click", handleClick);
    root.removeEventListener("change", handleChange);
    root.removeEventListener("keydown", handleKeyDown);
    root.removeEventListener("focusout", handleFocusOut);
    root.removeEventListener("mousedown", handlePointerDown);
    window.removeEventListener("mouseup", handlePointerUp);
    window.removeEventListener("dragend", handleDragEnd);
    unsubItems();
    unsubRoom();
    unsubParty();
    unsubStatus();
  };
}

OBR.onReady(() => {
  injectStyles(BASE_CSS, "forge-helper-styles");
  const root = document.getElementById("root");
  if (!root) return;
  void mount(root).catch((e) => {
    console.error("[forge-helper] mount failed", e);
    root.textContent = "Forge Helper failed to start. See the console for details.";
  });
});
