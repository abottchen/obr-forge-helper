import type { Combatant, RollMode, InternalStatusMessage } from "./types";
import type { RosterView } from "./roster";
import { canRoll } from "./roster";
import { resolveBonus } from "./bonus";
import { escapeHtml } from "./escape";

export interface ListModel {
  view: RosterView;
  selfId: string;
  isGm: boolean;
  /** null when we are a player and the GM is not connected — see renderInto. */
  gmId: string | null;
  overrides: Record<string, number>;
  /** Transient per-row advantage state. Reset to normal after each roll. */
  modes: Map<string, RollMode>;
  /** Unsaved bonus box contents, surviving re-render. */
  drafts: Map<string, number>;
  statuses: Map<string, InternalStatusMessage>;
  /** Connected players' display names, keyed by player id. Populated in refresh(). */
  ownerNames: Map<string, string>;
  /** Id of the combatant whose badge is currently an editor, or null. */
  editingInit: string | null;
}

export function bonusFor(model: ListModel, c: Combatant): number {
  const draft = model.drafts.get(c.id);
  if (draft !== undefined) return draft;
  return resolveBonus(model.overrides, c.id, c.dexRaw);
}

function modeFor(model: ListModel, id: string): RollMode {
  return model.modes.get(id) ?? "normal";
}

/**
 * The GM-controlled combatants a bulk click would actually roll: unrolled,
 * and not already in flight.
 *
 * The status check is not redundant with `init === 0`. A combatant's init
 * stays 0 for the whole duration of its roll — it is only written back on
 * success — so an unrolled-count predicate alone leaves the button enabled,
 * still reading its original count, while dicex plays out a several-second
 * animation. Clicking again there resubmits the same tokens and races two
 * writes per token.
 *
 * Both the button's own count/disabled state and main.ts's click handler go
 * through here, so the two cannot drift apart.
 */
export function pendingBulkRolls(model: ListModel): Combatant[] {
  return model.view.gms.filter(
    (c) => c.init === 0 && model.statuses.get(c.id)?.state !== "rolling",
  );
}

/**
 * Face-on icosahedron: hexagonal silhouette with the top face inscribed. A
 * truer d20 also draws spokes from that face out to the hull corners, but at
 * the 18px this renders at they collapse into mush — the two-path version
 * reads as a die and the accurate one reads as a smudge. `aria-hidden`
 * because the button carries the label.
 */
const D20_ICON = `
  <svg class="fh-d20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 2 20.66 7 20.66 17 12 22 3.34 17 3.34 7Z" />
    <path d="M12 5 18.4 16.2 5.6 16.2Z" />
  </svg>`;

const MODE_LABELS: Array<[RollMode, string, string]> = [
  ["normal", "Norm", "Normal"],
  ["advantage", "Adv", "Advantage"],
  ["disadvantage", "Dis", "Disadvantage"],
];

function renderRow(model: ListModel, c: Combatant): string {
  const status = model.statuses.get(c.id);
  const rolling = status?.state === "rolling";
  const allowed = canRoll(c, model.selfId, model.isGm) && !rolling;
  const mode = modeFor(model, c.id);
  const bonus = bonusFor(model, c);
  // Omit the label rather than printing an id or placeholder when the owner
  // isn't currently connected — a raw id is meaningless at the table.
  const ownerName = model.ownerNames.get(c.ownerId);
  const owner =
    ownerName !== undefined
      ? `<span class="fh-owner">${escapeHtml(ownerName)}</span>`
      : "";

  const modeButtons = MODE_LABELS.map(
    ([value, label, title]) => `
      <button class="fh-mode" type="button" data-mode="${value}"
              data-id="${escapeHtml(c.id)}" title="${title}"
              aria-pressed="${mode === value}"
              ${allowed ? "" : "disabled"}>${label}</button>`,
  ).join("");

  const error =
    status?.state === "error" && status.message
      ? `<div class="fh-error">${escapeHtml(status.message)}</div>`
      : "";

  // `allowed` gates the editor as well as the roll controls: the badge is
  // rendered on every row, so a stray editingInit must not turn one the
  // viewer cannot touch into a live input.
  const editing = model.editingInit === c.id && allowed;
  const initCell = editing
    ? `<input class="fh-init-edit" type="text" inputmode="numeric"
              data-id="${escapeHtml(c.id)}"
              value="${c.init === 0 ? "" : String(c.init)}"
              aria-label="Initiative for ${escapeHtml(c.name)}" />`
    : `<span class="fh-init" data-id="${escapeHtml(c.id)}"
              data-unrolled="${c.init === 0}"
              ${allowed ? 'data-editable="true"' : ""}
              ${allowed ? 'title="Click to set initiative"' : ""}
              aria-label="Initiative">${c.init === 0 ? "—" : String(c.init)}</span>`;

  // One line per combatant: badge, name, bonus, mode, roll. An encounter can
  // run to a couple of dozen tokens, so row height is the budget that matters
  // — the name is the only thing that flexes, and it truncates.
  return `
    <div class="fh-row" data-id="${escapeHtml(c.id)}" data-state="${status?.state ?? "idle"}">
      ${initCell}
      <div class="fh-ident" title="${escapeHtml(c.name)}">
        <span class="fh-name">${escapeHtml(c.name)}</span>
        ${owner}
      </div>
      <input class="fh-bonus" type="text" inputmode="numeric"
             data-id="${escapeHtml(c.id)}" value="${bonus}"
             aria-label="Initiative bonus" ${allowed ? "" : "disabled"} />
      <div class="fh-modes">${modeButtons}</div>
      <button class="fh-roll" type="button" data-id="${escapeHtml(c.id)}"
              aria-label="Roll initiative for ${escapeHtml(c.name)}"
              title="Roll initiative"
              ${allowed ? "" : "disabled"}>${D20_ICON}</button>
      ${error}
    </div>`;
}

/**
 * Both no-op states lead with an unfilled initiative badge — the same slot the
 * rows show before a roll lands. It states the panel's job without a second
 * illustration vocabulary, and `aria-hidden` keeps it out of the reading order
 * since the text below already says everything.
 */
function emptyState(lead: string, hint: string): string {
  return `
    <div class="fh-empty">
      <div class="fh-empty-slot" aria-hidden="true">—</div>
      <p class="fh-empty-lead">${lead}</p>
      <p class="fh-empty-hint">${hint}</p>
    </div>`;
}

/**
 * Re-render replaces the whole panel, which would otherwise destroy a bonus
 * box the user is typing in. Re-renders fire on any scene or metadata change
 * — including the one our own override write triggers — so this is reachable
 * simply by tabbing between two bonus boxes. Capture focus, uncommitted text
 * and caret, then restore after.
 *
 * The input is type="text" rather than type="number" precisely so that
 * selectionStart/setSelectionRange work: number inputs report a null
 * selection in Chrome.
 */
export function renderList(root: HTMLElement, model: ListModel): void {
  const active = document.activeElement;
  const focused =
    active instanceof HTMLInputElement &&
    root.contains(active) &&
    active.classList.contains("fh-bonus")
      ? { id: active.dataset.id, text: active.value, caret: active.selectionStart }
      : null;

  renderInto(root, model);

  if (focused?.id !== undefined) {
    const next = Array.from(
      root.querySelectorAll<HTMLInputElement>(".fh-bonus"),
    ).find((el) => el.dataset.id === focused.id);
    if (next && !next.disabled) {
      next.value = focused.text;
      next.focus();
      if (focused.caret !== null) {
        next.setSelectionRange(focused.caret, focused.caret);
      }
    }
  }
}

function renderInto(root: HTMLElement, model: ListModel): void {
  // A player whose GM is not connected has no way to tell a PC token from a
  // GM token — toCombatant() marks everything gmControlled: false in that
  // case, so buildRosterView would otherwise put the whole GM roster in the
  // PC block. Block the listing entirely rather than guess. The GM's own
  // client never hits this: its gmId is always its own id (see session.ts).
  if (!model.isGm && model.gmId === null) {
    root.innerHTML = `<div class="fh-root">${emptyState(
      "Waiting for the GM to connect.",
      "Rolls need the GM online to tell player tokens from GM tokens.",
    )}</div>`;
    return;
  }

  const { pcs, gms } = model.view;
  const total = pcs.length + gms.length;

  if (total === 0) {
    // No columns to name when there is nothing under them.
    root.innerHTML = `<div class="fh-root">${emptyState(
      "No combatants on Forge's initiative list.",
      "Add tokens to the list in Forge, then roll for them here.",
    )}</div>`;
    return;
  }

  const unrolledGmCount = pendingBulkRolls(model).length;
  const bulk =
    model.isGm && gms.length > 0
      ? `<button class="fh-bulk" type="button" id="fh-bulk" ${
          unrolledGmCount === 0 ? "disabled" : ""
        }>Roll all unrolled (${unrolledGmCount})</button>`
      : "";

  const gmBlock =
    gms.length > 0
      ? `<div class="fh-divider">GM only</div>${gms.map((c) => renderRow(model, c)).join("")}${bulk}`
      : "";

  // Named columns, mirroring Forge's own header. Hidden from assistive tech:
  // every control below already carries its own label, so exposing these too
  // would just read out a row of loose words before the list.
  const columns = `
    <div class="fh-cols" aria-hidden="true">
      <span class="fh-col-init">Init</span>
      <span class="fh-col-name">Name</span>
      <span class="fh-col-mod">Mod</span>
      <span class="fh-col-mode">Mode</span>
      <span class="fh-col-roll">Roll</span>
    </div>`;

  root.innerHTML = `
    <div class="fh-root">
      ${columns}
      ${pcs.map((c) => renderRow(model, c)).join("")}
      ${gmBlock}
    </div>`;
}
