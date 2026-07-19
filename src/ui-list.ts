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
}

export function bonusFor(model: ListModel, c: Combatant): number {
  const draft = model.drafts.get(c.id);
  if (draft !== undefined) return draft;
  return resolveBonus(model.overrides, c.id, c.dexRaw);
}

function modeFor(model: ListModel, id: string): RollMode {
  return model.modes.get(id) ?? "normal";
}

const MODE_LABELS: Array<[RollMode, string, string]> = [
  ["normal", "~", "Normal"],
  ["advantage", "adv", "Advantage"],
  ["disadvantage", "dis", "Disadvantage"],
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
      ? `<div class="fh-owner">${escapeHtml(ownerName)}</div>`
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

  return `
    <div class="fh-row" data-id="${escapeHtml(c.id)}" data-state="${status?.state ?? "idle"}">
      <div class="fh-name">${escapeHtml(c.name)}</div>
      ${owner}
      <div class="fh-controls">
        <input class="fh-bonus" type="text" inputmode="numeric"
               data-id="${escapeHtml(c.id)}" value="${bonus}"
               aria-label="Initiative bonus" ${allowed ? "" : "disabled"} />
        <div class="fh-modes">${modeButtons}</div>
        <span class="fh-init" data-unrolled="${c.init === 0}">${
          c.init === 0 ? "—" : String(c.init)
        }</span>
        <button class="fh-roll" type="button" data-id="${escapeHtml(c.id)}"
                ${allowed ? "" : "disabled"}>${rolling ? "…" : "Roll"}</button>
      </div>
      ${error}
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
    root.innerHTML = `<div class="fh-root"><div class="fh-empty">Waiting for the GM to connect.</div></div>`;
    return;
  }

  const { pcs, gms } = model.view;
  const total = pcs.length + gms.length;

  if (total === 0) {
    root.innerHTML = `<div class="fh-root"><div class="fh-empty">No combatants on Forge's initiative list.</div></div>`;
    return;
  }

  const unrolledGmCount = gms.filter((c) => c.init === 0).length;
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

  root.innerHTML = `
    <div class="fh-root">
      <div class="fh-header">${total} combatant${total === 1 ? "" : "s"}</div>
      ${pcs.map((c) => renderRow(model, c)).join("")}
      ${gmBlock}
    </div>`;
}
